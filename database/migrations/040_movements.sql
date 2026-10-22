-- ============================================
-- 040: Transfers, branch/supplier returns, damages, recipes and production. Idempotent.
--   Every status change and every stock/money movement of these documents is ONE function below:
--   SECURITY DEFINER, permission check first, status precondition under FOR UPDATE (a stale page or a
--   double click cannot apply it twice), stock only via stock_adjust(), supplier money only via
--   supplier_balance_adjust(), exact NUMERIC maths rounded to 3 dp (quantities) / 2 dp (money).
--   Business errors: Arabic message, ERRCODE P0001 (42501 for "not allowed"); shortages carry HINT 'INSUFFICIENT_STOCK'.
-- ============================================

-- ---------- Legacy triggers ----------
-- Older databases had triggers that moved stock / supplier balances when these documents changed status.
-- Stock now moves only inside the functions below, so such a trigger would apply every movement twice.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.tgname, c.relname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal
      AND c.relnamespace = 'public'::regnamespace
      AND c.relname IN ('transfers', 'transfer_items', 'branch_returns', 'branch_return_items',
                        'supplier_returns', 'damages', 'production_logs')
      AND p.proname IN ('update_inventory_on_transfer', 'update_inventory_on_damage',
                        'update_inventory_on_return', 'update_supplier_balance_on_return')
  LOOP
    EXECUTE format('DROP TRIGGER %I ON public.%I', r.tgname, r.relname);
  END LOOP;
END $$;

-- ---------- Schema additions (all nullable or defaulted: the go-live reload inserts rows without them) ----------

-- Unit conversion: a unit is measured in base_unit_id (NULL = it is its own base); factor_to_base = base units in one unit.
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS base_unit_id uuid REFERENCES public.units(id);
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS factor_to_base numeric NOT NULL DEFAULT 1;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'units_factor_to_base_check') THEN
    ALTER TABLE public.units ADD CONSTRAINT units_factor_to_base_check CHECK (factor_to_base > 0);
  END IF;
END $$;

-- kg = 1000 g, L = 1000 ml, dozen = 12 pieces. Re-runnable: only rows that differ are touched.
UPDATE public.units u
SET base_unit_id = b.id, factor_to_base = m.factor
FROM (VALUES ('KG', 'G', 1000::numeric), ('L', 'ML', 1000::numeric), ('DZ', 'PC', 12::numeric)) AS m(code, base_code, factor)
JOIN public.units b ON b.code = m.base_code
WHERE u.code = m.code
  AND (u.base_unit_id IS DISTINCT FROM b.id OR u.factor_to_base IS DISTINCT FROM m.factor);

-- Which branch a supplier return leaves from (NULL on old rows = the main warehouse).
ALTER TABLE public.supplier_returns ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);

-- Idempotency key of a production request: a retry after a lost response returns the first result instead of producing twice.
ALTER TABLE public.production_logs ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS production_logs_request_id_key
  ON public.production_logs (request_id) WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_production_logs_recipe ON public.production_logs (recipe_item_id, produced_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer ON public.transfer_items (transfer_id);
CREATE INDEX IF NOT EXISTS idx_branch_return_items_return ON public.branch_return_items (return_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON public.recipe_ingredients (recipe_item_id);

-- ---------- Internal helpers ----------

-- Arabic label of a document status, for "already processed" messages.
CREATE OR REPLACE FUNCTION public.transfer_status_ar(p_status text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_status
    WHEN 'pending' THEN 'معلق'
    WHEN 'approved' THEN 'موافق عليه'
    WHEN 'rejected' THEN 'مرفوض'
    WHEN 'in_transit' THEN 'قيد الشحن'
    WHEN 'received' THEN 'مستلم'
    WHEN 'cancelled' THEN 'ملغي'
    ELSE COALESCE(p_status, '-')
  END
$$;
REVOKE ALL ON FUNCTION public.transfer_status_ar(text) FROM PUBLIC, anon, authenticated;

-- How many p_to_unit are in one p_from_unit. NULL when the units cannot be converted (e.g. piece -> kg).
-- A NULL unit means "the item's own stock unit".
CREATE OR REPLACE FUNCTION public.recipe_unit_factor(p_from_unit uuid, p_to_unit uuid) RETURNS numeric
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_from_unit IS NULL OR p_to_unit IS NULL OR p_from_unit = p_to_unit THEN 1::numeric
    ELSE (SELECT CASE WHEN COALESCE(f.base_unit_id, f.id) = COALESCE(t.base_unit_id, t.id)
                      THEN f.factor_to_base / t.factor_to_base END
          FROM units f, units t
          WHERE f.id = p_from_unit AND t.id = p_to_unit)
  END
$$;
REVOKE ALL ON FUNCTION public.recipe_unit_factor(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The main warehouse branch (branch returns go to it; supplier returns leave from it by default).
CREATE OR REPLACE FUNCTION public.return_main_warehouse() RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM branches WHERE is_main_warehouse AND status = 'active' ORDER BY created_at, id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.return_main_warehouse() FROM PUBLIC, anon, authenticated;

-- Recipe cost (per one recipe unit) with each ingredient converted to its stock unit, which is what purchase_price is per.
-- Same signature as the original schema.sql function; an unconvertible legacy unit falls back to the old 1:1 maths.
-- Every recipe cost shown in the app should come from here (the POS-management view in 025 is asked to call it).
CREATE OR REPLACE FUNCTION public.calculate_recipe_cost(recipe_item_id uuid) RETURNS numeric
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT round(COALESCE(SUM(
           ri.quantity
           * COALESCE(CASE
               WHEN ri.unit_id IS NULL OR ri.unit_id = i.unit_id THEN 1::numeric
               WHEN COALESCE(fu.base_unit_id, fu.id) = COALESCE(su.base_unit_id, su.id) THEN fu.factor_to_base / su.factor_to_base
             END, 1)
           * COALESCE(i.purchase_price, 0)), 0), 4)
  FROM recipe_ingredients ri
  JOIN items i ON i.id = ri.ingredient_item_id
  LEFT JOIN units fu ON fu.id = ri.unit_id
  LEFT JOIN units su ON su.id = i.unit_id
  WHERE ri.recipe_item_id = calculate_recipe_cost.recipe_item_id
$$;
REVOKE ALL ON FUNCTION public.calculate_recipe_cost(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_recipe_cost(uuid) TO authenticated;

-- ============================================
-- TRANSFERS between branches
--   pending --approve--> approved --receive--> received (stock moves here: transfer_out / transfer_in)
--   pending --reject--> rejected
--   Approval belongs to the SOURCE side (admin, warehouse manager, or the source branch's supervisor who did not
--   request it); receipt to the DESTINATION side (admin, warehouse manager, or the destination branch's supervisor).
-- ============================================

-- p_items: [{ "item_id": uuid, "quantity": number, "notes": text? }]; the same item on several rows is merged.
CREATE OR REPLACE FUNCTION public.transfer_create(
  p_from_branch_id uuid,
  p_to_branch_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  v_from_name text;
  v_to_name text;
  v_id uuid;
  v_number text;
  v_short text := '';
  v_avail numeric;
  r record;
BEGIN
  IF p_from_branch_id IS NULL OR p_to_branch_id IS NULL THEN
    RAISE EXCEPTION 'يرجى اختيار الفرع المرسل والمستلم' USING ERRCODE = 'P0001';
  END IF;
  IF p_from_branch_id = p_to_branch_id THEN
    RAISE EXCEPTION 'لا يمكن التحويل لنفس الفرع' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (public.app_can_access_branch(p_from_branch_id) OR public.app_can_access_branch(p_to_branch_id)) THEN
    RAISE EXCEPTION 'يمكنك إنشاء تحويلات من فرعك أو إليه فقط' USING ERRCODE = '42501';
  END IF;
  SELECT name_ar INTO v_from_name FROM branches WHERE id = p_from_branch_id AND status = 'active';
  SELECT name_ar INTO v_to_name FROM branches WHERE id = p_to_branch_id AND status = 'active';
  IF v_from_name IS NULL OR v_to_name IS NULL THEN
    RAISE EXCEPTION 'الفرع غير موجود أو غير نشط' USING ERRCODE = 'P0001';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يرجى إضافة صنف واحد على الأقل' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
             WHERE (e->>'item_id') IS NULL OR (e->>'quantity') IS NULL OR (e->>'quantity')::numeric <= 0) THEN
    RAISE EXCEPTION 'كل صنف يجب أن يكون له كمية أكبر من صفر' USING ERRCODE = 'P0001';
  END IF;

  FOR r IN
    SELECT l.item_id, round(SUM(l.qty), 3) AS qty, i.name_ar
    FROM (SELECT (e->>'item_id')::uuid AS item_id, (e->>'quantity')::numeric AS qty FROM jsonb_array_elements(p_items) e) l
    LEFT JOIN items i ON i.id = l.item_id
    GROUP BY l.item_id, i.name_ar
    ORDER BY l.item_id
  LOOP
    IF r.name_ar IS NULL THEN
      RAISE EXCEPTION 'صنف غير موجود في الطلب' USING ERRCODE = 'P0001';
    END IF;
    IF r.qty <= 0 THEN
      RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر للصنف "%"', r.name_ar USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE((SELECT quantity FROM inventory WHERE branch_id = p_from_branch_id AND item_id = r.item_id), 0) INTO v_avail;
    IF v_avail < r.qty THEN
      v_short := v_short || E'\n' || r.name_ar || ': المتاح ' || trim_scale(v_avail) || ' والمطلوب ' || trim_scale(r.qty);
    END IF;
  END LOOP;
  IF v_short <> '' THEN
    RAISE EXCEPTION 'الكمية غير متوفرة في الفرع المرسل:%', v_short USING ERRCODE = 'P0001', HINT = 'INSUFFICIENT_STOCK';
  END IF;

  v_number := public.next_document_number('TRF');
  INSERT INTO transfers (transfer_number, from_branch_id, to_branch_id, status, notes, requested_by, requested_at)
  VALUES (v_number, p_from_branch_id, p_to_branch_id, 'pending', NULLIF(btrim(COALESCE(p_notes, '')), ''), v_user, now())
  RETURNING id INTO v_id;

  INSERT INTO transfer_items (transfer_id, item_id, requested_quantity, notes)
  SELECT v_id, l.item_id, round(SUM(l.qty), 3), NULLIF(string_agg(NULLIF(btrim(l.notes), ''), ' / '), '')
  FROM (SELECT (e->>'item_id')::uuid AS item_id, (e->>'quantity')::numeric AS qty, e->>'notes' AS notes
        FROM jsonb_array_elements(p_items) e) l
  GROUP BY l.item_id;

  RETURN jsonb_build_object('id', v_id, 'transfer_number', v_number,
    'from_branch_id', p_from_branch_id, 'to_branch_id', p_to_branch_id,
    'from_branch_name', v_from_name, 'to_branch_name', v_to_name);
END $$;

CREATE OR REPLACE FUNCTION public.transfer_approve(p_transfer_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  t transfers%ROWTYPE;
  v_short text := '';
  v_avail numeric;
  r record;
BEGIN
  SELECT * INTO t FROM transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'التحويل غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF t.status <> 'pending' THEN
    RAISE EXCEPTION 'لا يمكن الموافقة: حالة التحويل الآن "%". حدّث الصفحة', public.transfer_status_ar(t.status::text)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT (public.app_has_role('admin', 'warehouse_manager')
          OR (t.from_branch_id IS NOT DISTINCT FROM public.app_user_branch() AND t.requested_by IS DISTINCT FROM v_user)) THEN
    RAISE EXCEPTION 'الموافقة على التحويل من صلاحية الفرع المرسل أو مدير المخزن، ولا يوافق مقدم الطلب على طلبه'
      USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT ti.item_id, i.name_ar, round(SUM(ti.requested_quantity), 3) AS qty
    FROM transfer_items ti JOIN items i ON i.id = ti.item_id
    WHERE ti.transfer_id = t.id
    GROUP BY ti.item_id, i.name_ar
    ORDER BY ti.item_id
  LOOP
    SELECT COALESCE((SELECT quantity FROM inventory WHERE branch_id = t.from_branch_id AND item_id = r.item_id), 0) INTO v_avail;
    IF v_avail < r.qty THEN
      v_short := v_short || E'\n' || r.name_ar || ': المتاح ' || trim_scale(v_avail) || ' والمطلوب ' || trim_scale(r.qty);
    END IF;
  END LOOP;
  IF v_short <> '' THEN
    RAISE EXCEPTION 'الكمية غير متوفرة في الفرع المرسل:%', v_short USING ERRCODE = 'P0001', HINT = 'INSUFFICIENT_STOCK';
  END IF;

  UPDATE transfer_items SET approved_quantity = requested_quantity WHERE transfer_id = t.id;
  UPDATE transfers
  SET status = 'approved', approved_by = v_user, approved_at = now(), updated_at = now()
  WHERE id = t.id;

  RETURN jsonb_build_object('id', t.id, 'transfer_number', t.transfer_number, 'status', 'approved',
    'from_branch_id', t.from_branch_id, 'to_branch_id', t.to_branch_id);
END $$;

CREATE OR REPLACE FUNCTION public.transfer_reject(p_transfer_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  t transfers%ROWTYPE;
BEGIN
  SELECT * INTO t FROM transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'التحويل غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF t.status <> 'pending' THEN
    RAISE EXCEPTION 'لا يمكن الرفض: حالة التحويل الآن "%". حدّث الصفحة', public.transfer_status_ar(t.status::text)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT (public.app_has_role('admin', 'warehouse_manager')
          OR (t.from_branch_id IS NOT DISTINCT FROM public.app_user_branch() AND t.requested_by IS DISTINCT FROM v_user)) THEN
    RAISE EXCEPTION 'رفض التحويل من صلاحية الفرع المرسل أو مدير المخزن' USING ERRCODE = '42501';
  END IF;

  UPDATE transfers
  SET status = 'rejected', rejected_by = v_user, rejected_at = now(),
      rejection_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''), updated_at = now()
  WHERE id = t.id;

  RETURN jsonb_build_object('id', t.id, 'transfer_number', t.transfer_number, 'status', 'rejected',
    'from_branch_id', t.from_branch_id, 'to_branch_id', t.to_branch_id);
END $$;

-- Moves the approved quantities: transfer_out from the source, transfer_in to the destination, all or nothing.
CREATE OR REPLACE FUNCTION public.transfer_receive(p_transfer_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  t transfers%ROWTYPE;
  v_short text := '';
  v_avail numeric;
  v_note text;
  r record;
BEGIN
  SELECT * INTO t FROM transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'التحويل غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF t.status <> 'approved' THEN
    RAISE EXCEPTION 'لا يمكن تأكيد الاستلام: حالة التحويل الآن "%". حدّث الصفحة', public.transfer_status_ar(t.status::text)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT (public.app_has_role('admin', 'warehouse_manager') OR t.to_branch_id IS NOT DISTINCT FROM public.app_user_branch()) THEN
    RAISE EXCEPTION 'تأكيد استلام التحويل من صلاحية الفرع المستلم أو مدير المخزن' USING ERRCODE = '42501';
  END IF;

  -- Lock every stock row this receipt touches (both branches) in one global order: item, then branch. All movement
  -- functions lock in this order, so two receipts in opposite directions (A->B and B->A) of the same item wait for
  -- each other instead of deadlocking.
  PERFORM 1 FROM inventory
  WHERE branch_id IN (t.from_branch_id, t.to_branch_id)
    AND item_id IN (SELECT ti.item_id FROM transfer_items ti WHERE ti.transfer_id = t.id)
  ORDER BY item_id, branch_id
  FOR UPDATE;

  -- Check every line first so the user sees all shortages at once.
  FOR r IN
    SELECT ti.item_id, i.name_ar, round(SUM(COALESCE(ti.approved_quantity, ti.requested_quantity)), 3) AS qty
    FROM transfer_items ti JOIN items i ON i.id = ti.item_id
    WHERE ti.transfer_id = t.id
    GROUP BY ti.item_id, i.name_ar
    ORDER BY ti.item_id
  LOOP
    SELECT quantity INTO v_avail FROM inventory
    WHERE branch_id = t.from_branch_id AND item_id = r.item_id
    FOR UPDATE;
    v_avail := COALESCE(v_avail, 0);
    IF v_avail < r.qty THEN
      v_short := v_short || E'\n' || r.name_ar || ': المتاح ' || trim_scale(v_avail) || ' والمطلوب ' || trim_scale(r.qty);
    END IF;
  END LOOP;
  IF v_short <> '' THEN
    RAISE EXCEPTION 'الكمية غير متوفرة في الفرع المرسل:%', v_short USING ERRCODE = 'P0001', HINT = 'INSUFFICIENT_STOCK';
  END IF;

  v_note := 'تحويل ' || t.transfer_number;
  FOR r IN
    SELECT ti.item_id, i.purchase_price, round(SUM(COALESCE(ti.approved_quantity, ti.requested_quantity)), 3) AS qty
    FROM transfer_items ti JOIN items i ON i.id = ti.item_id
    WHERE ti.transfer_id = t.id
    GROUP BY ti.item_id, i.purchase_price
    ORDER BY ti.item_id
  LOOP
    CONTINUE WHEN r.qty <= 0;
    PERFORM public.stock_adjust(t.from_branch_id, r.item_id, -r.qty, 'transfer_out', 'transfer', t.id, v_note, r.purchase_price, false);
    PERFORM public.stock_adjust(t.to_branch_id, r.item_id, r.qty, 'transfer_in', 'transfer', t.id, v_note, r.purchase_price, true);
    UPDATE inventory SET last_restock_date = now() WHERE branch_id = t.to_branch_id AND item_id = r.item_id;
  END LOOP;

  UPDATE transfer_items SET received_quantity = COALESCE(approved_quantity, requested_quantity) WHERE transfer_id = t.id;
  UPDATE transfers
  SET status = 'received', received_by = v_user, received_at = now(), updated_at = now()
  WHERE id = t.id;

  RETURN jsonb_build_object('id', t.id, 'transfer_number', t.transfer_number, 'status', 'received',
    'from_branch_id', t.from_branch_id, 'to_branch_id', t.to_branch_id);
END $$;

-- ============================================
-- BRANCH RETURNS (branch -> main warehouse)
--   pending --approve--> approved --ship--> in_transit --receive--> received (stock moves here: 'return')
--   pending --reject--> rejected
--   Approve / ship / reject: admin, warehouse manager or the returning branch's supervisor.
--   Receive: admin, warehouse manager or a supervisor of the main warehouse.
-- ============================================

-- p_items: [{ "item_id": uuid, "quantity": number, "reason": text?, "notes": text? }]; the same item on several rows is merged.
CREATE OR REPLACE FUNCTION public.return_branch_create(
  p_from_branch_id uuid,
  p_return_reason text,
  p_items jsonb,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  v_main uuid := public.return_main_warehouse();
  v_id uuid;
  v_number text;
  v_short text := '';
  v_avail numeric;
  r record;
BEGIN
  IF v_main IS NULL THEN
    RAISE EXCEPTION 'لم يتم تحديد المخزن الرئيسي' USING ERRCODE = 'P0001';
  END IF;
  IF p_from_branch_id IS NULL THEN
    RAISE EXCEPTION 'يرجى اختيار الفرع المصدر' USING ERRCODE = 'P0001';
  END IF;
  IF p_from_branch_id = v_main THEN
    RAISE EXCEPTION 'المرتجع يكون من فرع إلى المخزن الرئيسي' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(p_from_branch_id) THEN
    RAISE EXCEPTION 'يمكنك إنشاء مرتجعات لفرعك فقط' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_from_branch_id AND status = 'active') THEN
    RAISE EXCEPTION 'الفرع غير موجود أو غير نشط' USING ERRCODE = 'P0001';
  END IF;
  IF btrim(COALESCE(p_return_reason, '')) = '' THEN
    RAISE EXCEPTION 'يرجى إدخال سبب الإرجاع' USING ERRCODE = 'P0001';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يرجى إضافة صنف واحد على الأقل' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
             WHERE (e->>'item_id') IS NULL OR (e->>'quantity') IS NULL OR (e->>'quantity')::numeric <= 0) THEN
    RAISE EXCEPTION 'كل صنف يجب أن يكون له كمية أكبر من صفر' USING ERRCODE = 'P0001';
  END IF;

  FOR r IN
    SELECT l.item_id, round(SUM(l.qty), 3) AS qty, i.name_ar
    FROM (SELECT (e->>'item_id')::uuid AS item_id, (e->>'quantity')::numeric AS qty FROM jsonb_array_elements(p_items) e) l
    LEFT JOIN items i ON i.id = l.item_id
    GROUP BY l.item_id, i.name_ar
    ORDER BY l.item_id
  LOOP
    IF r.name_ar IS NULL THEN
      RAISE EXCEPTION 'صنف غير موجود في المرتجع' USING ERRCODE = 'P0001';
    END IF;
    IF r.qty <= 0 THEN
      RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر للصنف "%"', r.name_ar USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE((SELECT quantity FROM inventory WHERE branch_id = p_from_branch_id AND item_id = r.item_id), 0) INTO v_avail;
    IF v_avail < r.qty THEN
      v_short := v_short || E'\n' || r.name_ar || ': المتاح ' || trim_scale(v_avail) || ' والمطلوب ' || trim_scale(r.qty);
    END IF;
  END LOOP;
  IF v_short <> '' THEN
    RAISE EXCEPTION 'الكمية غير متوفرة في الفرع:%', v_short USING ERRCODE = 'P0001', HINT = 'INSUFFICIENT_STOCK';
  END IF;

  v_number := public.next_document_number('BRT');
  INSERT INTO branch_returns (return_number, return_date, from_branch_id, to_branch_id, status, return_reason,
                              notes, requested_by, requested_at)
  VALUES (v_number, (now() AT TIME ZONE 'Africa/Cairo')::date, p_from_branch_id, v_main, 'pending', btrim(p_return_reason),
          NULLIF(btrim(COALESCE(p_notes, '')), ''), v_user, now())
  RETURNING id INTO v_id;

  INSERT INTO branch_return_items (return_id, item_id, requested_quantity, unit_cost, total_value, item_reason, notes)
  SELECT v_id, l.item_id, round(SUM(l.qty), 3), MAX(i.purchase_price),
         round(SUM(l.qty) * COALESCE(MAX(i.purchase_price), 0), 2),
         NULLIF(string_agg(DISTINCT NULLIF(btrim(l.reason), ''), ' / '), ''),
         NULLIF(string_agg(DISTINCT NULLIF(btrim(l.notes), ''), ' / '), '')
  FROM (SELECT (e->>'item_id')::uuid AS item_id, (e->>'quantity')::numeric AS qty, e->>'reason' AS reason, e->>'notes' AS notes
        FROM jsonb_array_elements(p_items) e) l
  JOIN items i ON i.id = l.item_id
  GROUP BY l.item_id;

  UPDATE branch_returns br
  SET total_items = s.n, total_quantity = s.qty, total_value = s.val
  FROM (SELECT count(*)::int AS n, round(SUM(requested_quantity), 3) AS qty, round(SUM(COALESCE(total_value, 0)), 2) AS val
        FROM branch_return_items WHERE return_id = v_id) s
  WHERE br.id = v_id;

  RETURN jsonb_build_object('id', v_id, 'return_number', v_number);
END $$;

CREATE OR REPLACE FUNCTION public.return_branch_approve(p_return_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  b branch_returns%ROWTYPE;
BEGIN
  SELECT * INTO b FROM branch_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المرتجع غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF b.status <> 'pending' THEN
    RAISE EXCEPTION 'لا يمكن الموافقة: حالة المرتجع الآن "%". حدّث الصفحة', public.transfer_status_ar(b.status::text)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(b.from_branch_id) THEN
    RAISE EXCEPTION 'الموافقة على المرتجع من صلاحية الفرع المرسل أو مدير المخزن' USING ERRCODE = '42501';
  END IF;

  UPDATE branch_return_items SET approved_quantity = requested_quantity WHERE return_id = b.id;
  UPDATE branch_returns
  SET status = 'approved', approved_by = v_user, approved_at = now(), updated_at = now()
  WHERE id = b.id;

  RETURN jsonb_build_object('id', b.id, 'return_number', b.return_number, 'status', 'approved');
END $$;

CREATE OR REPLACE FUNCTION public.return_branch_reject(p_return_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  b branch_returns%ROWTYPE;
BEGIN
  SELECT * INTO b FROM branch_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المرتجع غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF b.status <> 'pending' THEN
    RAISE EXCEPTION 'لا يمكن الرفض: حالة المرتجع الآن "%". حدّث الصفحة', public.transfer_status_ar(b.status::text)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(b.from_branch_id) THEN
    RAISE EXCEPTION 'رفض المرتجع من صلاحية الفرع المرسل أو مدير المخزن' USING ERRCODE = '42501';
  END IF;

  UPDATE branch_returns
  SET status = 'rejected', rejected_by = v_user, rejected_at = now(),
      rejection_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''), updated_at = now()
  WHERE id = b.id;

  RETURN jsonb_build_object('id', b.id, 'return_number', b.return_number, 'status', 'rejected');
END $$;

-- Marks the goods as shipped. Stock still moves only on receipt, but the branch must hold the quantities now.
CREATE OR REPLACE FUNCTION public.return_branch_ship(p_return_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  b branch_returns%ROWTYPE;
  v_short text := '';
  v_avail numeric;
  r record;
BEGIN
  SELECT * INTO b FROM branch_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المرتجع غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF b.status <> 'approved' THEN
    RAISE EXCEPTION 'لا يمكن بدء الشحن: حالة المرتجع الآن "%". حدّث الصفحة', public.transfer_status_ar(b.status::text)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(b.from_branch_id) THEN
    RAISE EXCEPTION 'شحن المرتجع من صلاحية الفرع المرسل أو مدير المخزن' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT bi.item_id, i.name_ar, round(SUM(COALESCE(bi.approved_quantity, bi.requested_quantity)), 3) AS qty
    FROM branch_return_items bi JOIN items i ON i.id = bi.item_id
    WHERE bi.return_id = b.id
    GROUP BY bi.item_id, i.name_ar
    ORDER BY bi.item_id
  LOOP
    SELECT COALESCE((SELECT quantity FROM inventory WHERE branch_id = b.from_branch_id AND item_id = r.item_id), 0) INTO v_avail;
    IF v_avail < r.qty THEN
      v_short := v_short || E'\n' || r.name_ar || ': المتاح ' || trim_scale(v_avail) || ' والمطلوب ' || trim_scale(r.qty);
    END IF;
  END LOOP;
  IF v_short <> '' THEN
    RAISE EXCEPTION 'الكمية غير متوفرة في الفرع:%', v_short USING ERRCODE = 'P0001', HINT = 'INSUFFICIENT_STOCK';
  END IF;

  UPDATE branch_return_items SET shipped_quantity = COALESCE(approved_quantity, requested_quantity) WHERE return_id = b.id;
  UPDATE branch_returns SET status = 'in_transit', shipped_at = now(), updated_at = now() WHERE id = b.id;

  RETURN jsonb_build_object('id', b.id, 'return_number', b.return_number, 'status', 'in_transit');
END $$;

-- Deducts the shipped quantities from the branch (refused, never clamped, when it no longer holds them)
-- and adds the same quantities to the main warehouse, all or nothing.
CREATE OR REPLACE FUNCTION public.return_branch_receive(p_return_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  b branch_returns%ROWTYPE;
  v_short text := '';
  v_avail numeric;
  v_note text;
  r record;
BEGIN
  SELECT * INTO b FROM branch_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المرتجع غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF b.status <> 'in_transit' THEN
    RAISE EXCEPTION 'لا يمكن تأكيد الاستلام: حالة المرتجع الآن "%". حدّث الصفحة', public.transfer_status_ar(b.status::text)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT (public.app_has_role('admin', 'warehouse_manager') OR b.to_branch_id IS NOT DISTINCT FROM public.app_user_branch()) THEN
    RAISE EXCEPTION 'تأكيد استلام المرتجع من صلاحية المخزن الرئيسي' USING ERRCODE = '42501';
  END IF;

  -- Lock the branch and warehouse stock rows in the global order (item, then branch): see transfer_receive.
  PERFORM 1 FROM inventory
  WHERE branch_id IN (b.from_branch_id, b.to_branch_id)
    AND item_id IN (SELECT bi.item_id FROM branch_return_items bi WHERE bi.return_id = b.id)
  ORDER BY item_id, branch_id
  FOR UPDATE;

  FOR r IN
    SELECT bi.item_id, i.name_ar,
           round(SUM(COALESCE(bi.shipped_quantity, bi.approved_quantity, bi.requested_quantity)), 3) AS qty
    FROM branch_return_items bi JOIN items i ON i.id = bi.item_id
    WHERE bi.return_id = b.id
    GROUP BY bi.item_id, i.name_ar
    ORDER BY bi.item_id
  LOOP
    SELECT quantity INTO v_avail FROM inventory
    WHERE branch_id = b.from_branch_id AND item_id = r.item_id
    FOR UPDATE;
    v_avail := COALESCE(v_avail, 0);
    IF v_avail < r.qty THEN
      v_short := v_short || E'\n' || r.name_ar || ': المتاح ' || trim_scale(v_avail) || ' والمطلوب ' || trim_scale(r.qty);
    END IF;
  END LOOP;
  IF v_short <> '' THEN
    RAISE EXCEPTION 'الكمية غير متوفرة في الفرع المرسل:%', v_short USING ERRCODE = 'P0001', HINT = 'INSUFFICIENT_STOCK';
  END IF;

  v_note := 'مرتجع فرع ' || b.return_number;
  FOR r IN
    SELECT bi.item_id, MAX(COALESCE(bi.unit_cost, i.purchase_price)) AS unit_cost,
           round(SUM(COALESCE(bi.shipped_quantity, bi.approved_quantity, bi.requested_quantity)), 3) AS qty
    FROM branch_return_items bi JOIN items i ON i.id = bi.item_id
    WHERE bi.return_id = b.id
    GROUP BY bi.item_id
    ORDER BY bi.item_id
  LOOP
    CONTINUE WHEN r.qty <= 0;
    PERFORM public.stock_adjust(b.from_branch_id, r.item_id, -r.qty, 'return', 'branch_return', b.id, v_note, r.unit_cost, false);
    PERFORM public.stock_adjust(b.to_branch_id, r.item_id, r.qty, 'return', 'branch_return', b.id, v_note, r.unit_cost, true);
  END LOOP;

  UPDATE branch_return_items
  SET received_quantity = COALESCE(shipped_quantity, approved_quantity, requested_quantity)
  WHERE return_id = b.id;
  UPDATE branch_returns
  SET status = 'received', received_by = v_user, received_at = now(), updated_at = now()
  WHERE id = b.id;

  RETURN jsonb_build_object('id', b.id, 'return_number', b.return_number, 'status', 'received');
END $$;

-- ============================================
-- SUPPLIER RETURNS (warehouse -> supplier), one row per item; a multi-item return shares a number prefix.
--   pending --approve--> approved (stock leaves the branch AND the supplier balance drops by total_amount)
--   approved --complete--> received (handed over to the supplier)
--   pending --reject--> rejected
--   Admin and warehouse manager only.
-- ============================================

-- p_items: [{ "item_id": uuid, "quantity": number, "unit_price": number?, "reason": text?, "notes": text? }]
-- p_branch_id defaults to the main warehouse. With p_supply_id the return cannot exceed what that supply delivered.
CREATE OR REPLACE FUNCTION public.return_supplier_create(
  p_supplier_id uuid,
  p_items jsonb,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_supply_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager');
  v_branch uuid := p_branch_id;
  v_supply supplies%ROWTYPE;
  v_base text;
  v_count int;
  v_n int := 0;
  v_short text := '';
  v_avail numeric;
  v_supplied numeric;
  v_returned numeric;
  v_ids uuid[] := '{}';
  v_id uuid;
  r record;
BEGIN
  IF p_supplier_id IS NULL OR NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'يرجى اختيار المورد' USING ERRCODE = 'P0001';
  END IF;
  IF p_supply_id IS NOT NULL THEN
    SELECT * INTO v_supply FROM supplies WHERE id = p_supply_id;
    IF NOT FOUND OR v_supply.supplier_id IS DISTINCT FROM p_supplier_id THEN
      RAISE EXCEPTION 'التوريد المحدد لا يخص هذا المورد' USING ERRCODE = 'P0001';
    END IF;
    v_branch := COALESCE(v_branch, v_supply.branch_id);
    IF v_branch IS DISTINCT FROM v_supply.branch_id THEN
      RAISE EXCEPTION 'التوريد المحدد تم استلامه في فرع آخر' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  v_branch := COALESCE(v_branch, public.return_main_warehouse());
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'لم يتم تحديد المخزن الرئيسي' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(v_branch) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يرجى إضافة صنف واحد على الأقل' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
             WHERE (e->>'item_id') IS NULL OR (e->>'quantity') IS NULL OR (e->>'quantity')::numeric <= 0) THEN
    RAISE EXCEPTION 'كل صنف يجب أن يكون له كمية أكبر من صفر' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE (e->>'unit_price')::numeric < 0) THEN
    RAISE EXCEPTION 'سعر الوحدة لا يمكن أن يكون سالباً' USING ERRCODE = 'P0001';
  END IF;

  -- Totals per item (the same item may be on several rows): available stock, and the supply cap when linked.
  FOR r IN
    SELECT l.item_id, round(SUM(l.qty), 3) AS qty, i.name_ar
    FROM (SELECT (e->>'item_id')::uuid AS item_id, (e->>'quantity')::numeric AS qty FROM jsonb_array_elements(p_items) e) l
    LEFT JOIN items i ON i.id = l.item_id
    GROUP BY l.item_id, i.name_ar
    ORDER BY l.item_id
  LOOP
    IF r.name_ar IS NULL THEN
      RAISE EXCEPTION 'صنف غير موجود في المرتجع' USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE((SELECT quantity FROM inventory WHERE branch_id = v_branch AND item_id = r.item_id), 0) INTO v_avail;
    IF v_avail < r.qty THEN
      v_short := v_short || E'\n' || r.name_ar || ': المتاح ' || trim_scale(v_avail) || ' والمطلوب ' || trim_scale(r.qty);
    END IF;
    IF p_supply_id IS NOT NULL THEN
      SELECT COALESCE(SUM(COALESCE(received_quantity, quantity)), 0) INTO v_supplied
      FROM supply_items WHERE supply_id = p_supply_id AND item_id = r.item_id;
      SELECT COALESCE(SUM(quantity), 0) INTO v_returned
      FROM supplier_returns WHERE supply_id = p_supply_id AND item_id = r.item_id AND status <> 'rejected';
      IF r.qty + v_returned > v_supplied THEN
        RAISE EXCEPTION 'لا يمكن إرجاع أكثر مما تم توريده للصنف "%": الموَرَّد % والمرتجع سابقاً % والمطلوب %',
          r.name_ar, trim_scale(v_supplied), trim_scale(v_returned), trim_scale(r.qty) USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;
  IF v_short <> '' THEN
    RAISE EXCEPTION 'الكمية غير متوفرة في المخزن:%', v_short USING ERRCODE = 'P0001', HINT = 'INSUFFICIENT_STOCK';
  END IF;

  v_base := public.next_document_number('SRT');
  v_count := jsonb_array_length(p_items);
  FOR r IN
    SELECT (e->>'item_id')::uuid AS item_id, round((e->>'quantity')::numeric, 3) AS qty,
           COALESCE((e->>'unit_price')::numeric, i.purchase_price, 0) AS price,
           COALESCE(NULLIF(btrim(e->>'reason'), ''), NULLIF(btrim(COALESCE(p_reason, '')), ''), '') AS reason,
           COALESCE(NULLIF(btrim(e->>'notes'), ''), NULLIF(btrim(COALESCE(p_notes, '')), '')) AS notes,
           ord
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(e, ord)
    JOIN items i ON i.id = (e->>'item_id')::uuid
    ORDER BY ord
  LOOP
    v_n := v_n + 1;
    INSERT INTO supplier_returns (return_number, supply_id, supplier_id, item_id, branch_id, quantity, unit_price,
                                  total_amount, reason, description, status, registered_by, registered_at)
    VALUES (CASE WHEN v_count > 1 THEN v_base || '-' || v_n ELSE v_base END, p_supply_id, p_supplier_id, r.item_id,
            v_branch, r.qty, r.price, round(r.qty * r.price, 2), r.reason, r.notes, 'pending', v_user, now())
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;

  RETURN jsonb_build_object('return_number', v_base, 'ids', to_jsonb(v_ids));
END $$;

CREATE OR REPLACE FUNCTION public.return_supplier_approve(p_return_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager');
  s supplier_returns%ROWTYPE;
  v_branch uuid;
  v_balance numeric;
BEGIN
  SELECT * INTO s FROM supplier_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المرتجع غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF s.status <> 'pending' THEN
    RAISE EXCEPTION 'لا يمكن الموافقة: حالة المرتجع الآن "%". حدّث الصفحة', public.transfer_status_ar(s.status::text)
      USING ERRCODE = 'P0001';
  END IF;
  v_branch := COALESCE(s.branch_id, (SELECT branch_id FROM supplies WHERE id = s.supply_id), public.return_main_warehouse());
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'لم يتم تحديد المخزن الرئيسي' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(v_branch) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
  END IF;

  -- The supplier row first, then stock: the same order as the purchasing functions (supply = supplier, then stock),
  -- so a supply and a return of the same supplier approved at the same moment cannot deadlock.
  PERFORM 1 FROM suppliers WHERE id = s.supplier_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المورد غير موجود' USING ERRCODE = 'P0001';
  END IF;

  -- Raises (HINT INSUFFICIENT_STOCK) when the branch no longer holds the quantity; nothing is changed then.
  PERFORM public.stock_adjust(v_branch, s.item_id, -s.quantity, 'return', 'supplier_return', s.id,
                              'مرتجع للمورد ' || s.return_number, s.unit_price, true);
  v_balance := public.supplier_balance_adjust(s.supplier_id, -COALESCE(s.total_amount, 0));

  UPDATE supplier_returns
  SET status = 'approved', approved_by = v_user, approved_at = now(), branch_id = v_branch, updated_at = now()
  WHERE id = s.id;

  RETURN jsonb_build_object('id', s.id, 'return_number', s.return_number, 'status', 'approved',
    'supplier_balance', v_balance);
END $$;

CREATE OR REPLACE FUNCTION public.return_supplier_complete(p_return_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager');
  s supplier_returns%ROWTYPE;
BEGIN
  SELECT * INTO s FROM supplier_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المرتجع غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF s.status <> 'approved' THEN
    RAISE EXCEPTION 'لا يمكن تأكيد الإرجاع: حالة المرتجع الآن "%". حدّث الصفحة', public.transfer_status_ar(s.status::text)
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE supplier_returns SET status = 'received', received_by_supplier_at = now(), updated_at = now() WHERE id = s.id;

  RETURN jsonb_build_object('id', s.id, 'return_number', s.return_number, 'status', 'received', 'completed_by', v_user);
END $$;

CREATE OR REPLACE FUNCTION public.return_supplier_reject(p_return_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager');
  s supplier_returns%ROWTYPE;
BEGIN
  SELECT * INTO s FROM supplier_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المرتجع غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF s.status <> 'pending' THEN
    RAISE EXCEPTION 'لا يمكن الرفض: حالة المرتجع الآن "%". حدّث الصفحة', public.transfer_status_ar(s.status::text)
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE supplier_returns
  SET status = 'rejected', rejected_by = v_user, rejected_at = now(),
      rejection_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''), updated_at = now()
  WHERE id = s.id;

  RETURN jsonb_build_object('id', s.id, 'return_number', s.return_number, 'status', 'rejected');
END $$;

-- ============================================
-- DAMAGES
--   pending --approve--> approved (stock leaves the branch: 'damage');  pending --reject--> rejected
--   Admin, warehouse manager, or the branch's supervisor.
-- ============================================

CREATE OR REPLACE FUNCTION public.damage_create(
  p_branch_id uuid,
  p_item_id uuid,
  p_quantity numeric,
  p_reason_id uuid,
  p_unit_cost numeric DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_image_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  v_qty numeric := round(COALESCE(p_quantity, 0), 3);
  v_item record;
  v_cost numeric;
  v_avail numeric;
  v_id uuid;
  v_number text;
BEGIN
  IF p_branch_id IS NULL OR p_item_id IS NULL OR p_reason_id IS NULL THEN
    RAISE EXCEPTION 'يرجى ملء جميع الحقول المطلوبة' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'يمكنك تسجيل التالف لفرعك فقط' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id AND status = 'active') THEN
    RAISE EXCEPTION 'الفرع غير موجود أو غير نشط' USING ERRCODE = 'P0001';
  END IF;
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر' USING ERRCODE = 'P0001';
  END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN
    RAISE EXCEPTION 'تكلفة الوحدة لا يمكن أن تكون سالبة' USING ERRCODE = 'P0001';
  END IF;
  SELECT id, name_ar, purchase_price INTO v_item FROM items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM damage_reasons WHERE id = p_reason_id) THEN
    RAISE EXCEPTION 'سبب التلف غير موجود' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE((SELECT quantity FROM inventory WHERE branch_id = p_branch_id AND item_id = p_item_id), 0) INTO v_avail;
  IF v_avail < v_qty THEN
    RAISE EXCEPTION 'الكمية غير كافية للصنف "%": المتاح % والمطلوب %', v_item.name_ar, trim_scale(v_avail), trim_scale(v_qty)
      USING ERRCODE = 'P0001', HINT = 'INSUFFICIENT_STOCK';
  END IF;

  v_cost := COALESCE(p_unit_cost, v_item.purchase_price, 0);  -- unit costs keep their precision (per-gram prices); totals are rounded
  v_number := public.next_document_number('DMG');
  INSERT INTO damages (damage_number, branch_id, item_id, quantity, unit_cost, total_cost, reason_id, description,
                       image_url, status, registered_by, registered_at)
  VALUES (v_number, p_branch_id, p_item_id, v_qty, v_cost, round(v_qty * v_cost, 2), p_reason_id,
          NULLIF(btrim(COALESCE(p_description, '')), ''), NULLIF(btrim(COALESCE(p_image_url, '')), ''),
          'pending', v_user, now())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'damage_number', v_number, 'item_name', v_item.name_ar, 'quantity', v_qty);
END $$;

CREATE OR REPLACE FUNCTION public.damage_approve(p_damage_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  d damages%ROWTYPE;
BEGIN
  SELECT * INTO d FROM damages WHERE id = p_damage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'سجل التالف غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF d.status <> 'pending' THEN
    RAISE EXCEPTION 'لا يمكن الموافقة: حالة التالف الآن "%". حدّث الصفحة', public.transfer_status_ar(d.status::text)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(d.branch_id) THEN
    RAISE EXCEPTION 'يمكنك الموافقة على تالف فرعك فقط' USING ERRCODE = '42501';
  END IF;

  -- Raises (HINT INSUFFICIENT_STOCK) when the branch no longer holds the quantity; nothing is changed then.
  PERFORM public.stock_adjust(d.branch_id, d.item_id, -d.quantity, 'damage', 'damage', d.id,
                              'تالف ' || d.damage_number, d.unit_cost, true);

  UPDATE damages SET status = 'approved', approved_by = v_user, approved_at = now(), updated_at = now() WHERE id = d.id;

  RETURN jsonb_build_object('id', d.id, 'damage_number', d.damage_number, 'status', 'approved');
END $$;

CREATE OR REPLACE FUNCTION public.damage_reject(p_damage_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  d damages%ROWTYPE;
BEGIN
  SELECT * INTO d FROM damages WHERE id = p_damage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'سجل التالف غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF d.status <> 'pending' THEN
    RAISE EXCEPTION 'لا يمكن الرفض: حالة التالف الآن "%". حدّث الصفحة', public.transfer_status_ar(d.status::text)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(d.branch_id) THEN
    RAISE EXCEPTION 'يمكنك رفض تالف فرعك فقط' USING ERRCODE = '42501';
  END IF;

  UPDATE damages
  SET status = 'rejected', rejected_by = v_user, rejected_at = now(),
      rejection_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''), updated_at = now()
  WHERE id = d.id;

  RETURN jsonb_build_object('id', d.id, 'damage_number', d.damage_number, 'status', 'rejected');
END $$;

-- ============================================
-- RECIPES (items with is_recipe = true) and PRODUCTION
-- ============================================

-- Creates (p_recipe_item_id NULL) or updates a recipe item and REPLACES its ingredients, in one transaction.
-- p_ingredients: [{ "ingredient_item_id": uuid, "quantity": number, "unit_id": uuid?, "notes": text? }]
-- An ingredient's unit must convert to that item's stock unit (g <-> kg, ml <-> L, dozen <-> piece, or the same unit).
-- An empty p_code generates RCP-YYYYMM-00001; a NULL p_category_id uses the 'CAT-RECIPE' category when it exists.
CREATE OR REPLACE FUNCTION public.recipe_save(
  p_recipe_item_id uuid,
  p_code text,
  p_name text,
  p_name_ar text,
  p_unit_id uuid,
  p_category_id uuid,
  p_ingredients jsonb,
  p_description text DEFAULT NULL,
  p_min_stock_level numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin');
  v_id uuid := p_recipe_item_id;
  v_code text := NULLIF(btrim(COALESCE(p_code, '')), '');
  v_name_ar text := NULLIF(btrim(COALESCE(p_name_ar, '')), '');
  v_category uuid := p_category_id;
  v_min numeric := round(COALESCE(p_min_stock_level, 0), 3);
  r record;
BEGIN
  IF v_name_ar IS NULL THEN
    RAISE EXCEPTION 'يرجى إدخال اسم الريسبي' USING ERRCODE = 'P0001';
  END IF;
  IF p_unit_id IS NULL OR NOT EXISTS (SELECT 1 FROM units WHERE id = p_unit_id) THEN
    RAISE EXCEPTION 'يرجى اختيار وحدة القياس للريسبي' USING ERRCODE = 'P0001';
  END IF;
  IF v_category IS NULL THEN
    SELECT id INTO v_category FROM categories WHERE code IN ('CAT-RECIPE', 'RECIPE') ORDER BY code LIMIT 1;
  END IF;
  IF v_category IS NULL OR NOT EXISTS (SELECT 1 FROM categories WHERE id = v_category) THEN
    RAISE EXCEPTION 'يرجى اختيار مجموعة الريسبي' USING ERRCODE = 'P0001';
  END IF;
  IF v_min < 0 THEN
    RAISE EXCEPTION 'الحد الأدنى للمخزون لا يمكن أن يكون سالباً' USING ERRCODE = 'P0001';
  END IF;
  IF p_ingredients IS NULL OR jsonb_typeof(p_ingredients) <> 'array' OR jsonb_array_length(p_ingredients) = 0 THEN
    RAISE EXCEPTION 'يجب إضافة مكون واحد على الأقل' USING ERRCODE = 'P0001';
  END IF;

  IF v_id IS NOT NULL THEN
    -- Locks the recipe: a production running at the same time waits for the new ingredients (or finishes first).
    PERFORM 1 FROM items WHERE id = v_id AND is_recipe FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الريسبي غير موجود' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_code IS NULL THEN
    v_code := public.next_document_number('RCP');
  END IF;
  IF EXISTS (SELECT 1 FROM items WHERE code = v_code AND id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'الكود "%" مستخدم لصنف آخر', v_code USING ERRCODE = 'P0001';
  END IF;

  -- Validate every ingredient line.
  FOR r IN
    SELECT (e->>'ingredient_item_id')::uuid AS item_id, (e->>'quantity')::numeric AS qty,
           NULLIF(e->>'unit_id', '')::uuid AS unit_id, ord,
           i.id AS found_id, i.name_ar, i.is_recipe, i.unit_id AS stock_unit,
           fu.name_ar AS unit_name, su.name_ar AS stock_unit_name
    FROM jsonb_array_elements(p_ingredients) WITH ORDINALITY AS x(e, ord)
    LEFT JOIN items i ON i.id = (e->>'ingredient_item_id')::uuid
    LEFT JOIN units fu ON fu.id = NULLIF(e->>'unit_id', '')::uuid
    LEFT JOIN units su ON su.id = i.unit_id
    ORDER BY ord
  LOOP
    IF r.item_id IS NULL OR r.found_id IS NULL THEN
      RAISE EXCEPTION 'مكون غير موجود في السطر %', r.ord USING ERRCODE = 'P0001';
    END IF;
    IF r.item_id = v_id THEN
      RAISE EXCEPTION 'لا يمكن أن يكون الريسبي مكوناً لنفسه' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(r.is_recipe, false) THEN
      RAISE EXCEPTION 'الصنف "%" ريسبي ولا يمكن استخدامه كمكون', r.name_ar USING ERRCODE = 'P0001';
    END IF;
    IF r.qty IS NULL OR round(r.qty, 3) <= 0 THEN
      RAISE EXCEPTION 'كمية المكون "%" يجب أن تكون أكبر من صفر', r.name_ar USING ERRCODE = 'P0001';
    END IF;
    IF r.unit_id IS NOT NULL AND r.unit_name IS NULL THEN
      RAISE EXCEPTION 'وحدة المكون "%" غير موجودة', r.name_ar USING ERRCODE = 'P0001';
    END IF;
    IF public.recipe_unit_factor(r.unit_id, r.stock_unit) IS NULL THEN
      RAISE EXCEPTION 'وحدة المكون "%" (%) لا يمكن تحويلها إلى وحدة مخزونه (%)', r.name_ar, r.unit_name, r.stock_unit_name
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  SELECT i.name_ar INTO r
  FROM jsonb_array_elements(p_ingredients) e
  JOIN items i ON i.id = (e->>'ingredient_item_id')::uuid
  GROUP BY i.id, i.name_ar
  HAVING count(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'المكون "%" مكرر في الريسبي، اجمع كميته في سطر واحد', r.name_ar USING ERRCODE = 'P0001';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO items (code, name, name_ar, description, unit_id, category_id, min_stock_level,
                       purchase_price, selling_price, is_recipe, status, created_by)
    VALUES (v_code, COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), v_name_ar), v_name_ar,
            NULLIF(btrim(COALESCE(p_description, '')), ''), p_unit_id, v_category, v_min, 0, 0, true, 'active', v_user)
    RETURNING id INTO v_id;
  ELSE
    UPDATE items
    SET code = v_code, name = COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), v_name_ar), name_ar = v_name_ar,
        description = NULLIF(btrim(COALESCE(p_description, '')), ''), unit_id = p_unit_id, category_id = v_category,
        min_stock_level = v_min, updated_at = now()
    WHERE id = v_id;
    DELETE FROM recipe_ingredients WHERE recipe_item_id = v_id;
  END IF;

  INSERT INTO recipe_ingredients (recipe_item_id, ingredient_item_id, quantity, unit_id, notes)
  SELECT v_id, (e->>'ingredient_item_id')::uuid, round((e->>'quantity')::numeric, 3), NULLIF(e->>'unit_id', '')::uuid,
         NULLIF(btrim(COALESCE(e->>'notes', '')), '')
  FROM jsonb_array_elements(p_ingredients) e;

  RETURN jsonb_build_object('id', v_id, 'code', v_code);
END $$;

-- Produces p_quantity units of a recipe in a branch: deducts every ingredient (converted to its stock unit) and adds
-- the recipe item, all or nothing, and logs it. A repeated p_request_id returns the first result without producing again.
CREATE OR REPLACE FUNCTION public.recipe_produce(
  p_recipe_item_id uuid,
  p_branch_id uuid,
  p_quantity numeric,
  p_notes text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor', 'chef');
  v_qty numeric := round(COALESCE(p_quantity, 0), 3);
  v_recipe record;
  v_log_id uuid;
  v_number text;
  v_short text := '';
  v_avail numeric;
  v_cost numeric := 0;
  v_lines int := 0;
  v_note text;
  r record;
BEGIN
  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id AND status = 'active') THEN
    RAISE EXCEPTION 'يرجى اختيار الفرع' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'يمكنك التصنيع في فرعك فقط' USING ERRCODE = '42501';
  END IF;
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر' USING ERRCODE = 'P0001';
  END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT id, production_number INTO v_log_id, v_number FROM production_logs WHERE request_id = p_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object('id', v_log_id, 'production_number', v_number, 'duplicate', true);
    END IF;
  END IF;

  -- FOR SHARE: recipe_save waits until this production is done, so the ingredient list cannot change mid-way.
  SELECT id, name_ar, is_recipe, status::text AS status INTO v_recipe FROM items WHERE id = p_recipe_item_id FOR SHARE;
  IF NOT FOUND OR NOT COALESCE(v_recipe.is_recipe, false) THEN
    RAISE EXCEPTION 'الريسبي غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF v_recipe.status <> 'active' THEN
    RAISE EXCEPTION 'الريسبي "%" غير نشط', v_recipe.name_ar USING ERRCODE = 'P0001';
  END IF;

  -- The log row first (its id is the stock movements' reference). A concurrent call with the same request id
  -- waits here and then returns the first result.
  v_number := public.next_document_number('PRD');
  INSERT INTO production_logs (production_number, recipe_item_id, branch_id, quantity, notes, produced_by, produced_at, request_id)
  VALUES (v_number, p_recipe_item_id, p_branch_id, v_qty, NULLIF(btrim(COALESCE(p_notes, '')), ''), v_user, now(), p_request_id)
  ON CONFLICT (request_id) WHERE request_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_log_id;
  IF v_log_id IS NULL THEN
    SELECT id, production_number INTO v_log_id, v_number FROM production_logs WHERE request_id = p_request_id;
    RETURN jsonb_build_object('id', v_log_id, 'production_number', v_number, 'duplicate', true);
  END IF;

  -- Lock the ingredient rows and the recipe's own row in the global order (item, then branch): see transfer_receive.
  PERFORM 1 FROM inventory
  WHERE branch_id = p_branch_id
    AND (item_id = p_recipe_item_id
         OR item_id IN (SELECT ri.ingredient_item_id FROM recipe_ingredients ri WHERE ri.recipe_item_id = p_recipe_item_id))
  ORDER BY item_id, branch_id
  FOR UPDATE;

  -- Requirements in each ingredient's stock unit; check them all before moving anything.
  FOR r IN
    SELECT ri.ingredient_item_id AS item_id, i.name_ar,
           round(SUM(ri.quantity * public.recipe_unit_factor(ri.unit_id, i.unit_id)) * v_qty, 3) AS required,
           bool_or(public.recipe_unit_factor(ri.unit_id, i.unit_id) IS NULL) AS bad_unit
    FROM recipe_ingredients ri JOIN items i ON i.id = ri.ingredient_item_id
    WHERE ri.recipe_item_id = p_recipe_item_id
    GROUP BY ri.ingredient_item_id, i.name_ar
    ORDER BY ri.ingredient_item_id
  LOOP
    v_lines := v_lines + 1;
    IF r.item_id = p_recipe_item_id THEN
      RAISE EXCEPTION 'لا يمكن أن يكون الريسبي مكوناً لنفسه، عدّل مكوناته' USING ERRCODE = 'P0001';
    END IF;
    IF r.bad_unit THEN
      RAISE EXCEPTION 'وحدة المكون "%" لا يمكن تحويلها إلى وحدة مخزونه، عدّل الريسبي', r.name_ar USING ERRCODE = 'P0001';
    END IF;
    SELECT quantity INTO v_avail FROM inventory WHERE branch_id = p_branch_id AND item_id = r.item_id FOR UPDATE;
    v_avail := COALESCE(v_avail, 0);
    IF r.required < 0 THEN
      RAISE EXCEPTION 'كمية المكون "%" غير صحيحة، عدّل الريسبي', r.name_ar USING ERRCODE = 'P0001';
    END IF;
    IF v_avail < r.required THEN
      v_short := v_short || E'\n' || r.name_ar || ': المتاح ' || trim_scale(v_avail) || ' والمطلوب ' || trim_scale(r.required);
    END IF;
  END LOOP;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'لا توجد مكونات لهذا الريسبي' USING ERRCODE = 'P0001';
  END IF;
  IF v_short <> '' THEN
    RAISE EXCEPTION 'المكونات غير كافية:%', v_short USING ERRCODE = 'P0001', HINT = 'INSUFFICIENT_STOCK';
  END IF;

  v_note := 'إنتاج ' || v_number;
  FOR r IN
    SELECT ri.ingredient_item_id AS item_id, i.purchase_price,
           round(SUM(ri.quantity * public.recipe_unit_factor(ri.unit_id, i.unit_id)) * v_qty, 3) AS required
    FROM recipe_ingredients ri JOIN items i ON i.id = ri.ingredient_item_id
    WHERE ri.recipe_item_id = p_recipe_item_id
    GROUP BY ri.ingredient_item_id, i.purchase_price
    ORDER BY ri.ingredient_item_id
  LOOP
    CONTINUE WHEN r.required <= 0;
    PERFORM public.stock_adjust(p_branch_id, r.item_id, -r.required, 'production', 'production', v_log_id, v_note,
                                r.purchase_price, false);
    v_cost := v_cost + r.required * COALESCE(r.purchase_price, 0);
  END LOOP;
  PERFORM public.stock_adjust(p_branch_id, p_recipe_item_id, v_qty, 'production', 'production', v_log_id, v_note,
                              round(v_cost / v_qty, 4), true);

  RETURN jsonb_build_object('id', v_log_id, 'production_number', v_number, 'duplicate', false,
    'quantity', v_qty, 'recipe_name', v_recipe.name_ar);
END $$;

-- ---------- API grants ----------
REVOKE ALL ON FUNCTION public.transfer_create(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_create(uuid, uuid, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.transfer_approve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_approve(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.transfer_reject(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_reject(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.transfer_receive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_receive(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.return_branch_create(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_branch_create(uuid, text, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.return_branch_approve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_branch_approve(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.return_branch_reject(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_branch_reject(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.return_branch_ship(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_branch_ship(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.return_branch_receive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_branch_receive(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.return_supplier_create(uuid, jsonb, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_supplier_create(uuid, jsonb, text, text, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.return_supplier_approve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_supplier_approve(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.return_supplier_complete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_supplier_complete(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.return_supplier_reject(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_supplier_reject(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.damage_create(uuid, uuid, numeric, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.damage_create(uuid, uuid, numeric, uuid, numeric, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.damage_approve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.damage_approve(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.damage_reject(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.damage_reject(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.recipe_save(uuid, text, text, text, uuid, uuid, jsonb, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recipe_save(uuid, text, text, text, uuid, uuid, jsonb, text, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.recipe_produce(uuid, uuid, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recipe_produce(uuid, uuid, numeric, text, uuid) TO authenticated;
