-- ============================================
-- 050: Suppliers, supplies, supplier payments, purchase requests and orders, reports and dashboard. Idempotent.
--
-- Supplier ledger (one formula for the statement, the suppliers report, the performance report and the
-- supplier list). What we owe a supplier =
--     credit purchase orders, from the moment they are approved (cancelling an approved one reverses it)
--   + the unpaid part of supplies (total - amount paid on delivery)
--   + manual debts
--   - payments (purchase-order payments and supplier payments)
--   - approved supplier returns (status approved/received; the balance itself is lowered by 040's return function)
-- Cash purchase orders are paid on delivery and are never owed. Pending, rejected and draft orders are never owed.
-- suppliers.current_balance follows the same events through supplier_balance_adjust(), and
-- supplier_ledger_entries() lists them.
--
-- Receiving a purchase order or saving a supply adds stock with stock_adjust('supply').
-- An approved purchase request can be bought with several purchase orders (one per supplier, say): each order
-- covers request lines no other live order covers, and the request is completed when every line is received.
-- A supply's remaining payable = total - paid - its approved supplier returns.
-- Report functions aggregate in the database with Cairo calendar days (inclusive end day).
-- Revenue = orders with paid_at set and status <> 'cancelled'.
-- ============================================

-- ---------- Columns ----------

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.users(id);
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id);
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES public.users(id);
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS received_at timestamptz;
-- Amount paid when the supply was delivered (later payments are supplier_payments rows).
ALTER TABLE public.supplies ADD COLUMN IF NOT EXISTS upfront_paid_amount numeric DEFAULT 0;

-- ---------- Indexes ----------

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON public.purchase_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_payments_order ON public.purchase_order_payments (order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_request ON public.purchase_orders (request_id);
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_request ON public.purchase_request_items (request_id);
CREATE INDEX IF NOT EXISTS idx_supply_items_supply ON public.supply_items (supply_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_debt_transactions_supplier ON public.supplier_debt_transactions (supplier_id);

-- ---------- Internal helpers ----------

-- Today's Cairo calendar date.
CREATE OR REPLACE FUNCTION public.purchase_today() RETURNS date
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (now() AT TIME ZONE 'Africa/Cairo')::date
$$;
REVOKE ALL ON FUNCTION public.purchase_today() FROM PUBLIC, anon, authenticated;

-- Arabic label of a purchase order / request status, for error messages.
CREATE OR REPLACE FUNCTION public.purchase_status_label(p_status text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_status
    WHEN 'draft' THEN 'مسودة'
    WHEN 'pending' THEN 'في انتظار الموافقة'
    WHEN 'approved' THEN 'معتمد'
    WHEN 'sent' THEN 'تم الإرسال للمورد'
    WHEN 'partially_received' THEN 'استلام جزئي'
    WHEN 'received' THEN 'تم الاستلام'
    WHEN 'rejected' THEN 'مرفوض'
    WHEN 'cancelled' THEN 'ملغي'
    WHEN 'ordered' THEN 'تم إصدار أمر شراء'
    WHEN 'completed' THEN 'مكتمل'
    ELSE COALESCE(p_status, '-')
  END
$$;
REVOKE ALL ON FUNCTION public.purchase_status_label(text) FROM PUBLIC, anon, authenticated;

-- Audit row in supplier_debt_transactions (amount > 0 adds debt, < 0 reduces it).
-- Only 'manual_debt' rows are read back (they are their own source document); the others are an audit trail.
CREATE OR REPLACE FUNCTION public.supplier_log_debt(
  p_supplier_id uuid, p_type text, p_amount numeric, p_reference text, p_description text
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO supplier_debt_transactions (supplier_id, transaction_type, amount, reference_number, description, created_by)
  VALUES (p_supplier_id, p_type, round(p_amount, 2), p_reference, p_description, public.app_user_id());
$$;
REVOKE ALL ON FUNCTION public.supplier_log_debt(uuid, text, numeric, text, text) FROM PUBLIC, anon, authenticated;

-- Locks the supplier row and raises when adding p_additional would pass its credit limit (0 = no limit).
CREATE OR REPLACE FUNCTION public.supplier_check_credit_limit(p_supplier_id uuid, p_additional numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit numeric;
  v_balance numeric;
  v_name text;
BEGIN
  SELECT COALESCE(credit_limit, 0), COALESCE(current_balance, 0), COALESCE(name_ar, name)
    INTO v_limit, v_balance, v_name
  FROM suppliers WHERE id = p_supplier_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المورد غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF v_limit > 0 AND round(v_balance + COALESCE(p_additional, 0), 2) > round(v_limit, 2) THEN
    RAISE EXCEPTION 'تجاوز حد الائتمان للمورد "%": الحد % ج.م، المديونية الحالية % ج.م، والمطلوب إضافته % ج.م',
      v_name, round(v_limit, 2), round(v_balance, 2), round(COALESCE(p_additional, 0), 2)
      USING ERRCODE = 'P0001';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.supplier_check_credit_limit(uuid, numeric) FROM PUBLIC, anon, authenticated;

-- Recomputes an approved purchase request's status from its lines. A request can be bought with several
-- purchase orders (e.g. one per supplier): a line is 'approved' until a purchase order covers it, then 'ordered'.
--   every non-rejected line ordered and fully received -> completed
--   something received                                 -> partially_received
--   every line ordered, nothing received yet            -> ordered
--   otherwise (lines still to order)                    -> approved
-- Pending, rejected, draft and cancelled requests are left alone.
CREATE OR REPLACE FUNCTION public.purchase_sync_request(p_request_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_open integer;
  v_ordered integer;
  v_any_received boolean;
  v_all_received boolean;
  v_new text;
BEGIN
  IF p_request_id IS NULL THEN
    RETURN;
  END IF;
  SELECT status::text INTO v_status FROM purchase_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('approved', 'ordered', 'partially_received', 'completed') THEN
    RETURN;
  END IF;
  SELECT count(*) FILTER (WHERE item_status = 'approved'),
         count(*) FILTER (WHERE item_status = 'ordered'),
         COALESCE(bool_or(COALESCE(received_quantity, 0) > 0), false),
         COALESCE(bool_and(item_status = 'ordered' AND COALESCE(received_quantity, 0) >= COALESCE(ordered_quantity, 0)), false)
    INTO v_open, v_ordered, v_any_received, v_all_received
  FROM purchase_request_items
  WHERE request_id = p_request_id AND COALESCE(item_status, '') <> 'rejected';

  v_new := CASE WHEN v_ordered > 0 AND v_all_received THEN 'completed'
                WHEN v_any_received THEN 'partially_received'
                WHEN v_open = 0 AND v_ordered > 0 THEN 'ordered'
                ELSE 'approved' END;
  IF v_new <> v_status THEN
    UPDATE purchase_requests SET status = v_new::purchase_request_status, updated_at = now() WHERE id = p_request_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.purchase_sync_request(uuid) FROM PUBLIC, anon, authenticated;

-- When a purchase order is rejected or cancelled, the request lines it covered can be ordered again.
CREATE OR REPLACE FUNCTION public.purchase_release_request(p_request_id uuid, p_order_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_request_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM 1 FROM purchase_requests WHERE id = p_request_id FOR UPDATE;
  UPDATE purchase_request_items ri SET ordered_quantity = NULL, item_status = 'approved'
  WHERE ri.request_id = p_request_id AND ri.item_status = 'ordered'
    AND ri.id IN (SELECT oi.request_item_id FROM purchase_order_items oi
                  WHERE oi.order_id = p_order_id AND oi.request_item_id IS NOT NULL);
  PERFORM public.purchase_sync_request(p_request_id);
END $$;
REVOKE ALL ON FUNCTION public.purchase_release_request(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------- Supplier ledger ----------

-- Every event that changes what we owe a supplier (NULL = all suppliers). debit adds debt, credit reduces it.
CREATE OR REPLACE FUNCTION public.supplier_ledger_entries(p_supplier_id uuid DEFAULT NULL)
RETURNS TABLE (
  supplier_id uuid, entry_date date, entry_at timestamptz, entry_type text, reference text,
  description text, payment_method text, debit numeric, credit numeric, source_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Credit purchase orders are owed from approval.
  SELECT po.supplier_id,
         COALESCE((po.approved_at AT TIME ZONE 'Africa/Cairo')::date, po.order_date),
         COALESCE(po.approved_at, po.created_at),
         'purchase_order', po.order_number, 'أمر شراء آجل', NULL::text,
         round(COALESCE(po.total_amount, 0), 2), 0::numeric, po.id
  FROM purchase_orders po
  WHERE po.payment_type = 'credit'
    AND (po.status IN ('approved', 'sent', 'partially_received', 'received')
         OR (po.status = 'cancelled' AND po.approved_at IS NOT NULL))
    AND (p_supplier_id IS NULL OR po.supplier_id = p_supplier_id)
  UNION ALL
  -- Cancelling an approved credit purchase order reverses it.
  SELECT po.supplier_id,
         (COALESCE(po.cancelled_at, po.updated_at) AT TIME ZONE 'Africa/Cairo')::date,
         COALESCE(po.cancelled_at, po.updated_at),
         'purchase_order_cancel', po.order_number, 'إلغاء أمر شراء آجل', NULL::text,
         0::numeric, round(COALESCE(po.total_amount, 0), 2), po.id
  FROM purchase_orders po
  WHERE po.payment_type = 'credit' AND po.status = 'cancelled' AND po.approved_at IS NOT NULL
    AND (p_supplier_id IS NULL OR po.supplier_id = p_supplier_id)
  UNION ALL
  -- Supplies: the part not paid on delivery.
  SELECT s.supplier_id,
         COALESCE(s.invoice_date, (s.created_at AT TIME ZONE 'Africa/Cairo')::date),
         s.created_at,
         'supply', s.supply_number,
         CASE WHEN NULLIF(btrim(s.invoice_number), '') IS NOT NULL THEN 'توريد - فاتورة: ' || btrim(s.invoice_number) ELSE 'توريد' END
           || CASE WHEN COALESCE(s.upfront_paid_amount, 0) > 0 THEN ' (المتبقي بعد المدفوع عند الاستلام)' ELSE '' END,
         NULL::text,
         round(COALESCE(s.total_amount, 0) - COALESCE(s.upfront_paid_amount, 0), 2), 0::numeric, s.id
  FROM supplies s
  WHERE round(COALESCE(s.total_amount, 0) - COALESCE(s.upfront_paid_amount, 0), 2) <> 0
    AND (p_supplier_id IS NULL OR s.supplier_id = p_supplier_id)
  UNION ALL
  -- Purchase order payments.
  SELECT po.supplier_id, p.payment_date, p.created_at,
         'po_payment', p.payment_number, 'دفعة أمر شراء ' || po.order_number, p.payment_method,
         0::numeric, round(p.amount, 2), p.id
  FROM purchase_order_payments p
  JOIN purchase_orders po ON po.id = p.order_id
  WHERE p_supplier_id IS NULL OR po.supplier_id = p_supplier_id
  UNION ALL
  -- Supplier payments (general or against a supply).
  SELECT sp.supplier_id, sp.payment_date, sp.created_at,
         'supplier_payment', sp.payment_number,
         CASE WHEN s.supply_number IS NOT NULL THEN 'دفعة توريد ' || s.supply_number ELSE 'دفعة للمورد' END,
         sp.payment_method,
         0::numeric, round(sp.amount, 2), sp.id
  FROM supplier_payments sp
  LEFT JOIN supplies s ON s.id = sp.supply_id
  WHERE p_supplier_id IS NULL OR sp.supplier_id = p_supplier_id
  UNION ALL
  -- Approved supplier returns.
  SELECT r.supplier_id,
         (COALESCE(r.approved_at, r.created_at) AT TIME ZONE 'Africa/Cairo')::date,
         COALESCE(r.approved_at, r.created_at),
         'return', r.return_number, 'مرتجع للمورد', NULL::text,
         0::numeric, round(COALESCE(r.total_amount, 0), 2), r.id
  FROM supplier_returns r
  WHERE r.status IN ('approved', 'received')
    AND (p_supplier_id IS NULL OR r.supplier_id = p_supplier_id)
  UNION ALL
  -- Manual debts.
  SELECT d.supplier_id, (d.created_at AT TIME ZONE 'Africa/Cairo')::date, d.created_at,
         'manual_debt', COALESCE(NULLIF(btrim(d.reference_number), ''), 'يدوي'),
         COALESCE(NULLIF(btrim(d.description), ''), 'إضافة مديونية يدوية'), NULL::text,
         GREATEST(round(d.amount, 2), 0), GREATEST(-round(d.amount, 2), 0), d.id
  FROM supplier_debt_transactions d
  WHERE d.transaction_type = 'manual_debt'
    AND (p_supplier_id IS NULL OR d.supplier_id = p_supplier_id)
$$;
REVOKE ALL ON FUNCTION public.supplier_ledger_entries(uuid) FROM PUBLIC, anon, authenticated;

-- ---------- Suppliers ----------

-- Creates (p_id NULL) or updates a supplier. The balance is never edited here.
CREATE OR REPLACE FUNCTION public.supplier_save(
  p_id uuid, p_code text, p_name text, p_name_ar text, p_phone text, p_email text, p_address text,
  p_contact_person text, p_payment_terms text, p_credit_limit numeric, p_status text, p_notes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'purchase_manager');
  v_code text := btrim(COALESCE(p_code, ''));
  v_limit numeric := round(COALESCE(p_credit_limit, 0), 2);
  v_id uuid;
BEGIN
  IF v_code = '' OR NULLIF(btrim(p_name), '') IS NULL OR NULLIF(btrim(p_name_ar), '') IS NULL THEN
    RAISE EXCEPTION 'كود المورد والاسم بالعربي والإنجليزي مطلوبة' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_payment_terms, 'cash') NOT IN ('cash', 'credit') THEN
    RAISE EXCEPTION 'شروط الدفع غير صحيحة' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_status, 'active') NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'حالة المورد غير صحيحة' USING ERRCODE = 'P0001';
  END IF;
  IF v_limit < 0 THEN
    RAISE EXCEPTION 'حد الائتمان لا يمكن أن يكون سالباً' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM suppliers WHERE code = v_code AND id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'كود المورد موجود مسبقاً' USING ERRCODE = 'P0001';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO suppliers (code, name, name_ar, phone, email, address, contact_person, payment_terms,
                           credit_limit, current_balance, status, notes, created_by)
    VALUES (v_code, btrim(p_name), btrim(p_name_ar), COALESCE(btrim(p_phone), ''), NULLIF(btrim(p_email), ''),
            NULLIF(btrim(p_address), ''), NULLIF(btrim(p_contact_person), ''),
            COALESCE(p_payment_terms, 'cash')::supplier_payment_method, v_limit, 0,
            COALESCE(p_status, 'active')::supplier_status, NULLIF(btrim(p_notes), ''), v_user)
    RETURNING id INTO v_id;
  ELSE
    UPDATE suppliers SET
      code = v_code, name = btrim(p_name), name_ar = btrim(p_name_ar), phone = COALESCE(btrim(p_phone), ''),
      email = NULLIF(btrim(p_email), ''), address = NULLIF(btrim(p_address), ''),
      contact_person = NULLIF(btrim(p_contact_person), ''),
      payment_terms = COALESCE(p_payment_terms, 'cash')::supplier_payment_method, credit_limit = v_limit,
      status = COALESCE(p_status, 'active')::supplier_status, notes = NULLIF(btrim(p_notes), ''), updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'المورد غير موجود' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.supplier_save(uuid, text, text, text, text, text, text, text, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_save(uuid, text, text, text, text, text, text, text, text, numeric, text, text) TO authenticated;

-- Deletes a supplier that has no history; otherwise asks to deactivate it.
CREATE OR REPLACE FUNCTION public.supplier_delete(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_in_use_msg constant text := 'لا يمكن حذف مورد له حركات مسجلة (أوامر شراء أو توريدات أو مدفوعات أو مرتجعات)، يمكنك جعله غير نشط بدلاً من ذلك';
BEGIN
  PERFORM public.app_require_role('admin', 'purchase_manager');
  PERFORM 1 FROM suppliers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المورد غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_orders WHERE supplier_id = p_id)
     OR EXISTS (SELECT 1 FROM supplies WHERE supplier_id = p_id)
     OR EXISTS (SELECT 1 FROM supplier_payments WHERE supplier_id = p_id)
     OR EXISTS (SELECT 1 FROM supplier_returns WHERE supplier_id = p_id)
     OR EXISTS (SELECT 1 FROM supplier_debt_transactions WHERE supplier_id = p_id)
     OR EXISTS (SELECT 1 FROM purchase_request_items WHERE supplier_id = p_id) THEN
    RAISE EXCEPTION '%', v_in_use_msg USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    DELETE FROM supplier_items WHERE supplier_id = p_id;
    DELETE FROM suppliers WHERE id = p_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION '%', v_in_use_msg USING ERRCODE = 'P0001';
  END;
END $$;
REVOKE ALL ON FUNCTION public.supplier_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_delete(uuid) TO authenticated;

-- Adds a manual debt (e.g. an opening balance). Returns the new balance.
CREATE OR REPLACE FUNCTION public.supplier_add_manual_debt(p_supplier_id uuid, p_amount numeric, p_description text)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_amount numeric := round(p_amount, 2);
  v_balance numeric;
BEGIN
  PERFORM public.app_require_role('admin', 'purchase_manager');
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'يجب إدخال مبلغ أكبر من صفر' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.supplier_check_credit_limit(p_supplier_id, v_amount);
  v_balance := public.supplier_balance_adjust(p_supplier_id, v_amount);
  PERFORM public.supplier_log_debt(p_supplier_id, 'manual_debt', v_amount, NULL,
                                   COALESCE(NULLIF(btrim(p_description), ''), 'إضافة مديونية يدوية'));
  RETURN v_balance;
END $$;
REVOKE ALL ON FUNCTION public.supplier_add_manual_debt(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_add_manual_debt(uuid, numeric, text) TO authenticated;

-- Records goods delivered directly by a supplier: header, lines, stock (+ batches), purchase price and the
-- unpaid part as supplier debt, in one transaction. p_items: [{item_id, quantity, unit_price, expiry_date, batch_number}]
CREATE OR REPLACE FUNCTION public.supplier_create_supply(
  p_supplier_id uuid, p_branch_id uuid, p_invoice_date date, p_invoice_number text,
  p_payment_method text, p_paid_amount numeric, p_notes text, p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'purchase_manager', 'branch_supervisor');
  v_status supplier_status;
  v_date date := COALESCE(p_invoice_date, public.purchase_today());
  v_total numeric;
  v_paid numeric;
  v_credit numeric;
  v_id uuid;
  v_number text;
  v_line record;
  v_inventory_id uuid;
BEGIN
  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'اختر الفرع' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM suppliers WHERE id = p_supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'اختر المورد' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'المورد غير نشط' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_payment_method, '') NOT IN ('cash', 'credit') THEN
    RAISE EXCEPTION 'طريقة الدفع غير صحيحة' USING ERRCODE = 'P0001';
  END IF;
  IF v_date > public.purchase_today() THEN
    RAISE EXCEPTION 'لا يمكن تسجيل توريد بتاريخ مستقبلي' USING ERRCODE = 'P0001';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إضافة صنف واحد على الأقل' USING ERRCODE = 'P0001';
  END IF;

  -- Validate all lines first.
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS x(item_id uuid, quantity numeric, unit_price numeric)
             WHERE x.item_id IS NULL OR x.quantity IS NULL OR round(x.quantity, 3) <= 0
                OR x.unit_price IS NULL OR x.unit_price < 0) THEN
    RAISE EXCEPTION 'كل صنف يحتاج كمية أكبر من صفر وسعراً غير سالب' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS x(item_id uuid)
             WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.id = x.item_id)) THEN
    RAISE EXCEPTION 'يوجد صنف غير موجود في القائمة' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT x.item_id) FROM jsonb_to_recordset(p_items) AS x(item_id uuid)) THEN
    RAISE EXCEPTION 'لا يمكن تكرار نفس الصنف' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(round(round(x.quantity, 3) * round(x.unit_price, 2), 2)), 0) INTO v_total
  FROM jsonb_to_recordset(p_items) AS x(quantity numeric, unit_price numeric);

  IF p_payment_method = 'cash' THEN
    v_paid := v_total;
  ELSE
    v_paid := round(COALESCE(p_paid_amount, 0), 2);
    IF v_paid < 0 OR v_paid > v_total THEN
      RAISE EXCEPTION 'المبلغ المدفوع يجب أن يكون بين صفر وإجمالي التوريد (% ج.م)', v_total USING ERRCODE = 'P0001';
    END IF;
  END IF;
  v_credit := round(v_total - v_paid, 2);
  IF v_credit > 0 THEN
    PERFORM public.supplier_check_credit_limit(p_supplier_id, v_credit);
  END IF;

  v_number := public.next_document_number('SUP');
  INSERT INTO supplies (supply_number, supplier_id, branch_id, invoice_number, invoice_date, subtotal, total_amount,
                        payment_method, payment_status, paid_amount, upfront_paid_amount, notes, received_by, received_at)
  VALUES (v_number, p_supplier_id, p_branch_id, NULLIF(btrim(p_invoice_number), ''), v_date, v_total, v_total,
          p_payment_method::supplier_payment_method,
          (CASE WHEN v_paid >= v_total THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'pending' END)::payment_status,
          v_paid, v_paid, NULLIF(btrim(p_notes), ''), v_user, now())
  RETURNING id INTO v_id;

  -- (item_id, branch_id) lock order, like sales, counts and movements, so concurrent stock changes can't deadlock
  PERFORM 1 FROM inventory
  WHERE branch_id = p_branch_id
    AND item_id IN (SELECT x.item_id FROM jsonb_to_recordset(p_items) AS x(item_id uuid))
  ORDER BY item_id, branch_id
  FOR UPDATE;

  FOR v_line IN
    SELECT x.item_id, round(x.quantity, 3) AS quantity, round(x.unit_price, 2) AS unit_price,
           x.expiry_date, NULLIF(btrim(x.batch_number), '') AS batch_number
    FROM jsonb_to_recordset(p_items) AS x(item_id uuid, quantity numeric, unit_price numeric, expiry_date date, batch_number text)
    ORDER BY x.item_id
  LOOP
    INSERT INTO supply_items (supply_id, item_id, quantity, received_quantity, unit_price, total_price, batch_number, expiry_date)
    VALUES (v_id, v_line.item_id, v_line.quantity, v_line.quantity, v_line.unit_price,
            round(v_line.quantity * v_line.unit_price, 2), v_line.batch_number, v_line.expiry_date);

    PERFORM public.stock_adjust(p_branch_id, v_line.item_id, v_line.quantity, 'supply', 'supply', v_id,
                                'توريد ' || v_number, v_line.unit_price);

    UPDATE inventory SET last_restock_date = now()
    WHERE branch_id = p_branch_id AND item_id = v_line.item_id
    RETURNING id INTO v_inventory_id;

    IF v_line.expiry_date IS NOT NULL OR v_line.batch_number IS NOT NULL THEN
      INSERT INTO inventory_batches (inventory_id, batch_number, quantity, remaining_quantity, purchase_price,
                                     expiry_date, received_date, supply_id)
      VALUES (v_inventory_id, v_line.batch_number, v_line.quantity, v_line.quantity, v_line.unit_price,
              v_line.expiry_date, v_date, v_id);
    END IF;

    IF v_line.unit_price > 0 THEN
      UPDATE items SET purchase_price = v_line.unit_price, updated_at = now()
      WHERE id = v_line.item_id AND purchase_price IS DISTINCT FROM v_line.unit_price;
    END IF;
  END LOOP;

  IF v_credit > 0 THEN
    PERFORM public.supplier_balance_adjust(p_supplier_id, v_credit);
    PERFORM public.supplier_log_debt(p_supplier_id, 'purchase_order', v_credit, v_number, 'توريد (الجزء الآجل)');
  END IF;

  RETURN jsonb_build_object('id', v_id, 'supply_number', v_number);
END $$;
REVOKE ALL ON FUNCTION public.supplier_create_supply(uuid, uuid, date, text, text, numeric, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_create_supply(uuid, uuid, date, text, text, numeric, text, jsonb) TO authenticated;

-- Value of the approved / received supplier returns linked to a supply (040's return approval lowers the
-- supplier balance by it, so it no longer has to be paid on that supply).
CREATE OR REPLACE FUNCTION public.supplier_supply_returned(p_supply_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(round(sum(COALESCE(r.total_amount, 0)), 2), 0)
  FROM supplier_returns r
  WHERE r.supply_id = p_supply_id AND r.status IN ('approved', 'received')
$$;
REVOKE ALL ON FUNCTION public.supplier_supply_returned(uuid) FROM PUBLIC, anon, authenticated;

-- Records a payment to a supplier (general, or against one of its supplies). Never more than is owed.
-- A supply's remaining = total - paid - its approved returns.
CREATE OR REPLACE FUNCTION public.supplier_create_payment(
  p_supplier_id uuid, p_amount numeric, p_payment_date date, p_payment_method text,
  p_reference_number text, p_notes text, p_supply_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'purchase_manager');
  v_amount numeric := round(p_amount, 2);
  v_date date := COALESCE(p_payment_date, public.purchase_today());
  v_balance numeric;
  v_supply supplies%ROWTYPE;
  v_returned numeric := 0;
  v_remaining numeric;
  v_number text;
  v_id uuid;
BEGIN
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'يجب أن يكون المبلغ أكبر من صفر' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_payment_method, '') NOT IN ('cash', 'bank_transfer', 'check') THEN
    RAISE EXCEPTION 'طريقة الدفع غير صحيحة' USING ERRCODE = 'P0001';
  END IF;
  IF v_date > public.purchase_today() THEN
    RAISE EXCEPTION 'لا يمكن تسجيل دفعة بتاريخ مستقبلي' USING ERRCODE = 'P0001';
  END IF;

  SELECT round(COALESCE(current_balance, 0), 2) INTO v_balance FROM suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'اختر المورد' USING ERRCODE = 'P0001';
  END IF;

  IF p_supply_id IS NOT NULL THEN
    SELECT * INTO v_supply FROM supplies WHERE id = p_supply_id FOR UPDATE;
    IF NOT FOUND OR v_supply.supplier_id <> p_supplier_id THEN
      RAISE EXCEPTION 'التوريد المحدد لا يخص هذا المورد' USING ERRCODE = 'P0001';
    END IF;
    v_returned := public.supplier_supply_returned(p_supply_id);
    v_remaining := round(COALESCE(v_supply.total_amount, 0) - COALESCE(v_supply.paid_amount, 0) - v_returned, 2);
    IF v_remaining <= 0 THEN
      RAISE EXCEPTION 'هذا التوريد مدفوع بالكامل (بعد خصم المرتجعات)' USING ERRCODE = 'P0001';
    END IF;
    IF v_amount > v_remaining THEN
      RAISE EXCEPTION 'المبلغ أكبر من المتبقي على التوريد (% ج.م)', v_remaining USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF v_amount > v_balance THEN
    RAISE EXCEPTION 'المبلغ أكبر من مديونية المورد الحالية (% ج.م)', v_balance USING ERRCODE = 'P0001';
  END IF;

  v_number := public.next_document_number('PAY');
  INSERT INTO supplier_payments (payment_number, supplier_id, supply_id, amount, payment_method, reference_number,
                                 payment_date, notes, created_by)
  VALUES (v_number, p_supplier_id, p_supply_id, v_amount, p_payment_method, NULLIF(btrim(p_reference_number), ''),
          v_date, NULLIF(btrim(p_notes), ''), v_user)
  RETURNING id INTO v_id;

  IF p_supply_id IS NOT NULL THEN
    UPDATE supplies SET
      paid_amount = round(COALESCE(paid_amount, 0) + v_amount, 2),
      payment_status = (CASE WHEN round(COALESCE(paid_amount, 0) + v_amount + v_returned, 2) >= round(total_amount, 2)
                             THEN 'paid' ELSE 'partial' END)::payment_status,
      updated_at = now()
    WHERE id = p_supply_id;
  END IF;

  v_balance := public.supplier_balance_adjust(p_supplier_id, -v_amount);
  PERFORM public.supplier_log_debt(p_supplier_id, 'payment', -v_amount, v_number, 'دفعة للمورد');

  RETURN jsonb_build_object('id', v_id, 'payment_number', v_number, 'balance', v_balance);
END $$;
REVOKE ALL ON FUNCTION public.supplier_create_payment(uuid, numeric, date, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_create_payment(uuid, numeric, date, text, text, text, uuid) TO authenticated;

-- ---------- Purchase requests ----------

-- p_items: [{item_id, supplier_id, requested_quantity, estimated_unit_price, notes}]
CREATE OR REPLACE FUNCTION public.purchase_create_request(
  p_branch_id uuid, p_priority integer, p_notes text, p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'purchase_manager', 'branch_supervisor');
  v_id uuid;
  v_number text;
BEGIN
  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'اختر الفرع' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_priority, 1) NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'الأولوية غير صحيحة' USING ERRCODE = 'P0001';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إضافة صنف واحد على الأقل' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS x(item_id uuid, requested_quantity numeric, estimated_unit_price numeric)
             WHERE x.item_id IS NULL OR x.requested_quantity IS NULL OR round(x.requested_quantity, 3) <= 0
                OR x.estimated_unit_price < 0) THEN
    RAISE EXCEPTION 'كل صنف يحتاج كمية أكبر من صفر وسعراً تقديرياً غير سالب' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS x(item_id uuid)
             WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.id = x.item_id)) THEN
    RAISE EXCEPTION 'يوجد صنف غير موجود في القائمة' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS x(supplier_id uuid)
             WHERE x.supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.id = x.supplier_id)) THEN
    RAISE EXCEPTION 'يوجد مورد غير موجود في القائمة' USING ERRCODE = 'P0001';
  END IF;

  v_number := public.next_document_number('PR');
  INSERT INTO purchase_requests (request_number, request_date, branch_id, status, priority, notes, total_items,
                                 total_quantity, estimated_cost, requested_by, requested_at)
  SELECT v_number, public.purchase_today(), p_branch_id, 'pending', COALESCE(p_priority, 1), NULLIF(btrim(p_notes), ''),
         count(*), round(sum(round(x.requested_quantity, 3)), 3),
         round(COALESCE(sum(round(round(x.requested_quantity, 3) * round(COALESCE(x.estimated_unit_price, 0), 2), 2)), 0), 2),
         v_user, now()
  FROM jsonb_to_recordset(p_items) AS x(requested_quantity numeric, estimated_unit_price numeric)
  RETURNING id INTO v_id;

  INSERT INTO purchase_request_items (request_id, item_id, supplier_id, requested_quantity, estimated_unit_price,
                                      estimated_total, notes, item_status)
  SELECT v_id, x.item_id, x.supplier_id, round(x.requested_quantity, 3), round(x.estimated_unit_price, 2),
         round(round(x.requested_quantity, 3) * round(COALESCE(x.estimated_unit_price, 0), 2), 2),
         NULLIF(btrim(x.notes), ''), 'pending'
  FROM jsonb_to_recordset(p_items) AS x(item_id uuid, supplier_id uuid, requested_quantity numeric,
                                       estimated_unit_price numeric, notes text);

  RETURN jsonb_build_object('id', v_id, 'request_number', v_number);
END $$;
REVOKE ALL ON FUNCTION public.purchase_create_request(uuid, integer, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_create_request(uuid, integer, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.purchase_approve_request(p_request_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'purchase_manager');
  v_status text;
BEGIN
  SELECT status::text INTO v_status FROM purchase_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'طلب الشراء غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF v_status NOT IN ('draft', 'pending') THEN
    RAISE EXCEPTION 'لا يمكن اعتماد الطلب، حالته الحالية: %', public.purchase_status_label(v_status) USING ERRCODE = 'P0001';
  END IF;
  UPDATE purchase_requests SET status = 'approved', approved_by = v_user, approved_at = now(), updated_at = now()
  WHERE id = p_request_id;
  UPDATE purchase_request_items SET approved_quantity = requested_quantity, item_status = 'approved'
  WHERE request_id = p_request_id;
END $$;
REVOKE ALL ON FUNCTION public.purchase_approve_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_approve_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.purchase_reject_request(p_request_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'purchase_manager');
  v_status text;
BEGIN
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'يجب إدخال سبب الرفض' USING ERRCODE = 'P0001';
  END IF;
  SELECT status::text INTO v_status FROM purchase_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'طلب الشراء غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF v_status NOT IN ('draft', 'pending') THEN
    RAISE EXCEPTION 'لا يمكن رفض الطلب، حالته الحالية: %', public.purchase_status_label(v_status) USING ERRCODE = 'P0001';
  END IF;
  UPDATE purchase_requests SET status = 'rejected', rejected_by = v_user, rejected_at = now(),
         rejection_reason = btrim(p_reason), updated_at = now()
  WHERE id = p_request_id;
  UPDATE purchase_request_items SET item_status = 'rejected' WHERE request_id = p_request_id;
END $$;
REVOKE ALL ON FUNCTION public.purchase_reject_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_reject_request(uuid, text) TO authenticated;

-- ---------- Purchase orders ----------

-- Creates a pending purchase order with its lines (optionally from an approved request).
-- No money or stock moves here: credit debt is booked on approval, stock on receipt.
-- p_items: [{item_id, quantity, unit_price, notes, request_item_id}]
CREATE OR REPLACE FUNCTION public.purchase_create_order(
  p_supplier_id uuid, p_branch_id uuid, p_payment_type text, p_expected_delivery_date date,
  p_notes text, p_items jsonb, p_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'purchase_manager', 'warehouse_manager');
  v_status supplier_status;
  v_total numeric;
  v_request_status text;
  v_id uuid;
  v_number text;
BEGIN
  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'اختر الفرع' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM suppliers WHERE id = p_supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'اختر المورد' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'المورد غير نشط' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_payment_type, '') NOT IN ('cash', 'credit') THEN
    RAISE EXCEPTION 'طريقة الدفع غير صحيحة' USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_delivery_date IS NOT NULL AND p_expected_delivery_date < public.purchase_today() THEN
    RAISE EXCEPTION 'تاريخ التسليم المتوقع لا يمكن أن يكون في الماضي' USING ERRCODE = 'P0001';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إضافة صنف واحد على الأقل مع السعر' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS x(item_id uuid, quantity numeric, unit_price numeric)
             WHERE x.item_id IS NULL OR x.quantity IS NULL OR round(x.quantity, 3) <= 0
                OR x.unit_price IS NULL OR round(x.unit_price, 2) <= 0) THEN
    RAISE EXCEPTION 'كل صنف يحتاج كمية وسعراً أكبر من صفر' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS x(item_id uuid)
             WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.id = x.item_id)) THEN
    RAISE EXCEPTION 'يوجد صنف غير موجود في القائمة' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(round(round(x.quantity, 3) * round(x.unit_price, 2), 2)), 0) INTO v_total
  FROM jsonb_to_recordset(p_items) AS x(quantity numeric, unit_price numeric);

  -- Early credit-limit check (the debt itself is booked and re-checked on approval).
  IF p_payment_type = 'credit' THEN
    PERFORM public.supplier_check_credit_limit(p_supplier_id, v_total);
  END IF;

  -- A request may be bought with several orders: each order covers request lines not ordered yet.
  IF p_request_id IS NOT NULL THEN
    SELECT status::text INTO v_request_status FROM purchase_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'طلب الشراء غير موجود' USING ERRCODE = 'P0001';
    END IF;
    IF v_request_status NOT IN ('approved', 'ordered', 'partially_received') THEN
      RAISE EXCEPTION 'لا يمكن إنشاء أمر شراء من هذا الطلب، حالته الحالية: %', public.purchase_status_label(v_request_status)
        USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS x(request_item_id uuid) WHERE x.request_item_id IS NOT NULL) THEN
      RAISE EXCEPTION 'أمر الشراء لا يحتوي على أي صنف من طلب الشراء' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS x(item_id uuid, request_item_id uuid)
             WHERE x.request_item_id IS NOT NULL
               AND (p_request_id IS NULL OR NOT EXISTS (SELECT 1 FROM purchase_request_items ri
                                                       WHERE ri.id = x.request_item_id AND ri.request_id = p_request_id))) THEN
    RAISE EXCEPTION 'يوجد صنف لا يخص طلب الشراء المحدد' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS x(item_id uuid, request_item_id uuid)
             JOIN purchase_request_items ri ON ri.id = x.request_item_id
             WHERE ri.item_id IS DISTINCT FROM x.item_id) THEN
    RAISE EXCEPTION 'يوجد صنف لا يطابق سطر طلب الشراء المرتبط به' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(x.request_item_id) <> count(DISTINCT x.request_item_id)
      FROM jsonb_to_recordset(p_items) AS x(request_item_id uuid)) THEN
    RAISE EXCEPTION 'لا يمكن تكرار نفس سطر طلب الشراء في أمر الشراء' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS x(request_item_id uuid)
             JOIN purchase_request_items ri ON ri.id = x.request_item_id
             WHERE COALESCE(ri.item_status, '') <> 'approved') THEN
    RAISE EXCEPTION 'يوجد صنف من طلب الشراء تم إصدار أمر شراء له بالفعل أو غير معتمد، حدّث الصفحة' USING ERRCODE = 'P0001';
  END IF;

  v_number := public.next_document_number('PO');
  INSERT INTO purchase_orders (order_number, order_date, request_id, supplier_id, branch_id, subtotal, total_amount,
                               payment_type, paid_amount, remaining_amount, payment_status, status,
                               expected_delivery_date, notes, created_by)
  VALUES (v_number, public.purchase_today(), p_request_id, p_supplier_id, p_branch_id, v_total, v_total,
          p_payment_type, 0, v_total, 'pending', 'pending',
          p_expected_delivery_date, NULLIF(btrim(p_notes), ''), v_user)
  RETURNING id INTO v_id;

  INSERT INTO purchase_order_items (order_id, item_id, request_item_id, quantity, unit_price, total_price, notes)
  SELECT v_id, x.item_id, x.request_item_id, round(x.quantity, 3), round(x.unit_price, 2),
         round(round(x.quantity, 3) * round(x.unit_price, 2), 2), NULLIF(btrim(x.notes), '')
  FROM jsonb_to_recordset(p_items) AS x(item_id uuid, quantity numeric, unit_price numeric, notes text, request_item_id uuid);

  IF p_request_id IS NOT NULL THEN
    UPDATE purchase_request_items ri SET ordered_quantity = q.qty, item_status = 'ordered'
    FROM (SELECT x.request_item_id, round(sum(x.quantity), 3) AS qty
          FROM jsonb_to_recordset(p_items) AS x(quantity numeric, request_item_id uuid)
          WHERE x.request_item_id IS NOT NULL
          GROUP BY x.request_item_id) q
    WHERE ri.id = q.request_item_id;
    PERFORM public.purchase_sync_request(p_request_id);
  END IF;

  RETURN jsonb_build_object('id', v_id, 'order_number', v_number);
END $$;
REVOKE ALL ON FUNCTION public.purchase_create_order(uuid, uuid, text, date, text, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_create_order(uuid, uuid, text, date, text, jsonb, uuid) TO authenticated;

-- Approves a pending order. A credit order becomes supplier debt here (within the credit limit).
CREATE OR REPLACE FUNCTION public.purchase_approve_order(p_order_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'purchase_manager');
  v_po purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء غير موجود' USING ERRCODE = 'P0001';
  END IF;
  -- Separation of duties: only an admin may approve a purchase order they created themselves
  IF v_po.created_by = v_user AND NOT public.app_has_role('admin') THEN
    RAISE EXCEPTION 'لا يمكن اعتماد أمر شراء أنشأته بنفسك' USING ERRCODE = 'P0001';
  END IF;
  IF v_po.status NOT IN ('draft', 'pending') THEN
    RAISE EXCEPTION 'لا يمكن اعتماد أمر الشراء، حالته الحالية: %', public.purchase_status_label(v_po.status) USING ERRCODE = 'P0001';
  END IF;
  IF v_po.payment_type = 'credit' THEN
    PERFORM public.supplier_check_credit_limit(v_po.supplier_id, v_po.total_amount);
    PERFORM public.supplier_balance_adjust(v_po.supplier_id, v_po.total_amount);
    PERFORM public.supplier_log_debt(v_po.supplier_id, 'purchase_order', v_po.total_amount, v_po.order_number,
                                     'اعتماد أمر شراء آجل');
  END IF;
  UPDATE purchase_orders SET status = 'approved', approved_by = v_user, approved_at = now(), updated_at = now()
  WHERE id = p_order_id;
END $$;
REVOKE ALL ON FUNCTION public.purchase_approve_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_approve_order(uuid) TO authenticated;

-- Rejects a pending order. The reason is kept apart from the order's notes.
CREATE OR REPLACE FUNCTION public.purchase_reject_order(p_order_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'purchase_manager');
  v_po purchase_orders%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'يجب إدخال سبب الرفض' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF v_po.status NOT IN ('draft', 'pending') THEN
    RAISE EXCEPTION 'لا يمكن رفض أمر الشراء، حالته الحالية: %', public.purchase_status_label(v_po.status) USING ERRCODE = 'P0001';
  END IF;
  UPDATE purchase_orders SET status = 'rejected', rejection_reason = btrim(p_reason), rejected_by = v_user,
         rejected_at = now(), updated_at = now()
  WHERE id = p_order_id;
  PERFORM public.purchase_release_request(v_po.request_id, p_order_id);
END $$;
REVOKE ALL ON FUNCTION public.purchase_reject_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_reject_order(uuid, text) TO authenticated;

-- Cancels an order that has not been received or paid. An approved credit order's debt is reversed.
CREATE OR REPLACE FUNCTION public.purchase_cancel_order(p_order_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'purchase_manager');
  v_po purchase_orders%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'يجب إدخال سبب الإلغاء' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF v_po.status NOT IN ('draft', 'pending', 'approved', 'sent') THEN
    RAISE EXCEPTION 'لا يمكن إلغاء أمر الشراء، حالته الحالية: %', public.purchase_status_label(v_po.status) USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_order_items WHERE order_id = p_order_id AND COALESCE(received_quantity, 0) > 0) THEN
    RAISE EXCEPTION 'لا يمكن إلغاء أمر شراء تم استلام جزء منه' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_order_payments WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'لا يمكن إلغاء أمر شراء عليه دفعات مسجلة' USING ERRCODE = 'P0001';
  END IF;
  IF v_po.payment_type = 'credit' AND v_po.status IN ('approved', 'sent') THEN
    PERFORM public.supplier_balance_adjust(v_po.supplier_id, -v_po.total_amount);
    PERFORM public.supplier_log_debt(v_po.supplier_id, 'purchase_order', -v_po.total_amount, v_po.order_number,
                                     'إلغاء أمر شراء آجل');
  END IF;
  UPDATE purchase_orders SET status = 'cancelled', cancellation_reason = btrim(p_reason), cancelled_by = v_user,
         cancelled_at = now(), updated_at = now()
  WHERE id = p_order_id;
  PERFORM public.purchase_release_request(v_po.request_id, p_order_id);
END $$;
REVOKE ALL ON FUNCTION public.purchase_cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_cancel_order(uuid, text) TO authenticated;

-- Receives an approved order into its branch's stock. p_lines NULL receives everything still outstanding;
-- otherwise [{id: purchase_order_items.id, quantity}] (partial receipt). The last unit price becomes the item's
-- purchase price. A cash order is paid for what is delivered.
CREATE OR REPLACE FUNCTION public.purchase_receive_order(p_order_id uuid, p_lines jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'purchase_manager', 'branch_supervisor');
  v_po purchase_orders%ROWTYPE;
  v_line record;
  v_remaining numeric;
  v_qty numeric;
  v_any boolean := false;
  v_all boolean;
  v_status text;
  v_paid numeric;
  v_name text;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(v_po.branch_id) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على فرع هذا الأمر' USING ERRCODE = '42501';
  END IF;
  IF v_po.status NOT IN ('approved', 'sent', 'partially_received') THEN
    RAISE EXCEPTION 'لا يمكن استلام أمر الشراء، حالته الحالية: %', public.purchase_status_label(v_po.status) USING ERRCODE = 'P0001';
  END IF;

  IF p_lines IS NOT NULL THEN
    IF jsonb_typeof(p_lines) <> 'array' THEN
      RAISE EXCEPTION 'بيانات الاستلام غير صحيحة' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(id uuid, quantity numeric)
               WHERE x.id IS NULL OR x.quantity IS NULL OR x.quantity < 0
                  OR NOT EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.id = x.id AND i.order_id = p_order_id)) THEN
      RAISE EXCEPTION 'بيانات الاستلام غير صحيحة' USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT count(*) <> count(DISTINCT x.id) FROM jsonb_to_recordset(p_lines) AS x(id uuid)) THEN
      RAISE EXCEPTION 'بيانات الاستلام غير صحيحة' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (item_id, branch_id) lock order, like sales, counts and movements, so concurrent stock changes can't deadlock
  PERFORM 1 FROM inventory
  WHERE branch_id = v_po.branch_id
    AND item_id IN (SELECT poi.item_id FROM purchase_order_items poi WHERE poi.order_id = p_order_id)
  ORDER BY item_id, branch_id
  FOR UPDATE;

  FOR v_line IN
    SELECT * FROM purchase_order_items WHERE order_id = p_order_id ORDER BY item_id, created_at, id FOR UPDATE
  LOOP
    v_remaining := round(v_line.quantity - COALESCE(v_line.received_quantity, 0), 3);
    IF p_lines IS NULL THEN
      v_qty := GREATEST(v_remaining, 0);
    ELSE
      SELECT round(x.quantity, 3) INTO v_qty
      FROM jsonb_to_recordset(p_lines) AS x(id uuid, quantity numeric) WHERE x.id = v_line.id;
      v_qty := COALESCE(v_qty, 0);
    END IF;
    IF v_qty > v_remaining THEN
      SELECT COALESCE(name_ar, name) INTO v_name FROM items WHERE id = v_line.item_id;
      RAISE EXCEPTION 'الكمية المستلمة للصنف "%" أكبر من المتبقي (%)', v_name, v_remaining USING ERRCODE = 'P0001';
    END IF;
    CONTINUE WHEN v_qty <= 0;

    v_any := true;
    PERFORM public.stock_adjust(v_po.branch_id, v_line.item_id, v_qty, 'supply', 'purchase_order', p_order_id,
                                'استلام أمر شراء ' || v_po.order_number, v_line.unit_price);
    UPDATE purchase_order_items SET received_quantity = round(COALESCE(received_quantity, 0) + v_qty, 3)
    WHERE id = v_line.id;
    UPDATE inventory SET last_restock_date = now() WHERE branch_id = v_po.branch_id AND item_id = v_line.item_id;
    IF v_line.unit_price > 0 THEN
      UPDATE items SET purchase_price = v_line.unit_price, updated_at = now()
      WHERE id = v_line.item_id AND purchase_price IS DISTINCT FROM v_line.unit_price;
    END IF;
    IF v_line.request_item_id IS NOT NULL THEN
      UPDATE purchase_request_items SET received_quantity = round(COALESCE(received_quantity, 0) + v_qty, 3)
      WHERE id = v_line.request_item_id;
    END IF;
  END LOOP;

  IF NOT v_any THEN
    RAISE EXCEPTION 'أدخل كمية مستلمة لصنف واحد على الأقل' USING ERRCODE = 'P0001';
  END IF;

  v_all := NOT EXISTS (SELECT 1 FROM purchase_order_items
                       WHERE order_id = p_order_id AND COALESCE(received_quantity, 0) < quantity);
  v_status := CASE WHEN v_all THEN 'received' ELSE 'partially_received' END;

  IF v_po.payment_type = 'cash' THEN
    IF v_all THEN
      v_paid := round(v_po.total_amount, 2);
    ELSE
      SELECT LEAST(round(v_po.total_amount, 2), COALESCE(round(sum(round(COALESCE(received_quantity, 0) * unit_price, 2)), 2), 0))
        INTO v_paid
      FROM purchase_order_items WHERE order_id = p_order_id;
    END IF;
    UPDATE purchase_orders SET
      status = v_status, received_by = v_user, received_at = now(), updated_at = now(),
      paid_amount = v_paid, remaining_amount = round(total_amount - v_paid, 2),
      payment_status = CASE WHEN v_paid >= round(total_amount, 2) THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'pending' END
    WHERE id = p_order_id;
  ELSE
    UPDATE purchase_orders SET status = v_status, received_by = v_user, received_at = now(), updated_at = now()
    WHERE id = p_order_id;
  END IF;

  -- The request is completed only when every one of its lines is ordered and received.
  PERFORM public.purchase_sync_request(v_po.request_id);

  RETURN jsonb_build_object('status', v_status);
END $$;
REVOKE ALL ON FUNCTION public.purchase_receive_order(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_receive_order(uuid, jsonb) TO authenticated;

-- Pays (part of) an approved credit order: never more than what is left on it or what the supplier is owed.
CREATE OR REPLACE FUNCTION public.purchase_add_payment(
  p_order_id uuid, p_amount numeric, p_payment_method text, p_reference_number text DEFAULT NULL,
  p_notes text DEFAULT NULL, p_payment_date date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'purchase_manager');
  v_amount numeric := round(p_amount, 2);
  v_date date := COALESCE(p_payment_date, public.purchase_today());
  v_po purchase_orders%ROWTYPE;
  v_paid numeric;
  v_remaining numeric;
  v_balance numeric;
  v_number text;
BEGIN
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'يجب إدخال مبلغ صحيح' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_payment_method, '') NOT IN ('cash', 'bank_transfer', 'check') THEN
    RAISE EXCEPTION 'طريقة الدفع غير صحيحة' USING ERRCODE = 'P0001';
  END IF;
  IF v_date > public.purchase_today() THEN
    RAISE EXCEPTION 'لا يمكن تسجيل دفعة بتاريخ مستقبلي' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_po FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF v_po.payment_type <> 'credit' THEN
    RAISE EXCEPTION 'الدفعات تسجل لأوامر الشراء الآجلة فقط' USING ERRCODE = 'P0001';
  END IF;
  IF v_po.status NOT IN ('approved', 'sent', 'partially_received', 'received') THEN
    RAISE EXCEPTION 'لا يمكن تسجيل دفعة لأمر شراء حالته: %', public.purchase_status_label(v_po.status) USING ERRCODE = 'P0001';
  END IF;
  v_paid := round(COALESCE((SELECT sum(amount) FROM purchase_order_payments WHERE order_id = p_order_id), 0), 2);
  v_remaining := round(v_po.total_amount - v_paid, 2);
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'تم سداد أمر الشراء بالكامل' USING ERRCODE = 'P0001';
  END IF;
  IF v_amount > v_remaining THEN
    RAISE EXCEPTION 'المبلغ المدخل أكبر من المبلغ المتبقي (% ج.م)', v_remaining USING ERRCODE = 'P0001';
  END IF;

  SELECT round(COALESCE(current_balance, 0), 2) INTO v_balance FROM suppliers WHERE id = v_po.supplier_id FOR UPDATE;
  IF v_amount > v_balance THEN
    RAISE EXCEPTION 'المبلغ أكبر من مديونية المورد الحالية (% ج.م)', v_balance USING ERRCODE = 'P0001';
  END IF;

  v_number := public.next_document_number('POPAY');
  INSERT INTO purchase_order_payments (order_id, payment_number, payment_date, amount, payment_method,
                                       reference_number, notes, created_by)
  VALUES (p_order_id, v_number, v_date, v_amount, p_payment_method, NULLIF(btrim(p_reference_number), ''),
          NULLIF(btrim(p_notes), ''), v_user);

  v_paid := round(v_paid + v_amount, 2);
  v_remaining := round(v_po.total_amount - v_paid, 2);
  UPDATE purchase_orders SET paid_amount = v_paid, remaining_amount = v_remaining,
         payment_status = CASE WHEN v_remaining <= 0 THEN 'paid' ELSE 'partial' END, updated_at = now()
  WHERE id = p_order_id;

  PERFORM public.supplier_balance_adjust(v_po.supplier_id, -v_amount);
  PERFORM public.supplier_log_debt(v_po.supplier_id, 'payment', -v_amount, v_number,
                                   'دفعة أمر شراء ' || v_po.order_number);

  RETURN jsonb_build_object('payment_number', v_number, 'paid_amount', v_paid, 'remaining_amount', v_remaining);
END $$;
REVOKE ALL ON FUNCTION public.purchase_add_payment(uuid, numeric, text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_add_payment(uuid, numeric, text, text, text, date) TO authenticated;

-- ---------- Reports ----------

-- Raises unless [p_from, p_to] is a valid inclusive date range.
CREATE OR REPLACE FUNCTION public.report_check_range(p_from date, p_to date) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'حدد تاريخ البداية وتاريخ النهاية' USING ERRCODE = 'P0001';
  END IF;
  IF p_from > p_to THEN
    RAISE EXCEPTION 'تاريخ البداية بعد تاريخ النهاية' USING ERRCODE = 'P0001';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.report_check_range(date, date) FROM PUBLIC, anon, authenticated;

-- Branch a report may show: cross-branch roles get what they asked for (NULL = all branches),
-- everyone else only their own branch.
CREATE OR REPLACE FUNCTION public.report_scope_branch(p_branch_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_own uuid;
BEGIN
  IF public.app_has_role('admin', 'warehouse_manager', 'purchase_manager') THEN
    RETURN p_branch_id;
  END IF;
  v_own := public.app_user_branch();
  IF v_own IS NULL THEN
    RAISE EXCEPTION 'لا يوجد فرع مرتبط بحسابك' USING ERRCODE = 'P0001';
  END IF;
  IF p_branch_id IS NOT NULL AND p_branch_id <> v_own THEN
    RAISE EXCEPTION 'ليس لديك صلاحية لعرض بيانات هذا الفرع' USING ERRCODE = '42501';
  END IF;
  RETURN v_own;
END $$;
REVOKE ALL ON FUNCTION public.report_scope_branch(uuid) FROM PUBLIC, anon, authenticated;

-- Stock summary (NULL = all branches). Low stock: below the branch minimum (inventory.min_quantity),
-- or the item minimum (items.min_stock_level) when the branch has none; a minimum of 0 means "not tracked".
CREATE OR REPLACE FUNCTION public.report_inventory_summary(p_branch_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH inv AS (
    SELECT i.quantity,
           COALESCE(NULLIF(i.min_quantity, 0), it.min_stock_level, 0) AS threshold,
           COALESCE(it.purchase_price, 0) AS price,
           COALESCE(c.name_ar, 'غير مصنف') AS category
    FROM inventory i
    JOIN items it ON it.id = i.item_id
    LEFT JOIN categories c ON c.id = it.category_id
    WHERE p_branch_id IS NULL OR i.branch_id = p_branch_id
  )
  SELECT jsonb_build_object(
    'totalItems', (SELECT count(*) FROM inv),
    'lowStockItems', (SELECT count(*) FROM inv WHERE threshold > 0 AND quantity < threshold),
    'outOfStockItems', (SELECT count(*) FROM inv WHERE quantity <= 0),
    'totalValue', (SELECT COALESCE(round(sum(quantity * price), 2), 0) FROM inv),
    'itemsByCategory', (SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'count', n, 'value', v)
                                                  ORDER BY v DESC, category), '[]'::jsonb)
                        FROM (SELECT category, count(*) AS n, COALESCE(round(sum(quantity * price), 2), 0) AS v
                              FROM inv GROUP BY category) t),
    'stockMovements', '[]'::jsonb
  )
$$;
REVOKE ALL ON FUNCTION public.report_inventory_summary(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.report_inventory(p_branch_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor', 'purchase_manager');
  RETURN public.report_inventory_summary(public.report_scope_branch(p_branch_id));
END $$;
REVOKE ALL ON FUNCTION public.report_inventory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_inventory(uuid) TO authenticated;

-- Sales for Cairo days p_from..p_to (inclusive). Revenue counts paid, not cancelled orders only;
-- cancelled and unpaid orders are reported separately.
CREATE OR REPLACE FUNCTION public.report_sales(p_from date, p_to date, p_branch_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
BEGIN
  PERFORM public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  v_branch := public.report_scope_branch(p_branch_id);
  PERFORM public.report_check_range(p_from, p_to);
  v_start := p_from::timestamp AT TIME ZONE 'Africa/Cairo';
  v_end := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo';

  WITH o AS (
    SELECT id, status::text AS status, COALESCE(total_amount, 0) AS total_amount,
           payment_method::text AS payment_method, created_at,
           (paid_at IS NOT NULL AND status <> 'cancelled') AS is_sale
    FROM orders
    WHERE created_at >= v_start AND created_at < v_end
      AND (v_branch IS NULL OR branch_id = v_branch)
  ), s AS (
    SELECT * FROM o WHERE is_sale
  )
  SELECT jsonb_build_object(
    'totalOrders', (SELECT count(*) FROM s),
    'totalRevenue', (SELECT COALESCE(round(sum(total_amount), 2), 0) FROM s),
    'averageOrderValue', (SELECT CASE WHEN count(*) > 0 THEN round(sum(total_amount) / count(*), 2) ELSE 0 END FROM s),
    'ordersByStatus', (SELECT COALESCE(jsonb_agg(jsonb_build_object('status', status, 'count', n) ORDER BY n DESC, status), '[]'::jsonb)
                       FROM (SELECT status, count(*) AS n FROM o GROUP BY status) t),
    'ordersByPaymentMethod', (SELECT COALESCE(jsonb_agg(jsonb_build_object('method', method, 'count', n, 'total', total)
                                                        ORDER BY total DESC, method), '[]'::jsonb)
                              FROM (SELECT COALESCE(payment_method, 'unknown') AS method, count(*) AS n,
                                           round(sum(total_amount), 2) AS total
                                    FROM s GROUP BY 1) t),
    'dailySales', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'orders', n, 'revenue', r) ORDER BY d), '[]'::jsonb)
                   FROM (SELECT (created_at AT TIME ZONE 'Africa/Cairo')::date AS d, count(*) AS n,
                                round(sum(total_amount), 2) AS r
                         FROM s GROUP BY 1) t),
    'topItems', (SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id', item_id, 'name_ar', name_ar, 'quantity', quantity,
                                                              'revenue', revenue) ORDER BY revenue DESC, quantity DESC), '[]'::jsonb)
                 FROM (SELECT oi.item_id, COALESCE(it.name_ar, it.name, '-') AS name_ar,
                              round(sum(oi.quantity), 3) AS quantity, round(sum(COALESCE(oi.total_price, 0)), 2) AS revenue
                       FROM order_items oi
                       JOIN s ON s.id = oi.order_id
                       LEFT JOIN items it ON it.id = oi.item_id
                       GROUP BY oi.item_id, it.name_ar, it.name
                       ORDER BY revenue DESC, quantity DESC
                       LIMIT 10) t),
    'cancelledOrders', (SELECT jsonb_build_object('count', count(*), 'total', COALESCE(round(sum(total_amount), 2), 0))
                        FROM o WHERE status = 'cancelled'),
    'unpaidOrders', (SELECT jsonb_build_object('count', count(*), 'total', COALESCE(round(sum(total_amount), 2), 0))
                     FROM o WHERE status <> 'cancelled' AND NOT is_sale)
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.report_sales(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_sales(date, date, uuid) TO authenticated;

-- Supplier statement for Cairo days p_from..p_to: opening balance, every ledger entry with a running balance,
-- closing balance, and the period's totals per kind:
--   opening + purchases (net of cancellations) + manual debts - payments - returns = closing.
CREATE OR REPLACE FUNCTION public.report_supplier_statement(p_supplier_id uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_supplier jsonb;
  v_opening numeric;
  v_rows jsonb;
  v_debit numeric;
  v_credit numeric;
  v_manual numeric;
  v_purchases numeric;
  v_payments numeric;
  v_returns numeric;
BEGIN
  PERFORM public.app_require_role('admin', 'warehouse_manager', 'purchase_manager');
  PERFORM public.report_check_range(p_from, p_to);
  SELECT jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'name_ar', s.name_ar, 'phone', s.phone,
                            'current_balance', round(COALESCE(s.current_balance, 0), 2),
                            'credit_limit', round(COALESCE(s.credit_limit, 0), 2), 'status', s.status)
    INTO v_supplier
  FROM suppliers s WHERE s.id = p_supplier_id;
  IF v_supplier IS NULL THEN
    RAISE EXCEPTION 'المورد غير موجود' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(round(sum(e.debit - e.credit), 2), 0) INTO v_opening
  FROM public.supplier_ledger_entries(p_supplier_id) e WHERE e.entry_date < p_from;

  WITH p AS (
    SELECT * FROM public.supplier_ledger_entries(p_supplier_id) e WHERE e.entry_date BETWEEN p_from AND p_to
  ), r AS (
    -- Same-time entries: debts before payments, so the running balance never dips artificially.
    SELECT p.*, v_opening + sum(p.debit - p.credit) OVER (ORDER BY p.entry_date, p.entry_at, (p.debit <= 0), p.reference, p.source_id
                                                          ROWS UNBOUNDED PRECEDING) AS running
    FROM p
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', entry_type || ':' || source_id, 'date', entry_date, 'kind', entry_type,
           'type', CASE WHEN entry_type IN ('po_payment', 'supplier_payment') THEN 'payment'
                        WHEN entry_type IN ('return', 'purchase_order_cancel') THEN 'return'
                        ELSE 'supply' END,
           'reference', reference, 'description', description, 'debit', debit, 'credit', credit,
           'balance', round(running, 2))
           ORDER BY entry_date, entry_at, (debit <= 0), reference, source_id), '[]'::jsonb),
         COALESCE(round(sum(debit), 2), 0),
         COALESCE(round(sum(credit), 2), 0),
         COALESCE(round(sum(debit - credit) FILTER (WHERE entry_type = 'manual_debt'), 2), 0),
         COALESCE(round(sum(debit - credit) FILTER (WHERE entry_type IN ('purchase_order', 'purchase_order_cancel', 'supply')), 2), 0),
         COALESCE(round(sum(credit - debit) FILTER (WHERE entry_type IN ('po_payment', 'supplier_payment')), 2), 0),
         COALESCE(round(sum(credit - debit) FILTER (WHERE entry_type = 'return'), 2), 0)
    INTO v_rows, v_debit, v_credit, v_manual, v_purchases, v_payments, v_returns
  FROM r;

  RETURN jsonb_build_object(
    'supplier', v_supplier,
    'openingBalance', v_opening,
    'transactions', v_rows,
    'totalDebit', v_debit,
    'totalCredit', v_credit,
    'closingBalance', round(v_opening + v_debit - v_credit, 2),
    'manualDebtTotal', v_manual,
    'totalPurchases', v_purchases,
    'totalPayments', v_payments,
    'totalReturns', v_returns
  );
END $$;
REVOKE ALL ON FUNCTION public.report_supplier_statement(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_supplier_statement(uuid, date, date) TO authenticated;

-- All suppliers for Cairo days p_from..p_to: per-supplier opening/purchases/manual debts/payments/returns/closing,
-- plus the purchase and payment entries of the period. Same ledger as the statement.
CREATE OR REPLACE FUNCTION public.report_suppliers_summary(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.app_require_role('admin', 'warehouse_manager', 'purchase_manager');
  PERFORM public.report_check_range(p_from, p_to);

  WITH e AS (
    SELECT l.*, (l.entry_date >= p_from) AS in_period
    FROM public.supplier_ledger_entries(NULL) l
    WHERE l.entry_date <= p_to
  ), per AS (
    SELECT e.supplier_id,
           COALESCE(round(sum(e.debit - e.credit) FILTER (WHERE NOT e.in_period), 2), 0) AS opening,
           COALESCE(round(sum(e.debit - e.credit) FILTER (WHERE e.in_period AND e.entry_type IN ('purchase_order', 'purchase_order_cancel', 'supply')), 2), 0) AS purchases,
           COALESCE(round(sum(e.debit - e.credit) FILTER (WHERE e.in_period AND e.entry_type = 'manual_debt'), 2), 0) AS manual_debts,
           COALESCE(round(sum(e.credit - e.debit) FILTER (WHERE e.in_period AND e.entry_type IN ('po_payment', 'supplier_payment')), 2), 0) AS payments,
           COALESCE(round(sum(e.credit - e.debit) FILTER (WHERE e.in_period AND e.entry_type = 'return'), 2), 0) AS returns,
           COALESCE(round(sum(e.debit - e.credit), 2), 0) AS closing,
           count(*) FILTER (WHERE e.in_period) AS period_entries
    FROM e GROUP BY e.supplier_id
  ), named AS (
    SELECT per.*, COALESCE(s.name_ar, s.name, '-') AS supplier_name
    FROM per JOIN suppliers s ON s.id = per.supplier_id
    WHERE per.period_entries > 0 OR per.opening <> 0 OR per.closing <> 0
  ), purchases AS (
    -- Payment status of each document: the order's own status; for a supply, total - paid - its approved
    -- returns (same rule as supplier_supply_returned / supplier_create_payment).
    SELECT e.*, COALESCE(s.name_ar, s.name, '-') AS supplier_name,
           CASE
             WHEN e.entry_type = 'purchase_order' AND po.status = 'cancelled' THEN 'cancelled'
             WHEN e.entry_type = 'purchase_order' THEN COALESCE(po.payment_status::text, 'pending')
             WHEN e.entry_type = 'supply' THEN
               CASE WHEN round(COALESCE(sp.total_amount, 0) - COALESCE(sp.paid_amount, 0) - COALESCE(rt.returned, 0), 2) <= 0 THEN 'paid'
                    WHEN COALESCE(sp.paid_amount, 0) > 0 OR COALESCE(rt.returned, 0) > 0 THEN 'partial'
                    ELSE 'pending' END
           END AS payment_status
    FROM e
    JOIN suppliers s ON s.id = e.supplier_id
    LEFT JOIN purchase_orders po ON e.entry_type = 'purchase_order' AND po.id = e.source_id
    LEFT JOIN supplies sp ON e.entry_type = 'supply' AND sp.id = e.source_id
    LEFT JOIN (SELECT r.supply_id, round(sum(COALESCE(r.total_amount, 0)), 2) AS returned
               FROM supplier_returns r
               WHERE r.supply_id IS NOT NULL AND r.status IN ('approved', 'received')
               GROUP BY r.supply_id) rt ON rt.supply_id = sp.id
    WHERE e.in_period AND e.entry_type IN ('purchase_order', 'purchase_order_cancel', 'supply')
  ), payments AS (
    SELECT e.*, COALESCE(s.name_ar, s.name, '-') AS supplier_name
    FROM e JOIN suppliers s ON s.id = e.supplier_id
    WHERE e.in_period AND e.entry_type IN ('po_payment', 'supplier_payment')
  )
  SELECT jsonb_build_object(
    'totalSupplies', (SELECT count(*) FROM purchases WHERE entry_type <> 'purchase_order_cancel'),
    'totalSuppliesValue', (SELECT COALESCE(round(sum(debit - credit), 2), 0) FROM purchases),
    'totalPayments', (SELECT count(*) FROM payments),
    'totalPaymentsValue', (SELECT COALESCE(round(sum(credit - debit), 2), 0) FROM payments),
    'totalReturnsValue', (SELECT COALESCE(round(sum(returns), 2), 0) FROM named),
    'totalManualDebts', (SELECT COALESCE(round(sum(manual_debts), 2), 0) FROM named),
    'openingBalance', (SELECT COALESCE(round(sum(opening), 2), 0) FROM named),
    'balance', (SELECT COALESCE(round(sum(closing), 2), 0) FROM named),
    'supplies', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'id', entry_type || ':' || source_id, 'supply_number', reference, 'supplier', supplier_name,
                   'total_amount', debit - credit, 'supply_date', entry_date, 'kind', entry_type, 'description', description,
                   'payment_status', payment_status)
                   ORDER BY entry_date DESC, entry_at DESC, source_id), '[]'::jsonb) FROM purchases),
    'payments', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'id', entry_type || ':' || source_id, 'payment_number', reference, 'supplier', supplier_name,
                   'amount', credit - debit, 'payment_date', entry_date, 'payment_method', COALESCE(payment_method, '-'),
                   'description', description)
                   ORDER BY entry_date DESC, entry_at DESC, source_id), '[]'::jsonb) FROM payments),
    'bySupplier', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'supplier_id', supplier_id, 'supplier', supplier_name, 'opening', opening, 'supplies', purchases,
                     'manual_debts', manual_debts, 'payments', payments, 'returns', returns, 'balance', closing)
                     ORDER BY supplier_name), '[]'::jsonb) FROM named)
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.report_suppliers_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_suppliers_summary(date, date) TO authenticated;

-- Key figures for Cairo days p_from..p_to (stock is the current snapshot).
CREATE OR REPLACE FUNCTION public.report_performance(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
  v_inventory jsonb;
  v_result jsonb;
BEGIN
  PERFORM public.app_require_role('admin', 'warehouse_manager');
  PERFORM public.report_check_range(p_from, p_to);
  v_start := p_from::timestamp AT TIME ZONE 'Africa/Cairo';
  v_end := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo';
  v_inventory := public.report_inventory_summary(NULL);

  WITH s AS (
    SELECT branch_id, COALESCE(total_amount, 0) AS total_amount
    FROM orders
    WHERE created_at >= v_start AND created_at < v_end AND paid_at IS NOT NULL AND status <> 'cancelled'
  ), t AS (
    SELECT status::text AS status FROM transfers WHERE created_at >= v_start AND created_at < v_end
  ), d AS (
    SELECT status::text AS status, COALESCE(total_cost, 0) AS total_cost
    FROM damages WHERE created_at >= v_start AND created_at < v_end
  ), l AS (
    SELECT entry_type, debit, credit, entry_date >= p_from AS in_period
    FROM public.supplier_ledger_entries(NULL) WHERE entry_date <= p_to
  )
  SELECT jsonb_build_object(
    'sales', (SELECT jsonb_build_object('total', COALESCE(round(sum(total_amount), 2), 0), 'count', count(*),
                                        'avgOrder', CASE WHEN count(*) > 0 THEN round(sum(total_amount) / count(*), 2) ELSE 0 END)
              FROM s),
    'inventory', jsonb_build_object('totalItems', v_inventory->'totalItems', 'lowStock', v_inventory->'lowStockItems',
                                    'outOfStock', v_inventory->'outOfStockItems', 'value', v_inventory->'totalValue'),
    'transfers', (SELECT jsonb_build_object('total', count(*), 'pending', count(*) FILTER (WHERE status = 'pending'),
                                            'completed', count(*) FILTER (WHERE status = 'received')) FROM t),
    'damages', (SELECT jsonb_build_object('total', count(*),
                                          'value', COALESCE(round(sum(total_cost) FILTER (WHERE status = 'approved'), 2), 0)) FROM d),
    'suppliers', (SELECT jsonb_build_object(
                    'totalSupplies', COALESCE(round(sum(debit - credit) FILTER (WHERE in_period AND entry_type IN ('purchase_order', 'purchase_order_cancel', 'supply')), 2), 0),
                    'totalPayments', COALESCE(round(sum(credit - debit) FILTER (WHERE in_period AND entry_type IN ('po_payment', 'supplier_payment')), 2), 0),
                    'balance', COALESCE(round(sum(debit - credit), 2), 0)) FROM l),
    'branches', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', COALESCE(b.name_ar, b.name), 'orders', COALESCE(x.n, 0),
                                                              'revenue', COALESCE(x.r, 0)) ORDER BY COALESCE(x.r, 0) DESC, b.name_ar), '[]'::jsonb)
                 FROM branches b
                 LEFT JOIN (SELECT branch_id, count(*) AS n, round(sum(total_amount), 2) AS r FROM s GROUP BY branch_id) x
                   ON x.branch_id = b.id)
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.report_performance(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_performance(date, date) TO authenticated;

-- Dashboard counters for today (Cairo). Non cross-branch roles always see their own branch.
CREATE OR REPLACE FUNCTION public.report_dashboard_stats(p_branch_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid;
  v_today date := public.purchase_today();
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
BEGIN
  PERFORM public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor', 'chef', 'cashier', 'purchase_manager');
  v_branch := public.report_scope_branch(p_branch_id);
  v_start := v_today::timestamp AT TIME ZONE 'Africa/Cairo';
  v_end := (v_today + 1)::timestamp AT TIME ZONE 'Africa/Cairo';

  SELECT jsonb_build_object(
    'totalBranches', (SELECT count(*) FROM branches),
    'totalSuppliers', (SELECT count(*) FROM suppliers WHERE status = 'active'),
    'totalItems', (SELECT count(*) FROM items WHERE status = 'active'),
    'totalOrders', (SELECT count(*) FROM orders
                    WHERE paid_at IS NOT NULL AND status <> 'cancelled' AND (v_branch IS NULL OR branch_id = v_branch)),
    'todayOrders', (SELECT count(*) FROM orders
                    WHERE created_at >= v_start AND created_at < v_end AND paid_at IS NOT NULL AND status <> 'cancelled'
                      AND (v_branch IS NULL OR branch_id = v_branch)),
    'todayRevenue', (SELECT COALESCE(round(sum(total_amount), 2), 0) FROM orders
                     WHERE created_at >= v_start AND created_at < v_end AND paid_at IS NOT NULL AND status <> 'cancelled'
                       AND (v_branch IS NULL OR branch_id = v_branch)),
    'pendingTransfers', (SELECT count(*) FROM transfers
                         WHERE status = 'pending'
                           AND (v_branch IS NULL OR from_branch_id = v_branch OR to_branch_id = v_branch)),
    'pendingDamages', (SELECT count(*) FROM damages WHERE status = 'pending' AND (v_branch IS NULL OR branch_id = v_branch)),
    'lowStockItems', (public.report_inventory_summary(v_branch)->'lowStockItems'),
    'pendingPurchaseRequests', (SELECT count(*) FROM purchase_requests
                                WHERE status = 'pending' AND (v_branch IS NULL OR branch_id = v_branch))
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.report_dashboard_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_dashboard_stats(uuid) TO authenticated;

-- ---------- Data fixes (re-runnable: a second run changes nothing) ----------

DO $$
DECLARE
  v_n integer;
BEGIN
  -- Credit orders: paid / remaining / payment status from the saved payments.
  UPDATE purchase_orders po SET
    paid_amount = x.paid,
    remaining_amount = GREATEST(round(po.total_amount - x.paid, 2), 0),
    payment_status = CASE WHEN x.paid <= 0 THEN 'pending'
                          WHEN x.paid >= round(po.total_amount, 2) THEN 'paid' ELSE 'partial' END
  FROM (SELECT o.id, round(COALESCE((SELECT sum(p.amount) FROM purchase_order_payments p WHERE p.order_id = o.id), 0), 2) AS paid
        FROM purchase_orders o WHERE o.payment_type = 'credit') x
  WHERE x.id = po.id
    AND (po.paid_amount IS DISTINCT FROM x.paid
         OR po.remaining_amount IS DISTINCT FROM GREATEST(round(po.total_amount - x.paid, 2), 0)
         OR po.payment_status IS DISTINCT FROM CASE WHEN x.paid <= 0 THEN 'pending'
                                                    WHEN x.paid >= round(po.total_amount, 2) THEN 'paid' ELSE 'partial' END);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RAISE NOTICE '050: recalculated payments of % credit purchase orders', v_n; END IF;

  -- Cash orders are paid on delivery: unpaid until received (the old screen marked them paid on creation).
  UPDATE purchase_orders SET paid_amount = 0, remaining_amount = round(total_amount, 2), payment_status = 'pending'
  WHERE payment_type = 'cash' AND status IN ('draft', 'pending', 'approved', 'sent', 'rejected', 'cancelled')
    AND (paid_amount IS DISTINCT FROM 0 OR remaining_amount IS DISTINCT FROM round(total_amount, 2)
         OR payment_status IS DISTINCT FROM 'pending');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RAISE NOTICE '050: reset % unreceived cash purchase orders to unpaid', v_n; END IF;

  UPDATE purchase_orders SET paid_amount = round(total_amount, 2), remaining_amount = 0, payment_status = 'paid'
  WHERE payment_type = 'cash' AND status = 'received'
    AND (paid_amount IS DISTINCT FROM round(total_amount, 2) OR remaining_amount IS DISTINCT FROM 0
         OR payment_status IS DISTINCT FROM 'paid');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RAISE NOTICE '050: marked % received cash purchase orders as paid', v_n; END IF;

  -- Supplier balances = the ledger (fixes balances booked for pending/rejected credit orders by the old screens).
  UPDATE suppliers s SET current_balance = l.balance, updated_at = now()
  FROM (SELECT s2.id, COALESCE(x.balance, 0) AS balance
        FROM suppliers s2
        LEFT JOIN (SELECT e.supplier_id, round(sum(e.debit - e.credit), 2) AS balance
                   FROM public.supplier_ledger_entries(NULL) e GROUP BY e.supplier_id) x ON x.supplier_id = s2.id) l
  WHERE l.id = s.id AND round(COALESCE(s.current_balance, 0), 2) IS DISTINCT FROM l.balance;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RAISE NOTICE '050: re-synced the balance of % suppliers with their ledger', v_n; END IF;
END $$;
