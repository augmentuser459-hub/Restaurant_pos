-- ============================================
-- 025: Kitchen display, POS management (branch menu and prices), notifications. Idempotent.
--   * branch_pos_items.removed_at: "removed from POS" marker, so a removed item is never auto-added back
--   * v_branch_pos_items_with_stock: adds the unit and the cost (recipe cost from calculate_recipe_cost), hides removed rows
--   * what the cashier sells comes from pos_item_catalog / pos_sellable_items (020); a listed row priced 0 is never
--     left available, so nothing is sold for 0 EGP
--   * posm_*: POS management actions (admin only), each one a single transaction
--   * kitchen_*: kitchen screen status changes (chef/admin). They never touch stock (stock is the checkout's job).
--   * notification_reads + v_notifications_inbox + notification_*: read state per user instead of one shared flag;
--     notifications_select_visible: the read policy for when RLS is enabled on notifications
-- Branch prices live only in branch_pos_items.price. items.selling_price is just the default price used when an
-- item is added to a branch (or auto-listed); nothing in this file writes items.selling_price.
-- ============================================

-- ---------- Branch POS items ----------

ALTER TABLE branch_pos_items ADD COLUMN IF NOT EXISTS removed_at timestamptz;

-- A removed row is never available: the checkout's catalog (pos_item_catalog, 020) sells a listed item only
-- while is_available is true, so this keeps removed items off the till whatever reads the table.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'branch_pos_items_removed_not_available') THEN
    UPDATE branch_pos_items SET is_available = false WHERE removed_at IS NOT NULL AND is_available IS DISTINCT FROM false;
    ALTER TABLE branch_pos_items ADD CONSTRAINT branch_pos_items_removed_not_available
      CHECK (removed_at IS NULL OR is_available = false);
  END IF;
END $$;

-- Management list: one row per managed item of a branch. Removed rows and inactive items are hidden.
-- item.unit = the item's unit; unit_cost = purchase price, or for a recipe calculate_recipe_cost (ingredients
-- converted to their stock unit).
-- in_stock follows the checkout: an item with a stock row needs stock > 0; without one, only a recipe
-- (made to order) is available.
CREATE OR REPLACE VIEW v_branch_pos_items_with_stock WITH (security_invoker = true) AS
SELECT
  bpi.id,
  bpi.branch_id,
  bpi.item_id,
  bpi.price,
  bpi.is_available,
  bpi.display_order,
  bpi.created_at,
  bpi.updated_at,
  jsonb_build_object(
    'id', i.id,
    'code', i.code,
    'barcode', i.barcode,
    'name', i.name,
    'name_ar', i.name_ar,
    'description', i.description,
    'unit_id', i.unit_id,
    'category_id', i.category_id,
    'purchase_price', i.purchase_price,
    'selling_price', i.selling_price,
    'min_stock_level', i.min_stock_level,
    'is_recipe', i.is_recipe,
    'status', i.status,
    'image_url', i.image_url,
    'unit', CASE WHEN u.id IS NULL THEN NULL
                 ELSE jsonb_build_object('id', u.id, 'code', u.code, 'name', u.name, 'name_ar', u.name_ar) END
  ) AS item,
  COALESCE(inv.quantity, 0::numeric) AS stock_quantity,
  COALESCE(inv.min_quantity, 0::numeric) AS min_stock,
  CASE
    WHEN inv.id IS NOT NULL THEN inv.quantity > 0
    ELSE COALESCE(i.is_recipe, false)
  END AS in_stock,
  b.name AS branch_name,
  b.name_ar AS branch_name_ar,
  b.code AS branch_code,
  -- calculate_recipe_cost (schema.sql, rewritten by 040 to convert each ingredient's unit) is the one recipe-cost rule
  CASE
    WHEN i.is_recipe = true THEN round(calculate_recipe_cost(i.id), 2)
    ELSE COALESCE(i.purchase_price, 0)
  END AS unit_cost
FROM branch_pos_items bpi
JOIN items i ON i.id = bpi.item_id
JOIN branches b ON b.id = bpi.branch_id
LEFT JOIN units u ON u.id = i.unit_id
LEFT JOIN inventory inv ON inv.item_id = bpi.item_id AND inv.branch_id = bpi.branch_id
WHERE i.status = 'active' AND bpi.removed_at IS NULL;

-- What the cashier sells, and at which price, has one rule: pos_item_catalog / pos_sellable_items (020).
-- Earlier drafts of this file had their own copies (a cashier view and a price function); remove them.
DROP VIEW IF EXISTS public.v_posm_cashier_items;
DROP FUNCTION IF EXISTS public.posm_sellable_price(uuid, uuid);

-- A listed item priced 0 must never be sold for 0 EGP: the posm_* functions below never leave a row priced 0
-- (after rounding to 2 decimals, as the checkout does) available. Data fix, re-runnable and re-applied to the rows
-- copied at go-live: rows that are available at price 0 are hidden (on the staging copy none of them had ever
-- been sold). 'تحديث الأسعار' gives them their default price, and the admin shows them again from the status column.
-- (No CHECK constraint for this: the go-live copy loads the old rows with constraints still checked.)
UPDATE branch_pos_items
SET is_available = false, updated_at = now()
WHERE removed_at IS NULL AND is_available IS TRUE AND round(price, 2) <= 0;

-- ---------- POS management actions (admin) ----------

-- Internal: the branch must exist and be a selling branch (not the main warehouse).
CREATE OR REPLACE FUNCTION public.posm_check_branch(p_branch_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_branch_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM branches WHERE id = p_branch_id AND COALESCE(is_main_warehouse, false) = false
  ) THEN
    RAISE EXCEPTION 'الفرع غير موجود' USING ERRCODE = 'P0001';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.posm_check_branch(uuid) FROM PUBLIC, anon, authenticated;

-- Saves the edits of the management table in one go.
--   p_items: [{"id": <branch_pos_items.id>, "price": 12.5 | null, "is_available": true | null}]  (null = unchanged)
--   p_costs: [{"item_id": <items.id>, "cost": 3.25}]  (purchase price of a non-recipe item listed in this branch)
-- Every row must belong to p_branch_id, so a stale screen can never edit another branch.
-- A row priced 0 cannot be left available (it would be sold for 0 EGP).
CREATE OR REPLACE FUNCTION public.posm_save_changes(p_branch_id uuid, p_items jsonb DEFAULT '[]'::jsonb, p_costs jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
  v_branch uuid;
  v_removed timestamptz;
  v_is_recipe boolean;
  v_price numeric;
  v_available boolean;
  v_items integer := 0;
  v_costs integer := 0;
BEGIN
  PERFORM app_require_role('admin');
  PERFORM posm_check_branch(p_branch_id);
  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' OR jsonb_typeof(COALESCE(p_costs, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'بيانات الحفظ غير صالحة' USING ERRCODE = 'P0001';
  END IF;

  FOR v_row IN
    SELECT * FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb)) AS x(id uuid, price numeric, is_available boolean)
  LOOP
    SELECT branch_id, removed_at INTO v_branch, v_removed FROM branch_pos_items WHERE id = v_row.id FOR UPDATE;
    IF NOT FOUND OR v_branch <> p_branch_id OR v_removed IS NOT NULL THEN
      RAISE EXCEPTION 'أحد المنتجات لم يعد موجوداً في نقطة بيع هذا الفرع، أعد تحميل الصفحة' USING ERRCODE = 'P0001';
    END IF;
    -- finite and bounded: NaN compares above every number and Infinity is a numeric value, so "<= 0" alone lets both in
    IF v_row.price IS NOT NULL AND NOT (round(v_row.price, 2) > 0 AND v_row.price < 1000000) THEN
      RAISE EXCEPTION 'سعر البيع يجب أن يكون أكبر من صفر وأقل من مليون' USING ERRCODE = 'P0001';
    END IF;
    UPDATE branch_pos_items
    SET price = COALESCE(round(v_row.price, 2), price),
        is_available = COALESCE(v_row.is_available, is_available),
        updated_at = now()
    WHERE id = v_row.id
    RETURNING price, is_available INTO v_price, v_available;
    IF v_available IS TRUE AND round(v_price, 2) <= 0 THEN
      RAISE EXCEPTION 'المنتج "%" سعره صفر: أدخل سعر بيع أكبر من صفر قبل إظهاره للكاشير',
        (SELECT i.name_ar FROM branch_pos_items b JOIN items i ON i.id = b.item_id WHERE b.id = v_row.id)
        USING ERRCODE = 'P0001';
    END IF;
    v_items := v_items + 1;
  END LOOP;

  FOR v_row IN
    SELECT * FROM jsonb_to_recordset(COALESCE(p_costs, '[]'::jsonb)) AS x(item_id uuid, cost numeric)
  LOOP
    IF v_row.cost IS NULL OR NOT (v_row.cost >= 0 AND v_row.cost < 1000000) THEN
      RAISE EXCEPTION 'سعر التكلفة يجب أن يكون صفراً أو أكثر وأقل من مليون' USING ERRCODE = 'P0001';
    END IF;
    SELECT is_recipe INTO v_is_recipe FROM items WHERE id = v_row.item_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الصنف غير موجود' USING ERRCODE = 'P0001';
    END IF;
    IF v_is_recipe THEN
      RAISE EXCEPTION 'تكلفة الريسبي تُحسب تلقائياً من مكوناتها ولا يمكن تعديلها هنا' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM branch_pos_items WHERE branch_id = p_branch_id AND item_id = v_row.item_id AND removed_at IS NULL) THEN
      RAISE EXCEPTION 'أحد المنتجات لم يعد موجوداً في نقطة بيع هذا الفرع، أعد تحميل الصفحة' USING ERRCODE = 'P0001';
    END IF;
    -- Unit costs can need more than 2 decimals (per gram, per ml), so keep 4.
    UPDATE items SET purchase_price = round(v_row.cost, 4), updated_at = now() WHERE id = v_row.item_id;
    v_costs := v_costs + 1;
  END LOOP;

  RETURN jsonb_build_object('items', v_items, 'costs', v_costs);
END $$;
REVOKE ALL ON FUNCTION public.posm_save_changes(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.posm_save_changes(uuid, jsonb, jsonb) TO authenticated;

-- Lists one item in a branch's POS at the given price (or re-lists a removed one). Returns the row id.
CREATE OR REPLACE FUNCTION public.posm_add_item(p_branch_id uuid, p_item_id uuid, p_price numeric)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app_require_role('admin');
  PERFORM posm_check_branch(p_branch_id);
  IF NOT EXISTS (SELECT 1 FROM items WHERE id = p_item_id AND status = 'active') THEN
    RAISE EXCEPTION 'الصنف غير موجود أو غير نشط' USING ERRCODE = 'P0001';
  END IF;
  IF p_price IS NULL OR NOT (round(p_price, 2) > 0 AND p_price < 1000000) THEN
    RAISE EXCEPTION 'أدخل سعر بيع أكبر من صفر وأقل من مليون' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO branch_pos_items (branch_id, item_id, price, is_available, display_order)
  VALUES (p_branch_id, p_item_id, round(p_price, 2), true, 0)
  ON CONFLICT (branch_id, item_id) DO UPDATE
    SET price = EXCLUDED.price, is_available = true, removed_at = NULL, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.posm_add_item(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.posm_add_item(uuid, uuid, numeric) TO authenticated;

-- 'إضافة الكل': lists every active item of the branch's inventory that is not listed yet (or was removed),
-- at its default price, and gives listed items priced 0 their default price. Hidden items stay hidden.
-- An item without any default price is added hidden (price 0), so it is not sold for 0 EGP.
-- Returns {added: new or listed again, repriced: listed rows that were priced 0, repriced_hidden: of those, how
-- many are still hidden from the cashier (a row priced 0 is never available, so normally all of them),
-- hidden_no_price: added rows that have no price yet and so stay hidden}.
CREATE OR REPLACE FUNCTION public.posm_add_all_items(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_added integer;
  v_repriced integer;
  v_repriced_hidden integer;
  v_hidden integer;
BEGIN
  PERFORM app_require_role('admin');
  PERFORM posm_check_branch(p_branch_id);

  -- cand/src see the rows as they were before the upsert (same statement), so each row is counted by what it was:
  -- never listed or removed (added), or listed at price 0 (repriced)
  WITH cand AS (
    SELECT inv.item_id,
           round(COALESCE(NULLIF(i.selling_price, 0), i.purchase_price, 0), 2) AS default_price,
           x.id AS row_id, x.removed_at, x.price AS current_price
    FROM inventory inv
    JOIN items i ON i.id = inv.item_id
    LEFT JOIN branch_pos_items x ON x.branch_id = inv.branch_id AND x.item_id = inv.item_id
    WHERE inv.branch_id = p_branch_id AND i.status = 'active'
  ), src AS (
    SELECT item_id, default_price, (row_id IS NULL OR removed_at IS NOT NULL) AS is_added
    FROM cand
    WHERE row_id IS NULL OR removed_at IS NOT NULL OR (round(current_price, 2) <= 0 AND default_price > 0)
  ), upserted AS (
    INSERT INTO branch_pos_items AS b (branch_id, item_id, price, is_available, display_order)
    SELECT p_branch_id, src.item_id, src.default_price, src.default_price > 0, 0 FROM src
    ON CONFLICT (branch_id, item_id) DO UPDATE
      SET price = CASE WHEN b.removed_at IS NOT NULL OR round(b.price, 2) <= 0 THEN EXCLUDED.price ELSE b.price END,
          is_available = CASE WHEN b.removed_at IS NOT NULL THEN EXCLUDED.price > 0 ELSE b.is_available END,
          removed_at = NULL,
          updated_at = now()
      WHERE b.removed_at IS NOT NULL OR (round(b.price, 2) <= 0 AND EXCLUDED.price > 0)
    RETURNING b.item_id, b.price, b.is_available
  )
  SELECT count(*) FILTER (WHERE s.is_added),
         count(*) FILTER (WHERE NOT s.is_added),
         count(*) FILTER (WHERE NOT s.is_added AND NOT u.is_available),
         count(*) FILTER (WHERE s.is_added AND round(u.price, 2) <= 0)
  INTO v_added, v_repriced, v_repriced_hidden, v_hidden
  FROM upserted u
  JOIN src s ON s.item_id = u.item_id;

  RETURN jsonb_build_object('added', v_added, 'repriced', v_repriced, 'repriced_hidden', v_repriced_hidden,
                            'hidden_no_price', v_hidden);
END $$;
REVOKE ALL ON FUNCTION public.posm_add_all_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.posm_add_all_items(uuid) TO authenticated;

-- Removes an item from a branch's POS. The row is kept as removed (and unavailable), so the cashier screen
-- does not list it again just because it is in stock; adding the item again restores it.
CREATE OR REPLACE FUNCTION public.posm_remove_item(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_removed timestamptz;
BEGIN
  PERFORM app_require_role('admin');
  SELECT removed_at INTO v_removed FROM branch_pos_items WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_removed IS NOT NULL THEN
    RAISE EXCEPTION 'المنتج غير موجود في نقطة البيع، أعد تحميل الصفحة' USING ERRCODE = 'P0001';
  END IF;
  UPDATE branch_pos_items SET removed_at = now(), is_available = false, updated_at = now() WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.posm_remove_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.posm_remove_item(uuid) TO authenticated;

-- 'تحديث الأسعار': gives every listed item priced 0 its default price (selling price, else purchase price).
-- Visibility is not changed, except that a row still priced 0 (the item has no price at all) is hidden, so it
-- is not sold for 0 EGP. Returns {updated, updated_hidden: of those, how many are hidden from the cashier,
-- remaining: active items still priced 0 (all hidden)}.
CREATE OR REPLACE FUNCTION public.posm_fix_zero_prices(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_updated integer;
  v_updated_hidden integer;
  v_remaining integer;
BEGIN
  PERFORM app_require_role('admin');
  PERFORM posm_check_branch(p_branch_id);

  WITH fixed AS (
    UPDATE branch_pos_items b
    SET price = round(COALESCE(NULLIF(i.selling_price, 0), i.purchase_price), 2),
        updated_at = now()
    FROM items i
    WHERE i.id = b.item_id
      AND i.status = 'active'
      AND b.branch_id = p_branch_id
      AND b.removed_at IS NULL
      AND round(b.price, 2) <= 0
      AND round(COALESCE(NULLIF(i.selling_price, 0), i.purchase_price, 0), 2) > 0
    RETURNING b.is_available
  )
  SELECT count(*), count(*) FILTER (WHERE is_available IS NOT TRUE)
  INTO v_updated, v_updated_hidden
  FROM fixed;

  -- what is still priced 0 (also rows of inactive items, in case they are activated again) is hidden

  UPDATE branch_pos_items
  SET is_available = false, updated_at = now()
  WHERE branch_id = p_branch_id AND removed_at IS NULL AND is_available IS TRUE AND round(price, 2) <= 0;

  SELECT count(*) INTO v_remaining
  FROM branch_pos_items b JOIN items i ON i.id = b.item_id
  WHERE b.branch_id = p_branch_id AND b.removed_at IS NULL AND round(b.price, 2) <= 0 AND i.status = 'active';

  RETURN jsonb_build_object('updated', v_updated, 'updated_hidden', v_updated_hidden, 'remaining', v_remaining);
END $$;
REVOKE ALL ON FUNCTION public.posm_fix_zero_prices(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.posm_fix_zero_prices(uuid) TO authenticated;

-- Changes every listed price of ONE branch by p_percent (between -90 and 500), rounded to 2 decimals.
CREATE OR REPLACE FUNCTION public.posm_apply_percentage(p_branch_id uuid, p_percent numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_updated integer;
BEGIN
  PERFORM app_require_role('admin');
  PERFORM posm_check_branch(p_branch_id);
  IF p_percent IS NULL OR p_percent = 0 OR p_percent < -90 OR p_percent > 500 THEN
    RAISE EXCEPTION 'النسبة يجب أن تكون بين -90 و 500 ولا تساوي صفراً' USING ERRCODE = 'P0001';
  END IF;

  UPDATE branch_pos_items
  SET price = GREATEST(round(price * (1 + p_percent / 100), 2), 0.01),
      updated_at = now()
  WHERE branch_id = p_branch_id AND removed_at IS NULL AND price > 0;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_updated);
END $$;
REVOKE ALL ON FUNCTION public.posm_apply_percentage(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.posm_apply_percentage(uuid, numeric) TO authenticated;

-- Copies the listed items (price and availability) of the source branch into the target branch.
-- Items the target already lists get the source price; nothing else in the target changes.
-- A source row priced 0 has no price to copy: it is added to the target only if missing there, hidden (so it is
-- not sold for 0 EGP), and never overwrites a target price. Returns {inserted, updated, hidden_no_price}.
CREATE OR REPLACE FUNCTION public.posm_copy_prices(p_source_branch_id uuid, p_target_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inserted integer;
  v_updated integer;
  v_hidden integer;
BEGIN
  PERFORM app_require_role('admin');
  PERFORM posm_check_branch(p_source_branch_id);
  PERFORM posm_check_branch(p_target_branch_id);
  IF p_source_branch_id = p_target_branch_id THEN
    RAISE EXCEPTION 'اختر فرعاً مصدراً مختلفاً عن الفرع الحالي' USING ERRCODE = 'P0001';
  END IF;

  WITH upserted AS (
    INSERT INTO branch_pos_items AS b (branch_id, item_id, price, is_available, display_order)
    SELECT p_target_branch_id, s.item_id, round(s.price, 2),
           COALESCE(s.is_available, true) AND round(s.price, 2) > 0, 0
    FROM branch_pos_items s
    WHERE s.branch_id = p_source_branch_id AND s.removed_at IS NULL
    ON CONFLICT (branch_id, item_id) DO UPDATE
      SET price = EXCLUDED.price, is_available = EXCLUDED.is_available, removed_at = NULL, updated_at = now()
      WHERE EXCLUDED.price > 0
    RETURNING (xmax = 0) AS inserted, b.price
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted),
         count(*) FILTER (WHERE inserted AND price <= 0)
  INTO v_inserted, v_updated, v_hidden
  FROM upserted;

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'hidden_no_price', v_hidden);
END $$;
REVOKE ALL ON FUNCTION public.posm_copy_prices(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.posm_copy_prices(uuid, uuid) TO authenticated;

-- ---------- Kitchen ----------

-- True when an order has at least one line the kitchen prepares, with the same rule as the kitchen screen:
-- a line counts when its item's category is a kitchen category (categories.is_kitchen), when it has no
-- category, or when no category is marked as kitchen at all.
-- Internal: for the checkout function (orders that need no kitchen can go straight to 'delivered').
CREATE OR REPLACE FUNCTION public.kitchen_order_needs_kitchen(p_order_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM order_items oi
    LEFT JOIN items i ON i.id = oi.item_id
    LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
    WHERE oi.order_id = p_order_id
      AND (
        NOT EXISTS (SELECT 1 FROM categories WHERE is_kitchen = true)
        OR COALESCE(i.category_id, mi.category_id) IS NULL
        OR EXISTS (SELECT 1 FROM categories c WHERE c.id = COALESCE(i.category_id, mi.category_id) AND c.is_kitchen = true)
      )
  )
$$;
REVOKE ALL ON FUNCTION public.kitchen_order_needs_kitchen(uuid) FROM PUBLIC, anon, authenticated;

-- Moves an order forward on the kitchen screen: paid -> in_kitchen -> preparing -> ready (a step may be skipped,
-- never repeated or reversed). Row-locked, so a double click or a second screen cannot apply it twice.
-- Only the status and its timestamps change: stock is not touched here.
CREATE OR REPLACE FUNCTION public.kitchen_set_order_status(p_order_id uuid, p_status order_status)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := app_require_role('chef', 'admin');
  v_branch uuid;
  v_status order_status;
  v_from integer;
  v_to integer;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('in_kitchen', 'preparing', 'ready') THEN
    RAISE EXCEPTION 'حالة غير صالحة لشاشة المطبخ' USING ERRCODE = 'P0001';
  END IF;

  SELECT branch_id, status INTO v_branch, v_status FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF NOT app_can_access_branch(v_branch) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على طلبات هذا الفرع' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('paid', 'in_kitchen', 'preparing') THEN
    RAISE EXCEPTION 'لم يعد هذا الطلب في المطبخ (حالته الآن: %)',
      CASE v_status
        WHEN 'ready' THEN 'جاهز'
        WHEN 'delivered' THEN 'تم التسليم'
        WHEN 'cancelled' THEN 'ملغي'
        WHEN 'new' THEN 'جديد غير مدفوع'
        WHEN 'pending_payment' THEN 'في انتظار الدفع'
        ELSE v_status::text
      END
      USING ERRCODE = 'P0001';
  END IF;

  v_from := array_position(ARRAY['paid', 'in_kitchen', 'preparing', 'ready']::order_status[], v_status);
  v_to := array_position(ARRAY['paid', 'in_kitchen', 'preparing', 'ready']::order_status[], p_status);
  IF v_to <= v_from THEN
    RAISE EXCEPTION 'تم تحديث حالة هذا الطلب بالفعل، أعد تحميل الشاشة' USING ERRCODE = 'P0001';
  END IF;

  UPDATE orders
  SET status = p_status,
      sent_to_kitchen_at = CASE WHEN p_status IN ('in_kitchen', 'preparing', 'ready') THEN COALESCE(sent_to_kitchen_at, now()) ELSE sent_to_kitchen_at END,
      preparation_started_at = CASE WHEN p_status IN ('preparing', 'ready') THEN COALESCE(preparation_started_at, now()) ELSE preparation_started_at END,
      ready_at = CASE WHEN p_status = 'ready' THEN now() ELSE ready_at END,
      chef_id = COALESCE(chef_id, v_user),
      updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('id', p_order_id, 'status', p_status);
END $$;
REVOKE ALL ON FUNCTION public.kitchen_set_order_status(uuid, order_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kitchen_set_order_status(uuid, order_status) TO authenticated;

-- Orders of the branch that are in a kitchen status but have no line the kitchen prepares (same rule as
-- kitchen_order_needs_kitchen) never appear on the kitchen screen, so nobody could ever move them on:
-- they are handed over at the counter, so mark them 'delivered'. The kitchen screen runs this with its full
-- refresh. Status only: stock is not touched. Returns how many orders were moved.
CREATE OR REPLACE FUNCTION public.kitchen_release_non_kitchen_orders(p_branch_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM app_require_role('chef', 'admin');
  IF p_branch_id IS NULL OR NOT app_can_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على طلبات هذا الفرع' USING ERRCODE = '42501';
  END IF;
  -- With no kitchen category configured every line counts as a kitchen line: nothing to release.
  IF NOT EXISTS (SELECT 1 FROM categories WHERE is_kitchen = true) THEN
    RETURN 0;
  END IF;

  WITH candidates AS (
    SELECT o.id
    FROM orders o
    WHERE o.branch_id = p_branch_id
      AND o.status IN ('paid', 'in_kitchen', 'preparing')
      AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)
      AND NOT EXISTS (
        SELECT 1
        FROM order_items oi
        LEFT JOIN items i ON i.id = oi.item_id
        LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
        LEFT JOIN categories c ON c.id = COALESCE(i.category_id, mi.category_id)
        WHERE oi.order_id = o.id
          AND (COALESCE(i.category_id, mi.category_id) IS NULL OR c.is_kitchen IS TRUE))
    FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE orders o
  SET status = 'delivered',
      delivered_at = COALESCE(o.delivered_at, now()),
      updated_at = now()
  FROM candidates
  WHERE o.id = candidates.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.kitchen_release_non_kitchen_orders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kitchen_release_non_kitchen_orders(uuid) TO authenticated;

-- ---------- Notifications: read state per user ----------

CREATE TABLE IF NOT EXISTS public.notification_reads (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON public.notification_reads(user_id);

-- Written only by notification_mark_read / notification_mark_all_read. Each user can read only their own rows
-- (v_notifications_inbox reads it as the caller). Nothing reads notifications before login, so anon gets nothing.
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_reads_select_own ON public.notification_reads;
CREATE POLICY notification_reads_select_own ON public.notification_reads
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.notification_reads FROM anon, authenticated;
GRANT SELECT ON public.notification_reads TO authenticated;

-- Notifications as the calling user sees them: is_read/read_at are that user's own read state.
-- notifications.is_read is the old shared flag; it is only set on rows from before this change, which stay read.
CREATE OR REPLACE VIEW v_notifications_inbox WITH (security_invoker = true) AS
SELECT
  n.id,
  n.user_id,
  n.branch_id,
  n.type,
  n.title,
  n.message,
  n.priority,
  n.reference_type,
  n.reference_id,
  (COALESCE(n.is_read, false) OR r.notification_id IS NOT NULL) AS is_read,
  COALESCE(r.read_at, n.read_at) AS read_at,
  n.created_at,
  n.expires_at
FROM notifications n
LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = auth.uid();

REVOKE ALL ON v_notifications_inbox FROM anon, authenticated;
GRANT SELECT ON v_notifications_inbox TO authenticated;

-- Internal: notifications the user sees in the bell: addressed to them or to everyone, and for their branch
-- or for all branches (a user without a branch, e.g. an admin, sees every branch).
CREATE OR REPLACE FUNCTION public.notification_is_visible(p_user_id uuid, p_user_branch uuid, p_n_user uuid, p_n_branch uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (p_n_user IS NULL OR p_n_user = p_user_id)
     AND (p_user_branch IS NULL OR p_n_branch IS NULL OR p_n_branch = p_user_branch)
$$;
REVOKE ALL ON FUNCTION public.notification_is_visible(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Who may read which notification once row-level security is switched on for notifications (the 090 security
-- step does that for every table): the same rule as notification_is_visible, written inline because a policy runs
-- with the caller's rights. Supabase Realtime checks the policy for each subscriber, so every user's realtime feed
-- then carries only the notifications that user sees. While RLS is still off on notifications it has no effect.
DROP POLICY IF EXISTS notifications_select_visible ON public.notifications;
CREATE POLICY notifications_select_visible ON public.notifications
  FOR SELECT TO authenticated
  USING (
    app_user_id() IS NOT NULL
    AND (user_id IS NULL OR user_id = app_user_id())
    AND (branch_id IS NULL OR app_user_branch() IS NULL OR branch_id = app_user_branch())
  );

CREATE OR REPLACE FUNCTION public.notification_mark_read(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := app_require_role('admin', 'warehouse_manager', 'branch_supervisor', 'chef', 'cashier', 'purchase_manager');
  v_branch uuid := app_user_branch();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.id = p_notification_id AND notification_is_visible(v_user, v_branch, n.user_id, n.branch_id)
  ) THEN
    RAISE EXCEPTION 'الإشعار غير موجود' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO notification_reads (notification_id, user_id) VALUES (p_notification_id, v_user)
  ON CONFLICT (notification_id, user_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.notification_mark_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_mark_read(uuid) TO authenticated;

-- 'قراءة الكل': marks read, for the caller only, every notification the caller sees. Returns how many.
CREATE OR REPLACE FUNCTION public.notification_mark_all_read()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := app_require_role('admin', 'warehouse_manager', 'branch_supervisor', 'chef', 'cashier', 'purchase_manager');
  v_branch uuid := app_user_branch();
  v_count integer;
BEGIN
  INSERT INTO notification_reads (notification_id, user_id)
  SELECT n.id, v_user
  FROM notifications n
  WHERE COALESCE(n.is_read, false) = false
    AND notification_is_visible(v_user, v_branch, n.user_id, n.branch_id)
  ON CONFLICT (notification_id, user_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.notification_mark_all_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_mark_all_read() TO authenticated;
