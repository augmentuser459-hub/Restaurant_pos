-- ============================================
-- 020: POS checkout, orders, shifts and stock deduction for sales. Idempotent; safe to re-run.
--   * pos_checkout: the whole sale in ONE transaction: server prices, totals, cash check, order + lines,
--     stock via stock_adjust, order number. A client idempotency key makes a retry return the same order.
--     The order is saved as 'preparing', or as 'delivered' when nothing in it is for the kitchen (drinks only).
--   * orders.stock_deducted_at / order_items.stock_deducted_qty: what a sale currently holds from stock.
--     The orders trigger takes stock once when an order becomes paid through any other path and gives it
--     back once when the order is cancelled, so stock can never be deducted twice.
--   * order_update / order_add_item / order_update_item / order_remove_item: admin edits that keep stock,
--     totals (the discount reduces the total) and closed-shift totals in step.
--   * shift_open / shift_close / shift_recalculate: one open shift per cashier; totals computed here from
--     the shift's PAID orders, per payment method.
--   * pos_sellable_items / pos_cashier_categories: what the caller may sell, at server prices, and which
--     categories a cashier may browse (restrictions fail closed).
--   * Data fixes: close duplicate open shifts; back-fill stock for sales paid after commit 823f8c5
--     (2026-10-20 21:20 Cairo) that never had stock deducted.
--
-- "Paid order" everywhere below: paid_at IS NOT NULL AND status NOT IN ('new', 'pending_payment', 'cancelled').
-- Items with NO inventory row in the branch are sold without stock tracking (as the old trigger did, e.g.
-- recipes made to order). Items WITH a row can never go below zero (stock_adjust raises an Arabic error).
-- order_items.quantity stays INTEGER: the POS sells whole units; the functions reject fractions.
-- ============================================

-- ---------- 1. Columns (all nullable: the go-live reload inserts old rows without them) ----------

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stock_deducted_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS client_request_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS paid_amount numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS change_amount numeric;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS stock_deducted_qty numeric;
ALTER TABLE public.cashier_shifts ADD COLUMN IF NOT EXISTS visa_sales numeric;
ALTER TABLE public.cashier_shifts ADD COLUMN IF NOT EXISTS instapay_sales numeric;
ALTER TABLE public.cashier_shifts ADD COLUMN IF NOT EXISTS wallet_sales numeric;

COMMENT ON COLUMN public.orders.stock_deducted_at IS
  'When this sale took its stock from the branch. NULL = holds no stock (unpaid, cancelled, or old data under review in pos_backfill_issues).';
COMMENT ON COLUMN public.orders.client_request_id IS 'Idempotency key sent by the POS for one checkout; a retry returns the same order.';
COMMENT ON COLUMN public.orders.paid_amount IS 'Amount the customer handed over (cash) or the total (other methods).';
COMMENT ON COLUMN public.orders.change_amount IS 'Change given back for cash payments.';
COMMENT ON COLUMN public.order_items.stock_deducted_qty IS
  'Quantity of this line currently taken from stock: 0 = untracked (no stock row) or given back; NULL = old line, see stock_deducted_at.';
COMMENT ON COLUMN public.cashier_shifts.card_sales IS 'All non-cash sales (visa + instapay + wallet).';

CREATE UNIQUE INDEX IF NOT EXISTS orders_client_request_id_key
  ON public.orders (client_request_id) WHERE client_request_id IS NOT NULL;

-- Order lines are always read by order (receipts, kitchen, order screens, reports, stock functions), and the
-- kitchen screen polls a branch's orders changed since its last read.
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_orders_branch_updated ON public.orders (branch_id, updated_at);

-- ---------- 2. Tables ----------

-- Per-branch daily order counter: order numbers like ORD-261021-BR002-007 (the kitchen calls out "007").
CREATE TABLE IF NOT EXISTS public.pos_order_counters (
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id, business_date)
);
ALTER TABLE public.pos_order_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_order_counters FROM anon, authenticated;

-- Review list for the stock back-fill: lines that could not be deducted, and orders whose history is ambiguous.
CREATE TABLE IF NOT EXISTS public.pos_backfill_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES public.order_items(id) ON DELETE CASCADE,
  item_id uuid,
  reason text NOT NULL CHECK (reason IN ('insufficient_stock', 'ambiguous_flow')),
  quantity numeric,
  available numeric,
  details text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_backfill_issues_key
  ON public.pos_backfill_issues (order_id, order_item_id, reason) NULLS NOT DISTINCT;
ALTER TABLE public.pos_backfill_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_backfill_issues FROM anon, authenticated;

-- ---------- 3. Internal helpers (not callable from the API) ----------

-- What a branch sells and at which price. Same rule as the cashier screen:
--   managed items: the branch's branch_pos_items row (available, item active), at that row's price;
--   auto items: items in stock in the branch with NO branch_pos_items row, at selling_price, else purchase_price.
-- Nothing is ever sold for 0 EGP: an item whose price (rounded to 2 decimals, as the checkout charges it) is not
-- above 0 is not in the catalog, so the cashier never sees it and pos_checkout refuses it.
CREATE OR REPLACE FUNCTION public.pos_item_catalog(p_branch_id uuid, p_item_id uuid DEFAULT NULL)
RETURNS TABLE (
  item_id uuid, code text, barcode text, name text, name_ar text, category_id uuid, is_recipe boolean,
  image_url text, unit_cost numeric, price numeric, has_stock_row boolean, stock_quantity numeric,
  in_stock boolean, display_order integer, is_managed boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.code::text, i.barcode::text, i.name::text, i.name_ar::text, i.category_id,
         COALESCE(i.is_recipe, false), i.image_url, i.purchase_price,
         round(CASE WHEN bpi.id IS NOT NULL THEN bpi.price
                    ELSE COALESCE(NULLIF(i.selling_price, 0), NULLIF(i.purchase_price, 0), 0) END, 2),
         inv.id IS NOT NULL,
         COALESCE(inv.quantity, 0),
         -- tracked items need stock; untracked recipes are made to order
         CASE WHEN inv.id IS NOT NULL THEN inv.quantity > 0 ELSE COALESCE(i.is_recipe, false) END,
         CASE WHEN bpi.id IS NOT NULL THEN COALESCE(bpi.display_order, 0) ELSE 999 END,
         bpi.id IS NOT NULL
  FROM items i
  LEFT JOIN branch_pos_items bpi ON bpi.branch_id = p_branch_id AND bpi.item_id = i.id
  LEFT JOIN inventory inv ON inv.branch_id = p_branch_id AND inv.item_id = i.id
  WHERE i.status = 'active'
    AND (p_item_id IS NULL OR i.id = p_item_id)
    AND (bpi.is_available IS TRUE OR (bpi.id IS NULL AND inv.quantity > 0))
    AND round(CASE WHEN bpi.id IS NOT NULL THEN bpi.price
                   ELSE COALESCE(NULLIF(i.selling_price, 0), NULLIF(i.purchase_price, 0), 0) END, 2) > 0
$$;

-- Categories a cashier may sell from. NULL = unrestricted (not a cashier, or no permission rows).
-- A restricted cashier gets only active permitted categories; items without a category are not allowed.
CREATE OR REPLACE FUNCTION public.pos_allowed_category_ids(p_user_id uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id
                     WHERE u.id = p_user_id AND r.name = 'cashier') THEN NULL
    WHEN NOT EXISTS (SELECT 1 FROM cashier_category_permissions WHERE user_id = p_user_id) THEN NULL
    ELSE ARRAY(SELECT c.id FROM cashier_category_permissions p JOIN categories c ON c.id = p.category_id
               WHERE p.user_id = p_user_id AND c.is_active IS TRUE)
  END
$$;

-- The counter row stays locked until the sale commits, so numbers are handed out one at a time per branch.
-- Self-healing: if the counter is behind numbers already used (counter row deleted or reset, partial restore),
-- it jumps past the highest one instead of failing every sale of that branch for the rest of the day.
CREATE OR REPLACE FUNCTION public.pos_next_order_number(p_branch_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_n integer;
  v_max integer;
  v_code text;
  v_prefix text;
  v_number text;
BEGIN
  INSERT INTO pos_order_counters (branch_id, business_date, last_value) VALUES (p_branch_id, v_day, 1)
  ON CONFLICT (branch_id, business_date) DO UPDATE SET last_value = pos_order_counters.last_value + 1
  RETURNING last_value INTO v_n;
  SELECT left(NULLIF(btrim(code), ''), 16) INTO v_code FROM branches WHERE id = p_branch_id;
  v_prefix := 'ORD-' || to_char(v_day, 'YYMMDD') || '-' || COALESCE(v_code, left(p_branch_id::text, 8)) || '-';
  -- at least 3 digits (lpad alone would cut 1000 down to '100')
  v_number := v_prefix || CASE WHEN v_n < 1000 THEN lpad(v_n::text, 3, '0') ELSE v_n::text END;

  IF EXISTS (SELECT 1 FROM orders WHERE order_number = v_number) THEN
    SELECT max(substr(order_number, length(v_prefix) + 1)::integer) INTO v_max
    FROM orders
    WHERE left(order_number, length(v_prefix)) = v_prefix
      AND substr(order_number, length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
    v_n := GREATEST(v_n, COALESCE(v_max, 0) + 1);
    LOOP
      v_number := v_prefix || CASE WHEN v_n < 1000 THEN lpad(v_n::text, 3, '0') ELSE v_n::text END;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM orders WHERE order_number = v_number);
      v_n := v_n + 1;
    END LOOP;
    UPDATE pos_order_counters SET last_value = v_n WHERE branch_id = p_branch_id AND business_date = v_day;
  END IF;
  RETURN v_number;
END $$;

-- The order as the POS needs it for the receipt.
CREATE OR REPLACE FUNCTION public.pos_order_summary(p_order_id uuid, p_duplicate boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', o.id, 'order_number', o.order_number, 'status', o.status, 'branch_id', o.branch_id,
    'shift_id', o.shift_id, 'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
    'total_amount', o.total_amount, 'payment_method', o.payment_method, 'paid_amount', o.paid_amount,
    'change_amount', o.change_amount, 'created_at', o.created_at, 'paid_at', o.paid_at,
    'duplicate', p_duplicate,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', oi.id, 'item_id', oi.item_id, 'name_ar', i.name_ar, 'quantity', oi.quantity,
               'unit_price', oi.unit_price, 'total_price', oi.total_price, 'notes', oi.notes)
             ORDER BY oi.created_at, oi.id)
      FROM order_items oi LEFT JOIN items i ON i.id = oi.item_id
      WHERE oi.order_id = o.id), '[]'::jsonb))
  FROM orders o WHERE o.id = p_order_id
$$;

-- Takes (p_direction < 0) or gives back (p_direction > 0) the stock of every line of an order.
-- Taking: whole line quantity; lines without a stock row are recorded as untracked (0).
-- Giving back: what the line holds (stock_deducted_qty, or the quantity for old lines whose stock row exists).
-- Lines are processed in item order so concurrent sales lock stock rows in the same order.
CREATE OR REPLACE FUNCTION public.pos_order_stock_apply(
  p_order_id uuid, p_branch_id uuid, p_direction integer, p_reference_type text, p_label text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_after numeric;
  v_held numeric;
BEGIN
  FOR r IN
    SELECT oi.id, oi.item_id, oi.quantity, oi.stock_deducted_qty, i.purchase_price
    FROM order_items oi JOIN items i ON i.id = oi.item_id
    WHERE oi.order_id = p_order_id
    ORDER BY oi.item_id, oi.id
  LOOP
    IF p_direction < 0 THEN
      v_after := stock_adjust(p_branch_id, r.item_id, -r.quantity, 'sale', p_reference_type, p_order_id,
                              'بيع ' || p_label, r.purchase_price, false);
      UPDATE order_items SET stock_deducted_qty = CASE WHEN v_after IS NULL THEN 0 ELSE r.quantity END
      WHERE id = r.id;
    ELSE
      v_held := COALESCE(r.stock_deducted_qty, r.quantity);
      IF v_held > 0 THEN
        PERFORM stock_adjust(p_branch_id, r.item_id, v_held, 'sale', p_reference_type, p_order_id,
                             'إلغاء ' || p_label, r.purchase_price, r.stock_deducted_qty IS NOT NULL);
      END IF;
      UPDATE order_items SET stock_deducted_qty = 0 WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- Recomputes a shift's totals from its paid orders. For a closed shift also expected amount and difference.
CREATE OR REPLACE FUNCTION public.shift_apply_totals(p_shift_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v record;
BEGIN
  SELECT round(COALESCE(sum(o.total_amount) FILTER (WHERE o.payment_method = 'cash'), 0), 2) AS cash,
         round(COALESCE(sum(o.total_amount) FILTER (WHERE o.payment_method = 'visa'), 0), 2) AS visa,
         round(COALESCE(sum(o.total_amount) FILTER (WHERE o.payment_method = 'instapay'), 0), 2) AS instapay,
         round(COALESCE(sum(o.total_amount) FILTER (WHERE o.payment_method = 'wallet'), 0), 2) AS wallet,
         round(COALESCE(sum(o.total_amount), 0), 2) AS total,
         count(*) AS cnt
  INTO v
  FROM orders o
  WHERE o.shift_id = p_shift_id AND o.paid_at IS NOT NULL
    AND o.status NOT IN ('new', 'pending_payment', 'cancelled');

  UPDATE cashier_shifts s SET
    cash_sales = v.cash,
    visa_sales = v.visa,
    instapay_sales = v.instapay,
    wallet_sales = v.wallet,
    card_sales = v.visa + v.instapay + v.wallet,
    total_sales = v.total,
    orders_count = v.cnt,
    expected_amount = CASE WHEN s.status = 'closed'
                           THEN round(COALESCE(s.opening_amount, 0) + v.cash, 2) ELSE s.expected_amount END,
    difference = CASE WHEN s.status = 'closed' AND s.closing_amount IS NOT NULL
                      THEN round(s.closing_amount - (COALESCE(s.opening_amount, 0) + v.cash), 2)
                      ELSE s.difference END,
    updated_at = now()
  WHERE s.id = p_shift_id;
END $$;

-- After item edits: subtotal from the lines, total = subtotal + tax - discount; closed shift recomputed.
CREATE OR REPLACE FUNCTION public.pos_order_recalc(p_order_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_o orders%ROWTYPE;
  v_sub numeric;
BEGIN
  SELECT * INTO v_o FROM orders WHERE id = p_order_id FOR UPDATE;
  SELECT round(COALESCE(sum(total_price), 0), 2) INTO v_sub FROM order_items WHERE order_id = p_order_id;
  IF COALESCE(v_o.discount_amount, 0) > v_sub + COALESCE(v_o.tax_amount, 0) THEN
    RAISE EXCEPTION 'الخصم (%) أكبر من إجمالي الأوردر بعد التعديل (%). قلّل الخصم أولاً',
      to_char(v_o.discount_amount, 'FM999999990.00'), to_char(v_sub, 'FM999999990.00') USING ERRCODE = 'P0001';
  END IF;
  UPDATE orders SET
    subtotal = v_sub,
    total_amount = round(v_sub + COALESCE(tax_amount, 0) - COALESCE(discount_amount, 0), 2),
    updated_at = now()
  WHERE id = p_order_id;
  IF v_o.shift_id IS NOT NULL AND EXISTS (SELECT 1 FROM cashier_shifts WHERE id = v_o.shift_id AND status = 'closed') THEN
    PERFORM shift_apply_totals(v_o.shift_id);
  END IF;
END $$;

-- Stock held by one order line, for edits of a paid (deducted) order: 0 = untracked.
CREATE OR REPLACE FUNCTION public.pos_line_held_qty(p_branch_id uuid, p_item_id uuid, p_quantity numeric, p_deducted numeric)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_item_id IS NULL THEN 0
    WHEN p_deducted IS NOT NULL THEN p_deducted
    -- old line: the old trigger deducted it when the branch had a stock row for it
    WHEN EXISTS (SELECT 1 FROM inventory WHERE branch_id = p_branch_id AND item_id = p_item_id) THEN p_quantity
    ELSE 0
  END
$$;

-- Back-fill: takes the stock of one old paid order that never had it taken. A line that would go below zero
-- is skipped and listed in pos_backfill_issues instead of failing.
CREATE OR REPLACE FUNCTION public.pos_backfill_deduct_order(p_order_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_o orders%ROWTYPE;
  r record;
  v_after numeric;
  v_avail numeric;
  v_hint text;
  v_note text;
  v_skipped integer := 0;
BEGIN
  SELECT * INTO v_o FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_o.stock_deducted_at IS NOT NULL THEN
    RETURN 0;
  END IF;
  v_note := 'خصم متأخر لبيع ' || v_o.order_number;
  FOR r IN
    SELECT oi.id, oi.item_id, oi.quantity, i.purchase_price
    FROM order_items oi JOIN items i ON i.id = oi.item_id
    WHERE oi.order_id = p_order_id
    ORDER BY oi.item_id, oi.id
  LOOP
    BEGIN
      v_after := stock_adjust(v_o.branch_id, r.item_id, -r.quantity, 'sale', 'order', p_order_id,
                              v_note, r.purchase_price, false);
      -- stock_adjust logs only for a logged-in caller; during the migration log it for the order's cashier
      IF v_after IS NOT NULL AND app_user_id() IS NULL THEN
        INSERT INTO inventory_transactions
          (branch_id, item_id, operation_type, quantity, quantity_before, quantity_after,
           unit_cost, reference_type, reference_id, notes, created_by)
        VALUES
          (v_o.branch_id, r.item_id, 'sale', -r.quantity, v_after + r.quantity, v_after,
           r.purchase_price, 'order', p_order_id, v_note, v_o.cashier_id);
      END IF;
      UPDATE order_items SET stock_deducted_qty = CASE WHEN v_after IS NULL THEN 0 ELSE r.quantity END
      WHERE id = r.id;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF v_hint IS DISTINCT FROM 'INSUFFICIENT_STOCK' THEN
        RAISE;
      END IF;
      SELECT quantity INTO v_avail FROM inventory WHERE branch_id = v_o.branch_id AND item_id = r.item_id;
      INSERT INTO pos_backfill_issues (order_id, order_item_id, item_id, reason, quantity, available, details)
      VALUES (p_order_id, r.id, r.item_id, 'insufficient_stock', r.quantity, v_avail, SQLERRM)
      ON CONFLICT DO NOTHING;
      UPDATE order_items SET stock_deducted_qty = 0 WHERE id = r.id;
      v_skipped := v_skipped + 1;
    END;
  END LOOP;
  UPDATE orders SET stock_deducted_at = now() WHERE id = p_order_id;
  RETURN v_skipped;
END $$;

-- ---------- 4. Triggers ----------

-- The old trigger deducted on every transition into 'paid' (twice on a re-entry, never restored on cancel)
-- and never fires since payment goes straight to 'preparing'. Replaced by orders_stock_guard below.
DROP TRIGGER IF EXISTS trigger_deduct_inventory_on_payment ON public.orders;
DROP FUNCTION IF EXISTS public.deduct_inventory_on_payment();

-- Safety net for every write path (old app versions still open in a browser, kitchen status changes, edits):
--   * an order that becomes paid without holding stock takes it once (stock_deducted_at guards it);
--   * an order that is cancelled gives back what it holds, once; a cancelled order can't be brought back
--     (e.g. by a stale kitchen screen), so its stock and money stay out.
-- pos_checkout takes the stock itself at insert time, so this never fires for normal POS sales.
CREATE OR REPLACE FUNCTION public.pos_orders_stock_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'هذا الأوردر ملغي ولا يمكن تغيير حالته' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'cancelled' THEN
    IF OLD.status IS DISTINCT FROM 'cancelled' THEN
      IF NEW.stock_deducted_at IS NOT NULL THEN
        PERFORM pos_order_stock_apply(NEW.id, NEW.branch_id, 1, 'order_cancel', NEW.order_number);
        NEW.stock_deducted_at := NULL;
      END IF;
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('new', 'pending_payment')
     AND (OLD.paid_at IS NULL OR OLD.status IN ('new', 'pending_payment'))
     AND NEW.stock_deducted_at IS NULL THEN
    NEW.paid_at := COALESCE(NEW.paid_at, now());
    PERFORM pos_order_stock_apply(NEW.id, NEW.branch_id, -1, 'order', NEW.order_number);
    NEW.stock_deducted_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_stock_guard ON public.orders;
CREATE TRIGGER orders_stock_guard
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.pos_orders_stock_guard();

-- No negative line prices, whatever writes them.
CREATE OR REPLACE FUNCTION public.pos_order_items_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.unit_price IS NULL OR NEW.unit_price < 0 OR NEW.total_price IS NULL OR NEW.total_price < 0 THEN
    RAISE EXCEPTION 'سعر الصنف لا يمكن أن يكون سالباً' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS order_items_guard ON public.order_items;
CREATE TRIGGER order_items_guard
  BEFORE INSERT OR UPDATE OF unit_price, total_price ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.pos_order_items_guard();

-- One open shift per cashier and no negative drawer amounts, whatever writes the row.
-- A trigger (serialized per cashier with an advisory lock) instead of a partial unique index: the go-live
-- reload copies old production in replica mode, where triggers are off but unique indexes still apply, and
-- old production has a cashier with two open shifts. Section 6 closes such duplicates after the reload.
-- Amounts are checked only when they are written (insert or change), so an old row with a bad amount never
-- blocks unrelated updates such as totals recomputed after an order is cancelled.
CREATE OR REPLACE FUNCTION public.shift_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.opening_amount IS DISTINCT FROM OLD.opening_amount)
     AND (NEW.opening_amount IS NULL OR NEW.opening_amount < 0) THEN
    RAISE EXCEPTION 'رصيد الافتتاح يجب أن يكون صفراً أو أكثر' USING ERRCODE = 'P0001';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.closing_amount IS DISTINCT FROM OLD.closing_amount)
     AND NEW.closing_amount < 0 THEN
    RAISE EXCEPTION 'المبلغ الفعلي في الدرج لا يمكن أن يكون سالباً' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'open' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'open'
                              OR OLD.cashier_id IS DISTINCT FROM NEW.cashier_id) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('cashier_shift:' || NEW.cashier_id::text, 0));
    IF EXISTS (SELECT 1 FROM cashier_shifts WHERE cashier_id = NEW.cashier_id AND status = 'open' AND id <> NEW.id) THEN
      RAISE EXCEPTION 'يوجد شيفت مفتوح بالفعل لهذا الكاشير. أغلقه أولاً' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cashier_shifts_guard ON public.cashier_shifts;
CREATE TRIGGER cashier_shifts_guard
  BEFORE INSERT OR UPDATE ON public.cashier_shifts
  FOR EACH ROW EXECUTE FUNCTION public.shift_guard();

-- ---------- 5. API functions ----------

-- Items the caller may sell in a branch (default: own branch), at server prices, cashier restrictions applied.
CREATE OR REPLACE FUNCTION public.pos_sellable_items(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  item_id uuid, code text, barcode text, name text, name_ar text, category_id uuid, is_recipe boolean,
  image_url text, unit_cost numeric, price numeric, has_stock_row boolean, stock_quantity numeric,
  in_stock boolean, display_order integer, is_managed boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := public.app_require_role('cashier', 'admin', 'branch_supervisor');
  v_branch uuid := COALESCE(p_branch_id, public.app_user_branch());
  v_allowed uuid[];
BEGIN
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'لا يوجد فرع مرتبط بحسابك' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(v_branch) THEN
    RAISE EXCEPTION 'لا يمكنك عرض أصناف هذا الفرع' USING ERRCODE = '42501';
  END IF;
  v_allowed := public.pos_allowed_category_ids(v_uid);
  RETURN QUERY
    SELECT c.* FROM public.pos_item_catalog(v_branch) c
    WHERE v_allowed IS NULL OR c.category_id = ANY (v_allowed);
END $$;

-- Categories for the cashier screen: { restricted, categories: [...] }.
CREATE OR REPLACE FUNCTION public.pos_cashier_categories() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.app_require_role('cashier', 'admin', 'branch_supervisor');
  v_allowed uuid[] := public.pos_allowed_category_ids(v_uid);
BEGIN
  RETURN jsonb_build_object(
    'restricted', v_allowed IS NOT NULL,
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'name_ar', c.name_ar,
                                          'sort_order', c.sort_order) ORDER BY c.sort_order, c.name_ar)
      FROM categories c
      WHERE c.is_active IS TRUE AND (v_allowed IS NULL OR c.id = ANY (v_allowed))), '[]'::jsonb));
END $$;

-- The whole sale. p_items: [{ "item_id": uuid, "quantity": whole number > 0, "notes": text }].
-- Prices come from the branch POS list; p_expected_total (what the cashier's screen showed) must match.
-- Cash: p_paid_amount (default = total) must cover the total. Returns pos_order_summary.
CREATE OR REPLACE FUNCTION public.pos_checkout(
  p_shift_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_paid_amount numeric DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL,
  p_expected_total numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.app_require_role('cashier', 'admin');
  v_shift cashier_shifts%ROWTYPE;
  v_existing orders%ROWTYPE;
  v_allowed uuid[];
  v_el jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_note text;
  v_info record;
  v_lines jsonb := '[]'::jsonb;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_total numeric;
  v_paid numeric;
  v_change numeric;
  v_order_id uuid;
  v_number text;
BEGIN
  -- A retry of a checkout that already went through gets that order back instead of a second sale.
  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM orders WHERE client_request_id = p_client_request_id;
    IF FOUND THEN
      IF v_existing.cashier_id <> v_uid THEN
        RAISE EXCEPTION 'رقم العملية مستخدم من قبل' USING ERRCODE = 'P0001';
      END IF;
      RETURN pos_order_summary(v_existing.id, true);
    END IF;
  END IF;

  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'visa', 'instapay', 'wallet') THEN
    RAISE EXCEPTION 'اختر طريقة دفع صحيحة' USING ERRCODE = 'P0001';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'السلة فارغة' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'عدد الأصناف في الطلب كبير جداً' USING ERRCODE = 'P0001';
  END IF;

  -- Only into the caller's own open shift. FOR SHARE: a shift close running at the same time waits for this sale.
  IF p_shift_id IS NOT NULL THEN
    SELECT * INTO v_shift FROM cashier_shifts WHERE id = p_shift_id FOR SHARE;
  END IF;
  IF v_shift.id IS NULL OR v_shift.cashier_id <> v_uid THEN
    RAISE EXCEPTION 'لا يوجد شيفت مفتوح لك. ابدأ شيفت جديد قبل البيع'
      USING ERRCODE = 'P0001', HINT = 'SHIFT_CLOSED';
  END IF;
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'هذا الشيفت مغلق. ابدأ شيفت جديد قبل البيع' USING ERRCODE = 'P0001', HINT = 'SHIFT_CLOSED';
  END IF;
  IF NOT app_can_access_branch(v_shift.branch_id) THEN
    RAISE EXCEPTION 'لا يمكنك البيع في هذا الفرع' USING ERRCODE = '42501';
  END IF;

  v_allowed := pos_allowed_category_ids(v_uid);

  FOR v_el IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_item_id := (v_el ->> 'item_id')::uuid;
      v_qty := (v_el ->> 'quantity')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'بيانات صنف غير صحيحة في السلة' USING ERRCODE = 'P0001';
    END;
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'بيانات صنف غير صحيحة في السلة' USING ERRCODE = 'P0001';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty <> trunc(v_qty) OR v_qty > 100000 THEN
      RAISE EXCEPTION 'الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر' USING ERRCODE = 'P0001';
    END IF;
    v_note := NULLIF(btrim(v_el ->> 'notes'), '');
    IF length(v_note) > 500 THEN
      RAISE EXCEPTION 'ملاحظة الصنف طويلة جداً' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_info FROM pos_item_catalog(v_shift.branch_id, v_item_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الصنف "%" غير متاح للبيع في هذا الفرع',
        COALESCE((SELECT name_ar FROM items WHERE id = v_item_id), v_item_id::text) USING ERRCODE = 'P0001';
    END IF;
    IF v_allowed IS NOT NULL AND (v_info.category_id IS NULL OR NOT (v_info.category_id = ANY (v_allowed))) THEN
      RAISE EXCEPTION 'غير مسموح لك ببيع الصنف "%"', v_info.name_ar USING ERRCODE = 'P0001';
    END IF;
    -- the catalog never lists an item without a price; checked again so no line is ever sold for 0 EGP
    IF v_info.price IS NULL OR NOT (v_info.price > 0) THEN
      RAISE EXCEPTION 'الصنف "%" ليس له سعر بيع في هذا الفرع', v_info.name_ar USING ERRCODE = 'P0001';
    END IF;

    v_line_total := round(v_info.price * v_qty, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'item_id', v_item_id, 'quantity', v_qty, 'unit_price', v_info.price,
      'total_price', v_line_total, 'notes', v_note));
  END LOOP;

  v_subtotal := round(v_subtotal, 2);
  v_total := v_subtotal; -- no tax; no discount at the till (an admin gives discounts in order edit)

  IF p_expected_total IS NOT NULL AND abs(round(p_expected_total, 2) - v_total) >= 0.01 THEN
    RAISE EXCEPTION 'تغيرت أسعار بعض الأصناف. الإجمالي الصحيح %، راجع السلة ثم ادفع مرة أخرى',
      to_char(v_total, 'FM999999990.00') USING ERRCODE = 'P0001', HINT = 'PRICE_CHANGED';
  END IF;

  IF p_payment_method = 'cash' THEN
    v_paid := round(COALESCE(p_paid_amount, v_total), 2);
    IF v_paid < v_total THEN
      RAISE EXCEPTION 'المبلغ المدفوع (%) أقل من الإجمالي (%)',
        to_char(v_paid, 'FM999999990.00'), to_char(v_total, 'FM999999990.00') USING ERRCODE = 'P0001';
    END IF;
    v_change := v_paid - v_total;
  ELSE
    v_paid := v_total;
    v_change := 0;
  END IF;

  v_number := pos_next_order_number(v_shift.branch_id);

  BEGIN
    INSERT INTO orders (order_number, branch_id, cashier_id, shift_id, subtotal, tax_amount, discount_amount,
                        total_amount, payment_method, status, paid_at, notes, paid_amount, change_amount,
                        client_request_id, stock_deducted_at)
    VALUES (v_number, v_shift.branch_id, v_uid, v_shift.id, v_subtotal, 0, 0,
            v_total, p_payment_method::order_payment_method, 'preparing', now(), NULLIF(btrim(p_notes), ''),
            v_paid, v_change, p_client_request_id, now())
    RETURNING id INTO v_order_id;
  EXCEPTION WHEN unique_violation THEN
    -- the same checkout arrived twice at once and the other call saved it first
    SELECT * INTO v_existing FROM orders WHERE client_request_id = p_client_request_id;
    IF FOUND AND v_existing.cashier_id = v_uid THEN
      RETURN pos_order_summary(v_existing.id, true);
    END IF;
    RAISE;
  END;

  INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, notes)
  SELECT v_order_id, (l ->> 'item_id')::uuid, (l ->> 'quantity')::numeric::integer,
         (l ->> 'unit_price')::numeric, (l ->> 'total_price')::numeric, l ->> 'notes'
  FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS t(l, n)
  ORDER BY n;

  PERFORM pos_order_stock_apply(v_order_id, v_shift.branch_id, -1, 'order', v_number);

  -- Nothing for the kitchen to prepare (e.g. drinks only): handed over at the counter, so the order is complete
  -- now. Otherwise a branch without a kitchen screen would keep it 'قيد التحضير' forever. Same rule as the kitchen
  -- screen (kitchen_order_needs_kitchen, created by 025; plpgsql resolves it at run time). paid_at and
  -- stock_deducted_at are already set, so orders_stock_guard takes no stock for this status change.
  IF NOT public.kitchen_order_needs_kitchen(v_order_id) THEN
    UPDATE orders SET status = 'delivered', delivered_at = now(), updated_at = now() WHERE id = v_order_id;
  END IF;

  RETURN pos_order_summary(v_order_id, false);
END $$;

-- Opens the caller's shift, or returns the shift that is already open ({..., existing: true}).
CREATE OR REPLACE FUNCTION public.shift_open(p_opening_amount numeric, p_branch_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.app_require_role('cashier', 'admin');
  v_branch uuid := COALESCE(p_branch_id, public.app_user_branch());
  v_shift cashier_shifts%ROWTYPE;
BEGIN
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'لا يوجد فرع مرتبط بحسابك' USING ERRCODE = 'P0001';
  END IF;
  IF NOT app_can_access_branch(v_branch) THEN
    RAISE EXCEPTION 'لا يمكنك فتح شيفت في هذا الفرع' USING ERRCODE = '42501';
  END IF;
  IF p_opening_amount IS NULL OR p_opening_amount < 0 THEN
    RAISE EXCEPTION 'رصيد الافتتاح يجب أن يكون صفراً أو أكثر' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cashier_shift:' || v_uid::text, 0));
  SELECT * INTO v_shift FROM cashier_shifts
  WHERE cashier_id = v_uid AND status = 'open'
  ORDER BY start_time DESC, id DESC LIMIT 1;
  IF FOUND THEN
    IF v_shift.branch_id <> v_branch THEN
      RAISE EXCEPTION 'لديك شيفت مفتوح في فرع آخر. أغلقه أولاً' USING ERRCODE = 'P0001';
    END IF;
    RETURN to_jsonb(v_shift) || jsonb_build_object('existing', true);
  END IF;

  INSERT INTO cashier_shifts (shift_number, cashier_id, branch_id, opening_amount, status, start_time)
  VALUES (next_document_number('SHF'), v_uid, v_branch, round(p_opening_amount, 2), 'open', now())
  RETURNING * INTO v_shift;
  RETURN to_jsonb(v_shift) || jsonb_build_object('existing', false);
END $$;

-- Closes a shift: totals from its paid orders, per payment method. The cashier closes their own shift;
-- an admin or the branch supervisor can close any shift of their branch. Returns the shift + unpaid_orders.
CREATE OR REPLACE FUNCTION public.shift_close(p_shift_id uuid, p_closing_amount numeric, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.app_require_role('cashier', 'admin', 'branch_supervisor');
  v_shift cashier_shifts%ROWTYPE;
  v_unpaid integer;
BEGIN
  SELECT * INTO v_shift FROM cashier_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الشيفت غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF v_shift.cashier_id <> v_uid
     AND NOT (app_has_role('admin', 'branch_supervisor') AND app_can_access_branch(v_shift.branch_id)) THEN
    RAISE EXCEPTION 'لا يمكنك إغلاق شيفت كاشير آخر' USING ERRCODE = '42501';
  END IF;
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'هذا الشيفت مغلق بالفعل' USING ERRCODE = 'P0001', HINT = 'SHIFT_CLOSED';
  END IF;
  IF p_closing_amount IS NULL OR p_closing_amount < 0 THEN
    RAISE EXCEPTION 'أدخل المبلغ الفعلي في الدرج (صفر أو أكثر)' USING ERRCODE = 'P0001';
  END IF;
  IF length(p_notes) > 1000 THEN
    RAISE EXCEPTION 'الملاحظات طويلة جداً' USING ERRCODE = 'P0001';
  END IF;

  UPDATE cashier_shifts SET
    status = 'closed',
    end_time = now(),
    closing_amount = round(p_closing_amount, 2),
    closed_by = v_uid,
    notes = COALESCE(NULLIF(btrim(p_notes), ''), notes),
    updated_at = now()
  WHERE id = p_shift_id;
  PERFORM shift_apply_totals(p_shift_id);

  SELECT count(*) INTO v_unpaid FROM orders WHERE shift_id = p_shift_id AND status IN ('new', 'pending_payment');
  SELECT * INTO v_shift FROM cashier_shifts WHERE id = p_shift_id;
  RETURN to_jsonb(v_shift) || jsonb_build_object('unpaid_orders', v_unpaid);
END $$;

-- Admin: recompute a shift's totals from its orders (e.g. old snapshots written by the previous client code).
CREATE OR REPLACE FUNCTION public.shift_recalculate(p_shift_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.app_require_role('admin');
  v_shift cashier_shifts%ROWTYPE;
BEGIN
  SELECT * INTO v_shift FROM cashier_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الشيفت غير موجود' USING ERRCODE = 'P0001';
  END IF;
  PERFORM shift_apply_totals(p_shift_id);
  SELECT * INTO v_shift FROM cashier_shifts WHERE id = p_shift_id;
  RETURN to_jsonb(v_shift) || jsonb_build_object('recalculated_by', v_uid);
END $$;

-- Admin: order status, payment method, discount and notes in one step.
--   paid orders: status paid / in_kitchen / preparing / ready / delivered / cancelled; payment method required;
--   unpaid orders: can only be cancelled, and never get a payment method.
-- Cancelling gives the stock back (orders_stock_guard). A closed shift's totals are recomputed.
CREATE OR REPLACE FUNCTION public.order_update(
  p_order_id uuid,
  p_status text,
  p_payment_method text,
  p_discount_amount numeric,
  p_discount_reason text,
  p_notes text,
  p_kitchen_notes text,
  p_cancellation_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.app_require_role('admin');
  v_o orders%ROWTYPE;
  v_paid boolean;
  v_status text;
  v_pm text;
  v_disc numeric;
  v_total numeric;
BEGIN
  SELECT * INTO v_o FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الأوردر غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF NOT app_can_access_branch(v_o.branch_id) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
  END IF;
  IF v_o.status = 'cancelled' THEN
    RAISE EXCEPTION 'هذا الأوردر ملغي ولا يمكن تعديله' USING ERRCODE = 'P0001';
  END IF;

  v_paid := v_o.paid_at IS NOT NULL AND v_o.status NOT IN ('new', 'pending_payment');
  v_status := COALESCE(NULLIF(btrim(p_status), ''), v_o.status::text);
  IF v_paid THEN
    IF v_status NOT IN ('paid', 'in_kitchen', 'preparing', 'ready', 'delivered', 'cancelled') THEN
      RAISE EXCEPTION 'لا يمكن إرجاع أوردر مدفوع إلى حالة غير مدفوع' USING ERRCODE = 'P0001';
    END IF;
    v_pm := COALESCE(NULLIF(btrim(p_payment_method), ''), v_o.payment_method::text);
    IF v_pm IS NULL OR v_pm NOT IN ('cash', 'visa', 'instapay', 'wallet') THEN
      RAISE EXCEPTION 'اختر طريقة دفع صحيحة' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF v_status NOT IN (v_o.status::text, 'cancelled') THEN
      RAISE EXCEPTION 'هذا الأوردر غير مدفوع، ويمكن إلغاؤه فقط' USING ERRCODE = 'P0001';
    END IF;
    IF NULLIF(btrim(p_payment_method), '') IS NOT NULL THEN
      RAISE EXCEPTION 'لا يمكن تحديد طريقة دفع لأوردر غير مدفوع' USING ERRCODE = 'P0001';
    END IF;
    v_pm := v_o.payment_method::text;
  END IF;

  v_disc := round(COALESCE(p_discount_amount, v_o.discount_amount, 0), 2);
  IF v_disc < 0 THEN
    RAISE EXCEPTION 'الخصم لا يمكن أن يكون سالباً' USING ERRCODE = 'P0001';
  END IF;
  IF v_disc > v_o.subtotal + COALESCE(v_o.tax_amount, 0) THEN
    RAISE EXCEPTION 'الخصم (%) أكبر من إجمالي الأوردر (%)',
      to_char(v_disc, 'FM999999990.00'), to_char(v_o.subtotal, 'FM999999990.00') USING ERRCODE = 'P0001';
  END IF;
  v_total := round(v_o.subtotal + COALESCE(v_o.tax_amount, 0) - v_disc, 2);
  IF length(p_notes) > 1000 OR length(p_kitchen_notes) > 1000 OR length(p_discount_reason) > 500
     OR length(p_cancellation_reason) > 500 THEN
    RAISE EXCEPTION 'النص المدخل طويل جداً' USING ERRCODE = 'P0001';
  END IF;

  UPDATE orders SET
    status = v_status::order_status,
    payment_method = v_pm::order_payment_method,
    discount_amount = v_disc,
    discount_reason = CASE WHEN v_disc > 0 THEN NULLIF(btrim(p_discount_reason), '') END,
    total_amount = v_total,
    notes = NULLIF(btrim(p_notes), ''),
    kitchen_notes = NULLIF(btrim(p_kitchen_notes), ''),
    ready_at = CASE WHEN v_status = 'ready' AND v_o.status <> 'ready' THEN now() ELSE ready_at END,
    delivered_at = CASE WHEN v_status = 'delivered' AND v_o.status <> 'delivered' THEN now() ELSE delivered_at END,
    cancelled_by = CASE WHEN v_status = 'cancelled' THEN v_uid ELSE cancelled_by END,
    cancellation_reason = CASE WHEN v_status = 'cancelled' THEN NULLIF(btrim(p_cancellation_reason), '')
                               ELSE cancellation_reason END,
    updated_at = now()
  WHERE id = p_order_id;

  IF v_o.shift_id IS NOT NULL
     AND (v_status IS DISTINCT FROM v_o.status::text OR v_pm IS DISTINCT FROM v_o.payment_method::text
          OR v_total IS DISTINCT FROM v_o.total_amount)
     AND EXISTS (SELECT 1 FROM cashier_shifts WHERE id = v_o.shift_id AND status = 'closed') THEN
    PERFORM shift_apply_totals(v_o.shift_id);
  END IF;
  RETURN pos_order_summary(p_order_id, false);
END $$;

-- Admin: adds a line at the branch price (or p_unit_price when given); a paid order takes the stock for it.
DROP FUNCTION IF EXISTS public.order_add_item(uuid, uuid, numeric, text);
CREATE OR REPLACE FUNCTION public.order_add_item(
  p_order_id uuid, p_item_id uuid, p_quantity numeric, p_notes text DEFAULT NULL, p_unit_price numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.app_require_role('admin');
  v_o orders%ROWTYPE;
  v_info record;
  v_price numeric;
  v_line_id uuid;
  v_after numeric;
BEGIN
  SELECT * INTO v_o FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الأوردر غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF NOT app_can_access_branch(v_o.branch_id) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
  END IF;
  IF v_o.status = 'cancelled' THEN
    RAISE EXCEPTION 'هذا الأوردر ملغي ولا يمكن تعديله' USING ERRCODE = 'P0001';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> trunc(p_quantity) OR p_quantity > 100000 THEN
    RAISE EXCEPTION 'الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر' USING ERRCODE = 'P0001';
  END IF;
  IF length(p_notes) > 500 THEN
    RAISE EXCEPTION 'ملاحظة الصنف طويلة جداً' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_info FROM pos_item_catalog(v_o.branch_id, p_item_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير متاح للبيع في فرع هذا الأوردر' USING ERRCODE = 'P0001';
  END IF;
  v_price := round(COALESCE(p_unit_price, v_info.price), 2);
  IF v_price < 0 THEN
    RAISE EXCEPTION 'سعر الصنف لا يمكن أن يكون سالباً' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, notes)
  VALUES (p_order_id, p_item_id, p_quantity::integer, v_price, round(v_price * p_quantity, 2),
          NULLIF(btrim(p_notes), ''))
  RETURNING id INTO v_line_id;

  IF v_o.stock_deducted_at IS NOT NULL THEN
    v_after := stock_adjust(v_o.branch_id, p_item_id, -p_quantity, 'sale', 'order_edit', p_order_id,
                            'إضافة صنف لأوردر ' || v_o.order_number, v_info.unit_cost, false);
    UPDATE order_items SET stock_deducted_qty = CASE WHEN v_after IS NULL THEN 0 ELSE p_quantity END
    WHERE id = v_line_id;
  END IF;

  PERFORM pos_order_recalc(p_order_id);
  RETURN pos_order_summary(p_order_id, false);
END $$;

-- Admin: changes a line's quantity, price or note; a paid order takes or gives back the difference in stock.
CREATE OR REPLACE FUNCTION public.order_update_item(
  p_order_item_id uuid, p_quantity numeric, p_unit_price numeric, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.app_require_role('admin');
  v_order_id uuid;
  v_o orders%ROWTYPE;
  v_line order_items%ROWTYPE;
  v_price numeric;
  v_held numeric;
  v_new_held numeric;
  v_delta numeric;
  v_after numeric;
  v_cost numeric;
BEGIN
  SELECT order_id INTO v_order_id FROM order_items WHERE id = p_order_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود في الأوردر' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_o FROM orders WHERE id = v_order_id FOR UPDATE;
  SELECT * INTO v_line FROM order_items WHERE id = p_order_item_id FOR UPDATE;
  IF NOT app_can_access_branch(v_o.branch_id) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
  END IF;
  IF v_o.status = 'cancelled' THEN
    RAISE EXCEPTION 'هذا الأوردر ملغي ولا يمكن تعديله' USING ERRCODE = 'P0001';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> trunc(p_quantity) OR p_quantity > 100000 THEN
    RAISE EXCEPTION 'الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر' USING ERRCODE = 'P0001';
  END IF;
  v_price := round(COALESCE(p_unit_price, v_line.unit_price), 2);
  IF v_price < 0 THEN
    RAISE EXCEPTION 'سعر الصنف لا يمكن أن يكون سالباً' USING ERRCODE = 'P0001';
  END IF;
  IF length(p_notes) > 500 THEN
    RAISE EXCEPTION 'ملاحظة الصنف طويلة جداً' USING ERRCODE = 'P0001';
  END IF;

  v_new_held := v_line.stock_deducted_qty;
  IF v_o.stock_deducted_at IS NOT NULL THEN
    v_held := pos_line_held_qty(v_o.branch_id, v_line.item_id, v_line.quantity, v_line.stock_deducted_qty);
    IF v_held > 0 THEN
      v_new_held := v_held;
      v_delta := p_quantity - v_held; -- > 0 takes more stock, < 0 gives some back
      IF v_delta <> 0 THEN
        SELECT purchase_price INTO v_cost FROM items WHERE id = v_line.item_id;
        v_after := stock_adjust(v_o.branch_id, v_line.item_id, -v_delta, 'sale', 'order_edit', v_o.id,
                                'تعديل كمية في أوردر ' || v_o.order_number, v_cost, v_delta < 0);
        IF v_after IS NOT NULL THEN
          v_new_held := p_quantity;
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE order_items SET
    quantity = p_quantity::integer,
    unit_price = v_price,
    total_price = round(v_price * p_quantity, 2),
    notes = NULLIF(btrim(p_notes), ''),
    stock_deducted_qty = v_new_held
  WHERE id = p_order_item_id;

  PERFORM pos_order_recalc(v_o.id);
  RETURN pos_order_summary(v_o.id, false);
END $$;

-- Admin: removes a line (never the last one: cancel the order instead); a paid order gets its stock back.
CREATE OR REPLACE FUNCTION public.order_remove_item(p_order_item_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.app_require_role('admin');
  v_order_id uuid;
  v_o orders%ROWTYPE;
  v_line order_items%ROWTYPE;
  v_held numeric;
  v_cost numeric;
BEGIN
  SELECT order_id INTO v_order_id FROM order_items WHERE id = p_order_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود في الأوردر' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_o FROM orders WHERE id = v_order_id FOR UPDATE;
  SELECT * INTO v_line FROM order_items WHERE id = p_order_item_id FOR UPDATE;
  IF NOT app_can_access_branch(v_o.branch_id) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
  END IF;
  IF v_o.status = 'cancelled' THEN
    RAISE EXCEPTION 'هذا الأوردر ملغي ولا يمكن تعديله' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM order_items WHERE order_id = v_o.id) <= 1 THEN
    RAISE EXCEPTION 'لا يمكن حذف آخر صنف في الأوردر. ألغِ الأوردر بدلاً من ذلك' USING ERRCODE = 'P0001';
  END IF;

  IF v_o.stock_deducted_at IS NOT NULL THEN
    v_held := pos_line_held_qty(v_o.branch_id, v_line.item_id, v_line.quantity, v_line.stock_deducted_qty);
    IF v_held > 0 THEN
      SELECT purchase_price INTO v_cost FROM items WHERE id = v_line.item_id;
      PERFORM stock_adjust(v_o.branch_id, v_line.item_id, v_held, 'sale', 'order_edit', v_o.id,
                           'حذف صنف من أوردر ' || v_o.order_number, v_cost, v_line.stock_deducted_qty IS NOT NULL);
    END IF;
  END IF;

  DELETE FROM order_items WHERE id = p_order_item_id;
  PERFORM pos_order_recalc(v_o.id);
  RETURN pos_order_summary(v_o.id, false);
END $$;

-- Admin: settles an order the back-fill could not classify (see pos_backfill_issues, reason 'ambiguous_flow').
--   p_deduct = true: its stock was never taken, take it now (lines short of stock are listed for review);
--   p_deduct = false: its stock was already taken by the old flow, just mark it.
CREATE OR REPLACE FUNCTION public.pos_backfill_resolve_order(p_order_id uuid, p_deduct boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.app_require_role('admin');
  v_o orders%ROWTYPE;
  v_skipped integer := 0;
BEGIN
  SELECT * INTO v_o FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الأوردر غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pos_backfill_issues
                 WHERE order_id = p_order_id AND reason = 'ambiguous_flow' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'هذا الأوردر ليس في قائمة المراجعة' USING ERRCODE = 'P0001';
  END IF;
  IF v_o.stock_deducted_at IS NULL AND v_o.status <> 'cancelled' THEN
    IF p_deduct THEN
      v_skipped := pos_backfill_deduct_order(p_order_id);
    ELSE
      UPDATE orders SET stock_deducted_at = COALESCE(paid_at, created_at) WHERE id = p_order_id;
    END IF;
  END IF;
  UPDATE pos_backfill_issues SET resolved_at = now(), resolved_by = v_uid,
    resolution = CASE WHEN p_deduct THEN 'deducted' ELSE 'already_deducted' END
  WHERE order_id = p_order_id AND reason = 'ambiguous_flow' AND resolved_at IS NULL;
  RETURN jsonb_build_object('order_id', p_order_id, 'deducted', p_deduct, 'skipped_lines', v_skipped);
END $$;

-- Older category RPC, replaced by pos_cashier_categories and no longer used by the app. It takes any user id,
-- so it must not be callable from the API (it would list another cashier's categories): pin its search_path
-- here and close it in section 7.
DO $$
BEGIN
  IF to_regprocedure('public.get_cashier_categories(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.get_cashier_categories(uuid) SET search_path = public;
  END IF;
END $$;

-- ---------- 6. Data fixes (re-runnable; a second run changes nothing) ----------

-- 6a. A cashier with several open shifts keeps the newest; older ones are closed with totals from their orders,
--     ending when the next one started. closing_amount stays empty (nobody counted that drawer).
DO $$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT s.id,
           (SELECT min(n.start_time) FROM cashier_shifts n
            WHERE n.cashier_id = s.cashier_id AND n.status = 'open' AND (n.start_time, n.id) > (s.start_time, s.id)) AS next_start
    FROM cashier_shifts s
    WHERE s.status = 'open'
      AND EXISTS (SELECT 1 FROM cashier_shifts n
                  WHERE n.cashier_id = s.cashier_id AND n.status = 'open' AND (n.start_time, n.id) > (s.start_time, s.id))
    ORDER BY s.start_time, s.id
  LOOP
    UPDATE cashier_shifts SET
      status = 'closed',
      end_time = GREATEST(start_time, r.next_start),
      notes = concat_ws(' | ', NULLIF(btrim(notes), ''), 'أُغلق تلقائياً: كان للكاشير أكثر من شيفت مفتوح')
    WHERE id = r.id;
    PERFORM shift_apply_totals(r.id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE '020: closed % duplicate open shift(s)', v_n;
END $$;

-- 6b. Stock back-fill and stock markers for existing orders. Runs with triggers off (this transaction only) so it
--     does not rewrite orders.updated_at, which is part of the evidence used below. The orders trigger would not
--     fire anyway: every UPDATE here sets stock_deducted_at.
SET LOCAL session_replication_role = replica;

DO $$
DECLARE
  -- commit 823f8c5 (2026-10-20 21:20:38 Cairo): from here payment sets 'preparing' and the old trigger never ran
  c_since constant timestamptz := '2026-10-20 18:20:38+00';
  r record;
  v_deducted integer := 0;
  v_skipped integer := 0;
  v_ambiguous integer;
  v_marked integer;
  v_breakdown integer;
BEGIN
  -- Certainly never deducted: paid after the change straight into 'preparing', untouched since (last update within
  -- 10 s of creation, so no kitchen or edit step), and no stock row of its lines changed at payment time.
  FOR r IN
    SELECT o.id FROM orders o
    WHERE o.stock_deducted_at IS NULL
      AND o.paid_at >= c_since
      AND o.status = 'preparing'
      AND o.updated_at <= o.created_at + interval '10 seconds'
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN inventory inv ON inv.branch_id = o.branch_id AND inv.item_id = oi.item_id
        WHERE oi.order_id = o.id
          AND inv.updated_at BETWEEN o.updated_at - interval '2 seconds' AND o.updated_at + interval '2 seconds')
    ORDER BY o.paid_at, o.id
  LOOP
    v_skipped := v_skipped + pos_backfill_deduct_order(r.id);
    v_deducted := v_deducted + 1;
  END LOOP;

  -- Paid after the change and in a state both flows reach (the kitchen may have moved it on): listed for review,
  -- stock untouched. Settle each with pos_backfill_resolve_order().
  INSERT INTO pos_backfill_issues (order_id, reason, details)
  SELECT o.id, 'ambiguous_flow',
         format('الحالة %s، وقت الدفع %s', o.status,
                to_char(o.paid_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'))
  FROM orders o
  WHERE o.stock_deducted_at IS NULL AND o.paid_at >= c_since AND o.status IN ('preparing', 'ready', 'delivered')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_ambiguous = ROW_COUNT;

  -- Every other paid order went through 'paid' and the old trigger: mark it as holding its stock (no stock change).
  UPDATE orders o SET stock_deducted_at = COALESCE(o.paid_at, o.created_at)
  WHERE o.stock_deducted_at IS NULL
    AND o.status NOT IN ('new', 'pending_payment', 'cancelled')
    AND NOT EXISTS (SELECT 1 FROM pos_backfill_issues b
                    WHERE b.order_id = o.id AND b.reason = 'ambiguous_flow' AND b.resolved_at IS NULL);
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  -- Per-method breakdown for closed shifts whose stored cash/card totals match their paid orders
  -- (snapshots that don't match are left as recorded; shift_recalculate() redoes one on request).
  WITH t AS (
    SELECT s.id,
           round(COALESCE(sum(o.total_amount) FILTER (WHERE o.payment_method = 'cash'), 0), 2) AS cash,
           round(COALESCE(sum(o.total_amount) FILTER (WHERE o.payment_method = 'visa'), 0), 2) AS visa,
           round(COALESCE(sum(o.total_amount) FILTER (WHERE o.payment_method = 'instapay'), 0), 2) AS instapay,
           round(COALESCE(sum(o.total_amount) FILTER (WHERE o.payment_method = 'wallet'), 0), 2) AS wallet
    FROM cashier_shifts s
    LEFT JOIN orders o ON o.shift_id = s.id AND o.paid_at IS NOT NULL
                      AND o.status NOT IN ('new', 'pending_payment', 'cancelled')
    WHERE s.status = 'closed' AND s.visa_sales IS NULL
    GROUP BY s.id)
  UPDATE cashier_shifts s SET visa_sales = t.visa, instapay_sales = t.instapay, wallet_sales = t.wallet
  FROM t
  WHERE t.id = s.id
    AND round(COALESCE(s.cash_sales, 0), 2) = t.cash
    AND round(COALESCE(s.card_sales, 0), 2) = t.visa + t.instapay + t.wallet;
  GET DIAGNOSTICS v_breakdown = ROW_COUNT;

  RAISE NOTICE '020 back-fill: % order(s) deducted now (% line(s) skipped for lack of stock), % ambiguous order(s) listed for review, % order(s) marked as already deducted, % closed shift(s) given a payment breakdown',
    v_deducted, v_skipped, v_ambiguous, v_marked, v_breakdown;
END $$;

SET LOCAL session_replication_role = origin;

-- ---------- 7. Permissions ----------

-- internal helpers and trigger functions: never callable from the API
REVOKE ALL ON FUNCTION public.pos_item_catalog(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_allowed_category_ids(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_next_order_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_order_summary(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_order_stock_apply(uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shift_apply_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_order_recalc(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_line_held_qty(uuid, uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_backfill_deduct_order(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_orders_stock_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_order_items_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shift_guard() FROM PUBLIC, anon, authenticated;

-- API functions: logged-in users only (each checks the role itself)
REVOKE ALL ON FUNCTION public.pos_sellable_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_sellable_items(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.pos_cashier_categories() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_cashier_categories() TO authenticated;
REVOKE ALL ON FUNCTION public.pos_checkout(uuid, jsonb, text, numeric, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_checkout(uuid, jsonb, text, numeric, uuid, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.shift_open(numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_open(numeric, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.shift_close(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_close(uuid, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.shift_recalculate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_recalculate(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.order_update(uuid, text, text, numeric, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_update(uuid, text, text, numeric, text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.order_add_item(uuid, uuid, numeric, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_add_item(uuid, uuid, numeric, text, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.order_update_item(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_update_item(uuid, numeric, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.order_remove_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_remove_item(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.pos_backfill_resolve_order(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_backfill_resolve_order(uuid, boolean) TO authenticated;

-- legacy, replaced by pos_cashier_categories (see section 5)
DO $$
BEGIN
  IF to_regprocedure('public.get_cashier_categories(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_cashier_categories(uuid) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
