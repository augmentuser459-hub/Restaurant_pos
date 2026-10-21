-- ============================================
-- 005: Shared building blocks used by every module's migrations. Idempotent.
--   * app_* helpers: who is calling, and with which role/branch (users.id = auth.users.id, see 010)
--   * stock_adjust: the ONLY way stock quantities change (row lock, no lost updates, audit row)
--   * supplier_balance_adjust: atomic change of suppliers.current_balance
--   * next_document_number: collision-free document numbers (PREFIX-YYYYMM-00001)
-- ============================================

ALTER TYPE inventory_operation ADD VALUE IF NOT EXISTS 'sale';
ALTER TYPE inventory_operation ADD VALUE IF NOT EXISTS 'production';

-- ---------- Current app user ----------

CREATE OR REPLACE FUNCTION public.app_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id FROM public.users u WHERE u.id = auth.uid() AND u.status = 'active'
$$;

CREATE OR REPLACE FUNCTION public.app_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.name FROM public.users u JOIN public.roles r ON r.id = u.role_id
  WHERE u.id = auth.uid() AND u.status = 'active'
$$;

CREATE OR REPLACE FUNCTION public.app_user_branch() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.branch_id FROM public.users u WHERE u.id = auth.uid() AND u.status = 'active'
$$;

CREATE OR REPLACE FUNCTION public.app_has_role(VARIADIC p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.app_user_role() = ANY (p_roles), false)
$$;

-- Raises unless the caller is an active user with one of the roles. Returns the caller's users.id.
CREATE OR REPLACE FUNCTION public.app_require_role(VARIADIC p_roles text[]) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := public.app_user_id();
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'انتهت الجلسة، سجّل الدخول مرة أخرى' USING ERRCODE = '28000';
  END IF;
  IF NOT public.app_has_role(VARIADIC p_roles) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية لتنفيذ هذه العملية' USING ERRCODE = '42501';
  END IF;
  RETURN v_id;
END $$;

-- Admin, warehouse and purchase managers work across branches; everyone else only in their own branch.
CREATE OR REPLACE FUNCTION public.app_can_access_branch(p_branch_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.app_user_id() IS NULL THEN false
    WHEN public.app_has_role('admin', 'warehouse_manager', 'purchase_manager') THEN true
    ELSE p_branch_id IS NOT DISTINCT FROM public.app_user_branch()
  END
$$;

-- ---------- Stock ----------

-- Adds p_delta (negative = deduct) to one branch/item stock row under a row lock and logs it.
-- Raises (ERRCODE P0001, HINT 'INSUFFICIENT_STOCK') instead of going below zero.
-- Returns the new quantity, or NULL when the row is missing and p_create_if_missing is false.
-- Internal: callable only from other SECURITY DEFINER functions, never from the API.
CREATE OR REPLACE FUNCTION public.stock_adjust(
  p_branch_id uuid,
  p_item_id uuid,
  p_delta numeric,
  p_operation inventory_operation,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_unit_cost numeric DEFAULT NULL,
  p_create_if_missing boolean DEFAULT true
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_delta numeric := round(COALESCE(p_delta, 0), 3);
  v_before numeric;
  v_after numeric;
  v_user uuid;
  v_name text;
BEGIN
  IF p_branch_id IS NULL OR p_item_id IS NULL THEN
    RAISE EXCEPTION 'stock_adjust: branch and item are required';
  END IF;

  IF p_create_if_missing THEN
    INSERT INTO inventory (branch_id, item_id, quantity) VALUES (p_branch_id, p_item_id, 0)
    ON CONFLICT (branch_id, item_id) DO NOTHING;
  END IF;

  SELECT quantity INTO v_before FROM inventory
  WHERE branch_id = p_branch_id AND item_id = p_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_delta = 0 THEN
    RETURN v_before;
  END IF;

  v_after := round(v_before + v_delta, 3);
  IF v_after < 0 THEN
    SELECT COALESCE(name_ar, name) INTO v_name FROM items WHERE id = p_item_id;
    RAISE EXCEPTION 'الكمية غير كافية للصنف "%": المتاح % والمطلوب %', v_name, v_before, -v_delta
      USING ERRCODE = 'P0001', HINT = 'INSUFFICIENT_STOCK';
  END IF;

  UPDATE inventory SET quantity = v_after, updated_at = now()
  WHERE branch_id = p_branch_id AND item_id = p_item_id;

  v_user := public.app_user_id();
  IF v_user IS NOT NULL THEN
    INSERT INTO inventory_transactions
      (branch_id, item_id, operation_type, quantity, quantity_before, quantity_after,
       unit_cost, reference_type, reference_id, notes, created_by)
    VALUES
      (p_branch_id, p_item_id, p_operation, v_delta, v_before, v_after,
       p_unit_cost, p_reference_type, p_reference_id, p_notes, v_user);
  END IF;

  RETURN v_after;
END $$;

REVOKE ALL ON FUNCTION public.stock_adjust(uuid, uuid, numeric, inventory_operation, text, uuid, text, numeric, boolean)
  FROM PUBLIC, anon, authenticated;

-- ---------- Supplier balance ----------

-- current_balance > 0 means we owe the supplier. p_delta > 0 adds debt (credit purchase, manual debt),
-- p_delta < 0 reduces it (payment, approved return, reversal). Atomic; returns the new balance.
-- Internal: callable only from other SECURITY DEFINER functions.
CREATE OR REPLACE FUNCTION public.supplier_balance_adjust(p_supplier_id uuid, p_delta numeric) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_after numeric;
BEGIN
  UPDATE suppliers
  SET current_balance = round(COALESCE(current_balance, 0) + round(COALESCE(p_delta, 0), 2), 2),
      updated_at = now()
  WHERE id = p_supplier_id
  RETURNING current_balance INTO v_after;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المورد غير موجود' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_after;
END $$;

REVOKE ALL ON FUNCTION public.supplier_balance_adjust(uuid, numeric) FROM PUBLIC, anon, authenticated;

-- ---------- Document numbers ----------

CREATE TABLE IF NOT EXISTS public.document_counters (
  prefix text NOT NULL,
  period text NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, period)
);
ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_counters FROM anon, authenticated;

-- e.g. next_document_number('RET') -> 'RET-202610-00001'; the counter restarts every Cairo month.
CREATE OR REPLACE FUNCTION public.next_document_number(p_prefix text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prefix text := upper(p_prefix);
  v_period text := to_char(now() AT TIME ZONE 'Africa/Cairo', 'YYYYMM');
  v_n integer;
BEGIN
  INSERT INTO document_counters (prefix, period, last_value) VALUES (v_prefix, v_period, 1)
  ON CONFLICT (prefix, period) DO UPDATE SET last_value = document_counters.last_value + 1
  RETURNING last_value INTO v_n;
  RETURN v_prefix || '-' || v_period || '-' || lpad(v_n::text, 5, '0');
END $$;

REVOKE ALL ON FUNCTION public.next_document_number(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_document_number(text) TO authenticated;
