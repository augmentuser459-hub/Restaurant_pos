-- ============================================
-- 030: Items, stock list, categories, branches, daily counts, chef consumption, stock import. Idempotent.
--
-- Every write the stock pages make goes through these SECURITY DEFINER functions (API = authenticated only):
--   item_save / item_delete                      items                      admin, warehouse_manager (delete: admin)
--   item_category_save / item_category_delete    categories + item assignment  admin
--   inv_branch_save / inv_branch_delete          branches                   admin, warehouse_manager
--   inv_save_stock_row / inv_remove_stock_rows   stock list inline edit / "remove from this branch"
--   inv_import_stock                             CSV stock import (preview with p_dry_run, then apply)
--   daily_count_create / _submit / _approve / _reject
--   chef_consumption_record                      chef consumption           admin, warehouse_manager (as its page)
-- Stock changes (adjustments, counts, import, row removal): admin and warehouse_manager in any
-- branch, branch_supervisor in their own branch (inv_require_stock_access).
-- Quantities change only through stock_adjust (row lock, logged in inventory_transactions).
-- Chef consumption is stored as a daily_inventory_counts row with count_type 'morning' (the value the app has
-- always used); real counts are 'opening' / 'closing'.
-- ============================================

-- ---------- Data fixes and constraints ----------

-- items.barcode is UNIQUE: an empty string counts as a value (only NULLs may repeat), so store '' as NULL.
UPDATE items SET barcode = NULL WHERE barcode IS NOT NULL AND btrim(barcode) = '';

CREATE OR REPLACE FUNCTION public.item_normalize_barcode() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.barcode := NULLIF(btrim(NEW.barcode), '');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.item_normalize_barcode() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS items_normalize_barcode ON items;
CREATE TRIGGER items_normalize_barcode BEFORE INSERT OR UPDATE OF barcode ON items
  FOR EACH ROW EXECUTE FUNCTION public.item_normalize_barcode();

-- At most one main warehouse (stock list, new items and returns all look it up).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'branches_one_main_warehouse') THEN
    IF (SELECT count(*) FROM branches WHERE is_main_warehouse) <= 1 THEN
      CREATE UNIQUE INDEX branches_one_main_warehouse ON branches ((true)) WHERE is_main_warehouse;
    ELSE
      RAISE WARNING '030: more than one branch has is_main_warehouse = true; unique index branches_one_main_warehouse not created. Fix the data and re-run.';
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_daily_counts_branch_date ON daily_inventory_counts (branch_id, count_date);
CREATE INDEX IF NOT EXISTS idx_daily_counts_type ON daily_inventory_counts (count_type);
CREATE INDEX IF NOT EXISTS idx_daily_count_items_count ON daily_inventory_count_items (count_id);

-- ---------- Internal helpers ----------

-- Text -> number for user/file input: NULL when blank, 'NaN' when it is not a finite number. Never raises.
CREATE OR REPLACE FUNCTION public.inv_to_number(p_text text) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_text IS NULL OR btrim(p_text) = '' THEN NULL
    WHEN btrim(p_text) ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]{1,3})?$' THEN btrim(p_text)::numeric
    ELSE 'NaN'::numeric
  END
$$;
REVOKE ALL ON FUNCTION public.inv_to_number(text) FROM PUBLIC, anon, authenticated;

-- Optional non-negative number from a JSON object (missing / null / '' -> NULL). Raises an Arabic error otherwise.
CREATE OR REPLACE FUNCTION public.inv_json_number(p_obj jsonb, p_key text, p_label text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_num numeric := public.inv_to_number(p_obj ->> p_key);
BEGIN
  IF v_num IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_num = 'NaN'::numeric THEN
    RAISE EXCEPTION 'قيمة "%" غير صحيحة: %', p_label, p_obj ->> p_key USING ERRCODE = 'P0001';
  END IF;
  IF v_num < 0 THEN
    RAISE EXCEPTION 'قيمة "%" لا يمكن أن تكون سالبة', p_label USING ERRCODE = 'P0001';
  END IF;
  RETURN v_num;
END $$;
REVOKE ALL ON FUNCTION public.inv_json_number(jsonb, text, text) FROM PUBLIC, anon, authenticated;

-- Optional id from a JSON object (missing / null / '' -> NULL). Raises an Arabic error when it is not a uuid.
CREATE OR REPLACE FUNCTION public.inv_json_uuid(p_obj jsonb, p_key text, p_label text) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_text text := NULLIF(btrim(p_obj ->> p_key), '');
BEGIN
  IF v_text IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'قيمة "%" غير صحيحة، أعد تحميل الصفحة', p_label USING ERRCODE = 'P0001';
  END IF;
  RETURN v_text::uuid;
END $$;
REVOKE ALL ON FUNCTION public.inv_json_uuid(jsonb, text, text) FROM PUBLIC, anon, authenticated;

-- Optional true/false from a JSON object (missing / null / '' -> p_default). Raises an Arabic error otherwise.
CREATE OR REPLACE FUNCTION public.inv_json_bool(p_obj jsonb, p_key text, p_label text, p_default boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_text text := lower(NULLIF(btrim(p_obj ->> p_key), ''));
BEGIN
  IF v_text IS NULL THEN
    RETURN p_default;
  END IF;
  IF v_text NOT IN ('true', 'false') THEN
    RAISE EXCEPTION 'قيمة "%" غير صحيحة', p_label USING ERRCODE = 'P0001';
  END IF;
  RETURN v_text = 'true';
END $$;
REVOKE ALL ON FUNCTION public.inv_json_bool(jsonb, text, text, boolean) FROM PUBLIC, anon, authenticated;

-- Arabic letters folded so 'كرتونه' matches 'كرتونة' and 'إ' matches 'ا' (used to match unit names in imports).
CREATE OR REPLACE FUNCTION public.inv_fold_arabic(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(translate(btrim(COALESCE(p_text, '')), 'ةأإآىـ', 'هاااي'))
$$;
REVOKE ALL ON FUNCTION public.inv_fold_arabic(text) FROM PUBLIC, anon, authenticated;

-- Raises unless the caller may change stock in the branch: admin and warehouse_manager in any branch,
-- branch_supervisor in their own branch. Returns the caller's users.id.
CREATE OR REPLACE FUNCTION public.inv_require_stock_access(p_branch_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
BEGIN
  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'الفرع غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.app_can_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'لا يمكنك تعديل مخزون فرع غير فرعك' USING ERRCODE = '42501';
  END IF;
  RETURN v_user;
END $$;
REVOKE ALL ON FUNCTION public.inv_require_stock_access(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.inv_count_status_ar(p_status text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_status
    WHEN 'draft' THEN 'مسودة'
    WHEN 'completed' THEN 'بانتظار الاعتماد'
    WHEN 'approved' THEN 'معتمد'
    WHEN 'rejected' THEN 'مرفوض'
    ELSE COALESCE(p_status, '')
  END
$$;
REVOKE ALL ON FUNCTION public.inv_count_status_ar(text) FROM PUBLIC, anon, authenticated;

-- ---------- Items ----------

-- Creates (p_item_id NULL) or updates an item from a JSON object of item columns:
-- code, barcode, name, name_ar, description, unit_id, category_id, purchase_price, selling_price,
-- min_stock_level, max_stock_level, reorder_level, status. On update only the keys present are changed.
-- Empty barcode / optional text -> NULL. A new item gets an empty stock row in the main warehouse.
CREATE OR REPLACE FUNCTION public.item_save(p_item_id uuid, p_item jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager');
  v_new items%ROWTYPE;
  v_other text;
  v_main uuid;
  v_constraint text;
BEGIN
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN
    RAISE EXCEPTION 'بيانات الصنف غير صحيحة' USING ERRCODE = 'P0001';
  END IF;

  IF p_item_id IS NOT NULL THEN
    SELECT * INTO v_new FROM items WHERE id = p_item_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الصنف غير موجود أو تم حذفه' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_new.status := 'active';
    v_new.min_stock_level := 0;
    v_new.purchase_price := 0;
    v_new.selling_price := 0;
  END IF;

  IF p_item ? 'code' THEN v_new.code := btrim(p_item ->> 'code'); END IF;
  IF p_item ? 'barcode' THEN v_new.barcode := NULLIF(btrim(p_item ->> 'barcode'), ''); END IF;
  IF p_item ? 'name_ar' THEN v_new.name_ar := btrim(p_item ->> 'name_ar'); END IF;
  IF p_item ? 'name' THEN v_new.name := NULLIF(btrim(p_item ->> 'name'), ''); END IF;
  IF p_item ? 'description' THEN v_new.description := NULLIF(btrim(p_item ->> 'description'), ''); END IF;
  IF p_item ? 'unit_id' THEN v_new.unit_id := public.inv_json_uuid(p_item, 'unit_id', 'الوحدة'); END IF;
  IF p_item ? 'category_id' THEN v_new.category_id := public.inv_json_uuid(p_item, 'category_id', 'المجموعة'); END IF;
  IF p_item ? 'purchase_price' THEN
    v_new.purchase_price := round(COALESCE(public.inv_json_number(p_item, 'purchase_price', 'سعر الشراء'), 0), 2);
  END IF;
  IF p_item ? 'selling_price' THEN
    v_new.selling_price := round(COALESCE(public.inv_json_number(p_item, 'selling_price', 'سعر البيع'), 0), 2);
  END IF;
  IF p_item ? 'min_stock_level' THEN
    v_new.min_stock_level := round(COALESCE(public.inv_json_number(p_item, 'min_stock_level', 'الحد الأدنى'), 0), 3);
  END IF;
  IF p_item ? 'max_stock_level' THEN
    v_new.max_stock_level := round(public.inv_json_number(p_item, 'max_stock_level', 'الحد الأقصى'), 3);
  END IF;
  IF p_item ? 'reorder_level' THEN
    v_new.reorder_level := round(public.inv_json_number(p_item, 'reorder_level', 'حد إعادة الطلب'), 3);
  END IF;
  IF p_item ? 'status' THEN
    IF NOT COALESCE(NULLIF(p_item ->> 'status', ''), 'active') = ANY (enum_range(NULL::item_status)::text[]) THEN
      RAISE EXCEPTION 'حالة الصنف غير صحيحة' USING ERRCODE = 'P0001';
    END IF;
    v_new.status := COALESCE(NULLIF(p_item ->> 'status', ''), 'active')::item_status;
  END IF;

  IF COALESCE(v_new.code, '') = '' THEN
    RAISE EXCEPTION 'كود الصنف مطلوب' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_new.name_ar, '') = '' THEN
    RAISE EXCEPTION 'اسم الصنف (عربي) مطلوب' USING ERRCODE = 'P0001';
  END IF;
  v_new.name := COALESCE(NULLIF(btrim(v_new.name), ''), v_new.name_ar);
  IF v_new.unit_id IS NULL OR NOT EXISTS (SELECT 1 FROM units WHERE id = v_new.unit_id) THEN
    RAISE EXCEPTION 'اختر وحدة القياس' USING ERRCODE = 'P0001';
  END IF;
  IF v_new.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories WHERE id = v_new.category_id) THEN
    RAISE EXCEPTION 'المجموعة المختارة غير موجودة' USING ERRCODE = 'P0001';
  END IF;

  SELECT name_ar INTO v_other FROM items WHERE code = v_new.code AND id IS DISTINCT FROM p_item_id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'كود الصنف "%" موجود مسبقاً للصنف "%"', v_new.code, v_other USING ERRCODE = 'P0001';
  END IF;
  IF v_new.barcode IS NOT NULL THEN
    SELECT name_ar INTO v_other FROM items WHERE barcode = v_new.barcode AND id IS DISTINCT FROM p_item_id LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'الباركود "%" مستخدم للصنف "%"', v_new.barcode, v_other USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_item_id IS NULL THEN
    INSERT INTO items (code, barcode, name, name_ar, description, category_id, unit_id, purchase_price, selling_price,
                       min_stock_level, max_stock_level, reorder_level, status, created_by)
    VALUES (v_new.code, v_new.barcode, v_new.name, v_new.name_ar, v_new.description, v_new.category_id, v_new.unit_id,
            v_new.purchase_price, v_new.selling_price, v_new.min_stock_level, v_new.max_stock_level,
            v_new.reorder_level, v_new.status, v_user)
    RETURNING id INTO v_new.id;

    SELECT id INTO v_main FROM branches WHERE is_main_warehouse ORDER BY created_at LIMIT 1;
    IF v_main IS NOT NULL THEN
      INSERT INTO inventory (branch_id, item_id, quantity, min_quantity)
      VALUES (v_main, v_new.id, 0, COALESCE(v_new.min_stock_level, 0))
      ON CONFLICT (branch_id, item_id) DO NOTHING;
    END IF;
  ELSE
    UPDATE items SET
      code = v_new.code, barcode = v_new.barcode, name = v_new.name, name_ar = v_new.name_ar,
      description = v_new.description, category_id = v_new.category_id, unit_id = v_new.unit_id,
      purchase_price = v_new.purchase_price, selling_price = v_new.selling_price,
      min_stock_level = v_new.min_stock_level, max_stock_level = v_new.max_stock_level,
      reorder_level = v_new.reorder_level, status = v_new.status, updated_at = now()
    WHERE id = p_item_id;
  END IF;

  RETURN v_new.id;
EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  IF v_constraint = 'items_barcode_key' THEN
    RAISE EXCEPTION 'الباركود "%" مستخدم لصنف آخر', v_new.barcode USING ERRCODE = 'P0001';
  END IF;
  RAISE EXCEPTION 'كود الصنف "%" موجود مسبقاً', v_new.code USING ERRCODE = 'P0001';
END $$;
REVOKE ALL ON FUNCTION public.item_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.item_save(uuid, jsonb) TO authenticated;

-- Deletes an item from the system. Refused while it is a recipe ingredient, has stock in any branch, or is
-- referenced by any document (sales, transfers, supplies, POS...): make it inactive instead.
-- Its empty stock rows are removed with it.
CREATE OR REPLACE FUNCTION public.item_delete(p_item_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin');
  v_name text;
  v_n integer;
  v_where text;
BEGIN
  SELECT name_ar INTO v_name FROM items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود أو تم حذفه' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(DISTINCT recipe_item_id) INTO v_n FROM recipe_ingredients WHERE ingredient_item_id = p_item_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'لا يمكن حذف الصنف "%" لأنه مكوّن في % وصفة. احذفه من الوصفات أولاً أو اجعله غير نشط', v_name, v_n
      USING ERRCODE = 'P0001';
  END IF;

  SELECT string_agg(b.name_ar || ': ' || trim_scale(i.quantity)::text, '، ' ORDER BY b.name_ar) INTO v_where
  FROM inventory i JOIN branches b ON b.id = i.branch_id
  WHERE i.item_id = p_item_id AND i.quantity <> 0;
  IF v_where IS NOT NULL THEN
    RAISE EXCEPTION 'لا يمكن حذف الصنف "%" لأن له رصيداً (%). اجعله غير نشط بدلاً من الحذف', v_name, v_where
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    DELETE FROM inventory WHERE item_id = p_item_id;
    DELETE FROM items WHERE id = p_item_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'لا يمكن حذف الصنف "%" لارتباطه بعمليات سابقة (مبيعات أو تحويلات أو توريدات أو نقاط بيع). اجعله غير نشط بدلاً من الحذف', v_name
      USING ERRCODE = 'P0001';
  END;
END $$;
REVOKE ALL ON FUNCTION public.item_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.item_delete(uuid) TO authenticated;

-- ---------- Categories ----------

-- Creates (p_category_id NULL) or updates a category (keys: code, name, name_ar, description, sort_order,
-- is_active, is_kitchen; on update only the keys present change), then moves the listed items into it and
-- takes the listed items out of it (only items that are still in this category).
CREATE OR REPLACE FUNCTION public.item_category_save(
  p_category_id uuid,
  p_category jsonb,
  p_add_item_ids uuid[] DEFAULT NULL,
  p_remove_item_ids uuid[] DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin');
  v_new categories%ROWTYPE;
  v_data jsonb := COALESCE(p_category, '{}'::jsonb);
  v_other text;
BEGIN
  IF jsonb_typeof(v_data) <> 'object' THEN
    RAISE EXCEPTION 'بيانات المجموعة غير صحيحة' USING ERRCODE = 'P0001';
  END IF;

  IF p_category_id IS NOT NULL THEN
    SELECT * INTO v_new FROM categories WHERE id = p_category_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'المجموعة غير موجودة أو تم حذفها' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_new.sort_order := 0;
    v_new.is_active := true;
    v_new.is_kitchen := false;
  END IF;

  IF v_data ? 'code' THEN v_new.code := btrim(v_data ->> 'code'); END IF;
  IF v_data ? 'name_ar' THEN v_new.name_ar := btrim(v_data ->> 'name_ar'); END IF;
  IF v_data ? 'name' THEN v_new.name := NULLIF(btrim(v_data ->> 'name'), ''); END IF;
  IF v_data ? 'description' THEN v_new.description := NULLIF(btrim(v_data ->> 'description'), ''); END IF;
  IF v_data ? 'sort_order' THEN
    IF COALESCE(public.inv_json_number(v_data, 'sort_order', 'ترتيب العرض'), 0) > 100000 THEN
      RAISE EXCEPTION 'قيمة "ترتيب العرض" كبيرة جداً' USING ERRCODE = 'P0001';
    END IF;
    v_new.sort_order := round(COALESCE(public.inv_json_number(v_data, 'sort_order', 'ترتيب العرض'), 0));
  END IF;
  IF v_data ? 'is_active' THEN v_new.is_active := public.inv_json_bool(v_data, 'is_active', 'نشط', true); END IF;
  IF v_data ? 'is_kitchen' THEN v_new.is_kitchen := public.inv_json_bool(v_data, 'is_kitchen', 'مجموعة مطبخ', false); END IF;

  IF COALESCE(v_new.code, '') = '' THEN
    RAISE EXCEPTION 'كود المجموعة مطلوب' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_new.name_ar, '') = '' THEN
    RAISE EXCEPTION 'اسم المجموعة (عربي) مطلوب' USING ERRCODE = 'P0001';
  END IF;
  v_new.name := COALESCE(NULLIF(btrim(v_new.name), ''), v_new.name_ar);

  SELECT name_ar INTO v_other FROM categories WHERE code = v_new.code AND id IS DISTINCT FROM p_category_id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'كود المجموعة "%" موجود مسبقاً (%)', v_new.code, v_other USING ERRCODE = 'P0001';
  END IF;

  IF p_category_id IS NULL THEN
    INSERT INTO categories (code, name, name_ar, description, sort_order, is_active, is_kitchen)
    VALUES (v_new.code, v_new.name, v_new.name_ar, v_new.description, v_new.sort_order, v_new.is_active, v_new.is_kitchen)
    RETURNING id INTO v_new.id;
  ELSE
    UPDATE categories SET
      code = v_new.code, name = v_new.name, name_ar = v_new.name_ar, description = v_new.description,
      sort_order = v_new.sort_order, is_active = v_new.is_active, is_kitchen = v_new.is_kitchen, updated_at = now()
    WHERE id = p_category_id;
  END IF;

  IF p_add_item_ids IS NOT NULL AND cardinality(p_add_item_ids) > 0 THEN
    UPDATE items SET category_id = v_new.id, updated_at = now()
    WHERE id = ANY (p_add_item_ids) AND category_id IS DISTINCT FROM v_new.id;
  END IF;
  IF p_remove_item_ids IS NOT NULL AND cardinality(p_remove_item_ids) > 0 THEN
    UPDATE items SET category_id = NULL, updated_at = now()
    WHERE id = ANY (p_remove_item_ids) AND category_id = v_new.id
      AND NOT (id = ANY (COALESCE(p_add_item_ids, '{}'::uuid[])));
  END IF;

  RETURN v_new.id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'كود المجموعة "%" موجود مسبقاً', v_new.code USING ERRCODE = 'P0001';
END $$;
REVOKE ALL ON FUNCTION public.item_category_save(uuid, jsonb, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.item_category_save(uuid, jsonb, uuid[], uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.item_category_delete(p_category_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin');
  v_name text;
  v_n integer;
BEGIN
  SELECT name_ar INTO v_name FROM categories WHERE id = p_category_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المجموعة غير موجودة أو تم حذفها' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM items WHERE category_id = p_category_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'لا يمكن حذف المجموعة "%" لأنها تحتوي على % صنف. انقل الأصناف لمجموعة أخرى أو اجعل المجموعة غير نشطة', v_name, v_n
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM categories WHERE parent_id = p_category_id) THEN
    RAISE EXCEPTION 'لا يمكن حذف المجموعة "%" لأن لها مجموعات فرعية', v_name USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    DELETE FROM categories WHERE id = p_category_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'لا يمكن حذف المجموعة "%" لارتباطها ببيانات أخرى. اجعلها غير نشطة بدلاً من الحذف', v_name
      USING ERRCODE = 'P0001';
  END;
END $$;
REVOKE ALL ON FUNCTION public.item_category_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.item_category_delete(uuid) TO authenticated;

-- ---------- Branches ----------

-- Creates (p_branch_id NULL) or updates a branch (keys: code, name, name_ar, address, phone, email, status,
-- is_main_warehouse, opening_time, closing_time; on update only the keys present change).
-- Empty optional fields and times are stored as NULL. Exactly one active branch is the main warehouse:
-- the current main warehouse cannot be unticked or deactivated; it is moved by ticking another branch
-- with the extra key replace_main_warehouse = true (the old one is unticked in the same transaction).
CREATE OR REPLACE FUNCTION public.inv_branch_save(p_branch_id uuid, p_branch jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager');
  v_new branches%ROWTYPE;
  v_was_main boolean := false;
  v_replace boolean := false;
  v_other_id uuid;
  v_other text;
  v_text text;
  v_constraint text;
BEGIN
  IF p_branch IS NULL OR jsonb_typeof(p_branch) <> 'object' THEN
    RAISE EXCEPTION 'بيانات الفرع غير صحيحة' USING ERRCODE = 'P0001';
  END IF;
  v_replace := public.inv_json_bool(p_branch, 'replace_main_warehouse', 'نقل المخزن الرئيسي', false);

  IF p_branch_id IS NOT NULL THEN
    SELECT * INTO v_new FROM branches WHERE id = p_branch_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الفرع غير موجود أو تم حذفه' USING ERRCODE = 'P0001';
    END IF;
    v_was_main := COALESCE(v_new.is_main_warehouse, false);
  ELSE
    v_new.status := 'active';
    v_new.is_main_warehouse := false;
  END IF;

  IF p_branch ? 'code' THEN v_new.code := btrim(p_branch ->> 'code'); END IF;
  IF p_branch ? 'name_ar' THEN v_new.name_ar := btrim(p_branch ->> 'name_ar'); END IF;
  IF p_branch ? 'name' THEN v_new.name := NULLIF(btrim(p_branch ->> 'name'), ''); END IF;
  IF p_branch ? 'address' THEN v_new.address := NULLIF(btrim(p_branch ->> 'address'), ''); END IF;
  IF p_branch ? 'phone' THEN v_new.phone := NULLIF(btrim(p_branch ->> 'phone'), ''); END IF;
  IF p_branch ? 'email' THEN v_new.email := NULLIF(btrim(p_branch ->> 'email'), ''); END IF;
  IF p_branch ? 'status' THEN
    IF NOT COALESCE(NULLIF(p_branch ->> 'status', ''), 'active') = ANY (enum_range(NULL::branch_status)::text[]) THEN
      RAISE EXCEPTION 'حالة الفرع غير صحيحة' USING ERRCODE = 'P0001';
    END IF;
    v_new.status := COALESCE(NULLIF(p_branch ->> 'status', ''), 'active')::branch_status;
  END IF;
  IF p_branch ? 'is_main_warehouse' THEN
    v_new.is_main_warehouse := public.inv_json_bool(p_branch, 'is_main_warehouse', 'المخزن الرئيسي', false);
  END IF;
  IF p_branch ? 'opening_time' THEN
    v_text := NULLIF(btrim(p_branch ->> 'opening_time'), '');
    IF v_text IS NOT NULL AND v_text !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?$' THEN
      RAISE EXCEPTION 'صيغة وقت الفتح غير صحيحة' USING ERRCODE = 'P0001';
    END IF;
    v_new.opening_time := v_text::time;
  END IF;
  IF p_branch ? 'closing_time' THEN
    v_text := NULLIF(btrim(p_branch ->> 'closing_time'), '');
    IF v_text IS NOT NULL AND v_text !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?$' THEN
      RAISE EXCEPTION 'صيغة وقت الإغلاق غير صحيحة' USING ERRCODE = 'P0001';
    END IF;
    v_new.closing_time := v_text::time;
  END IF;

  IF COALESCE(v_new.code, '') = '' THEN
    RAISE EXCEPTION 'كود الفرع مطلوب' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_new.name_ar, '') = '' THEN
    RAISE EXCEPTION 'اسم الفرع (عربي) مطلوب' USING ERRCODE = 'P0001';
  END IF;
  v_new.name := COALESCE(NULLIF(btrim(v_new.name), ''), v_new.name_ar);

  SELECT name_ar INTO v_other FROM branches WHERE code = v_new.code AND id IS DISTINCT FROM p_branch_id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'كود الفرع "%" مستخدم للفرع "%"', v_new.code, v_other USING ERRCODE = 'P0001';
  END IF;

  -- the stock list, new items and the warehouse flows need one active main warehouse
  IF v_was_main AND NOT COALESCE(v_new.is_main_warehouse, false) THEN
    RAISE EXCEPTION 'لا يمكن إلغاء تحديد المخزن الرئيسي. لنقله إلى فرع آخر افتح ذلك الفرع وحدده كمخزن رئيسي'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_new.is_main_warehouse AND v_new.status IS DISTINCT FROM 'active'::branch_status THEN
    RAISE EXCEPTION 'المخزن الرئيسي يجب أن يكون نشطاً. لإيقافه انقل المخزن الرئيسي إلى فرع آخر أولاً'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_new.is_main_warehouse AND NOT v_was_main THEN
    SELECT id, name_ar INTO v_other_id, v_other FROM branches
    WHERE is_main_warehouse AND id IS DISTINCT FROM p_branch_id
    LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF NOT v_replace THEN
        RAISE EXCEPTION 'المخزن الرئيسي هو "%" بالفعل. لا يمكن تحديد أكثر من مخزن رئيسي', v_other
          USING ERRCODE = 'P0001';
      END IF;
      -- moving the main warehouse: untick the old one first (partial unique index branches_one_main_warehouse)
      UPDATE branches SET is_main_warehouse = false, updated_at = now() WHERE id = v_other_id;
    END IF;
  END IF;

  IF p_branch_id IS NULL THEN
    INSERT INTO branches (code, name, name_ar, address, phone, email, status, is_main_warehouse, opening_time, closing_time)
    VALUES (v_new.code, v_new.name, v_new.name_ar, v_new.address, v_new.phone, v_new.email, v_new.status,
            v_new.is_main_warehouse, v_new.opening_time, v_new.closing_time)
    RETURNING id INTO v_new.id;
  ELSE
    UPDATE branches SET
      code = v_new.code, name = v_new.name, name_ar = v_new.name_ar, address = v_new.address, phone = v_new.phone,
      email = v_new.email, status = v_new.status, is_main_warehouse = v_new.is_main_warehouse,
      opening_time = v_new.opening_time, closing_time = v_new.closing_time, updated_at = now()
    WHERE id = p_branch_id;
  END IF;

  RETURN v_new.id;
EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  IF v_constraint = 'branches_one_main_warehouse' THEN
    RAISE EXCEPTION 'لا يمكن تحديد أكثر من مخزن رئيسي' USING ERRCODE = 'P0001';
  END IF;
  RAISE EXCEPTION 'كود الفرع "%" مستخدم لفرع آخر', v_new.code USING ERRCODE = 'P0001';
END $$;
REVOKE ALL ON FUNCTION public.inv_branch_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_branch_save(uuid, jsonb) TO authenticated;

-- Deletes a branch that has no stock and no history. The main warehouse cannot be deleted.
CREATE OR REPLACE FUNCTION public.inv_branch_delete(p_branch_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager');
  v_branch branches%ROWTYPE;
BEGIN
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الفرع غير موجود أو تم حذفه' USING ERRCODE = 'P0001';
  END IF;
  IF v_branch.is_main_warehouse THEN
    RAISE EXCEPTION 'لا يمكن حذف المخزن الرئيسي' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM inventory WHERE branch_id = p_branch_id AND quantity <> 0) THEN
    RAISE EXCEPTION 'لا يمكن حذف الفرع "%" لوجود أرصدة مخزون به. اجعل حالته "غير نشط" بدلاً من الحذف', v_branch.name_ar
      USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    DELETE FROM inventory WHERE branch_id = p_branch_id;
    DELETE FROM branches WHERE id = p_branch_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'لا يمكن حذف الفرع "%" لارتباطه بمستخدمين أو عمليات سابقة. اجعل حالته "غير نشط" بدلاً من الحذف', v_branch.name_ar
      USING ERRCODE = 'P0001';
  END;
END $$;
REVOKE ALL ON FUNCTION public.inv_branch_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_branch_delete(uuid) TO authenticated;

-- ---------- Stock list ----------

-- Saves the stock list's inline edit in one transaction: item fields (via item_save, admin/warehouse_manager),
-- the opening balance, and a new quantity as a logged 'adjustment' (delta computed under the row lock).
-- p_expected_quantity is the quantity the page showed: if the stock moved since (sale, transfer...), nothing is
-- saved and the caller must reload. Pass NULL for what did not change. Returns the quantity after saving.
CREATE OR REPLACE FUNCTION public.inv_save_stock_row(
  p_inventory_id uuid,
  p_item jsonb DEFAULT NULL,
  p_quantity numeric DEFAULT NULL,
  p_expected_quantity numeric DEFAULT NULL,
  p_opening_balance numeric DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  v_inv inventory%ROWTYPE;
  v_new numeric;
  v_cost numeric;
BEGIN
  SELECT * INTO v_inv FROM inventory WHERE id = p_inventory_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'سجل المخزون غير موجود، أعد تحميل الصفحة' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.inv_require_stock_access(v_inv.branch_id);

  IF p_item IS NOT NULL AND p_item <> '{}'::jsonb THEN
    PERFORM public.item_save(v_inv.item_id, p_item);
  END IF;

  IF p_quantity IS NOT NULL THEN
    IF p_quantity < 0 OR p_quantity = 'NaN'::numeric THEN
      RAISE EXCEPTION 'الكمية لا يمكن أن تكون سالبة' USING ERRCODE = 'P0001';
    END IF;
    IF p_expected_quantity IS NULL THEN
      RAISE EXCEPTION 'الكمية الحالية مطلوبة لتعديل الرصيد' USING ERRCODE = 'P0001';
    END IF;
    IF round(p_expected_quantity, 3) <> round(v_inv.quantity, 3) THEN
      RAISE EXCEPTION 'تغيّر رصيد الصنف إلى % منذ تحميل الصفحة. أعد تحميل الصفحة ثم عدّل الكمية', trim_scale(v_inv.quantity)
        USING ERRCODE = 'P0001';
    END IF;
    v_new := round(p_quantity, 3);
    IF v_new <> v_inv.quantity THEN
      SELECT purchase_price INTO v_cost FROM items WHERE id = v_inv.item_id;
      PERFORM public.stock_adjust(v_inv.branch_id, v_inv.item_id, v_new - v_inv.quantity, 'adjustment',
        'stock_list', v_inv.id, 'تعديل الرصيد يدوياً من قائمة المخزون', v_cost, false);
    END IF;
  END IF;

  IF p_opening_balance IS NOT NULL THEN
    IF p_opening_balance < 0 OR p_opening_balance = 'NaN'::numeric THEN
      RAISE EXCEPTION 'رصيد أول المدة لا يمكن أن يكون سالباً' USING ERRCODE = 'P0001';
    END IF;
    UPDATE inventory SET opening_balance = round(p_opening_balance, 3), updated_at = now()
    WHERE id = v_inv.id AND opening_balance IS DISTINCT FROM round(p_opening_balance, 3);
  END IF;

  RETURN (SELECT quantity FROM inventory WHERE id = v_inv.id);
END $$;
REVOKE ALL ON FUNCTION public.inv_save_stock_row(uuid, jsonb, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_save_stock_row(uuid, jsonb, numeric, numeric, numeric) TO authenticated;

-- Removes items from a branch's stock list (the items themselves stay in the system).
-- A remaining quantity is first written off as a logged 'adjustment'. Rows already removed are skipped.
-- Returns how many rows were removed.
CREATE OR REPLACE FUNCTION public.inv_remove_stock_rows(p_inventory_ids uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  v_inv inventory%ROWTYPE;
  v_count integer := 0;
BEGIN
  IF p_inventory_ids IS NULL OR cardinality(p_inventory_ids) = 0 THEN
    RETURN 0;
  END IF;
  -- (item_id, branch_id) lock order, like sales, counts and movements, so concurrent stock changes can't deadlock
  FOR v_inv IN SELECT * FROM inventory WHERE id = ANY (p_inventory_ids) ORDER BY item_id, branch_id FOR UPDATE LOOP
    PERFORM public.inv_require_stock_access(v_inv.branch_id);
    IF v_inv.quantity <> 0 THEN
      PERFORM public.stock_adjust(v_inv.branch_id, v_inv.item_id, -v_inv.quantity, 'adjustment',
        'stock_row_removed', v_inv.id, 'حذف الصنف من مخزون الفرع', NULL, false);
    END IF;
    DELETE FROM inventory WHERE id = v_inv.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'لا يمكن حذف بعض الأصناف من مخزون الفرع لارتباطها بدفعات مخزون' USING ERRCODE = 'P0001';
END $$;
REVOKE ALL ON FUNCTION public.inv_remove_stock_rows(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_remove_stock_rows(uuid[]) TO authenticated;

-- ---------- Stock import (CSV) ----------

-- p_rows: [{row, code, name, category, unit, quantity, opening_balance, purchase_price, selling_price}]
--   (row = line number in the file, for messages; blank cells = "leave unchanged").
-- p_update_items: create missing items (and categories), update prices / category / opening balance (admin, warehouse_manager).
-- p_update_quantities: set each non-blank quantity as the counted stock, applied as a logged 'adjustment' delta
--   (stock access to the branch). Items must exist unless p_update_items is on.
-- p_dry_run = true: nothing is written; returns what would change plus row errors (the preview).
-- p_dry_run = false: applies everything in one transaction; refused if any row has an error.
-- Codes are matched exactly. Repeated codes are refused. Codes that Excel turned into scientific notation
-- (6.22E+12) are refused unless such an item already exists.
CREATE OR REPLACE FUNCTION public.inv_import_stock(
  p_branch_id uuid,
  p_rows jsonb,
  p_update_items boolean DEFAULT true,
  p_update_quantities boolean DEFAULT false,
  p_dry_run boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_batch uuid := gen_random_uuid();
  v_el jsonb;
  v_ord bigint;
  v_line integer;
  v_num numeric;
  v_code text;
  v_name text;
  v_cat_name text;
  v_unit_text text;
  v_qty numeric;
  v_ob numeric;
  v_pp numeric;
  v_sp numeric;
  v_bad text;
  v_item items%ROWTYPE;
  v_found boolean;
  v_unit uuid;
  v_cat uuid;
  v_cat_new boolean;
  v_has_inv boolean;
  v_inv_qty numeric;
  v_inv_ob numeric;
  v_new_cats jsonb := '{}'::jsonb;
  v_units jsonb := '{}'::jsonb;
  v_errors jsonb[] := '{}'; -- appended per row (a jsonb array would be copied on every append)
  v_changes jsonb[] := '{}';
  v_change jsonb;
  v_dup text;
  v_rows integer;
  v_created_items integer := 0;
  v_updated_items integer := 0;
  v_created_cats integer := 0;
  v_qty_changes integer := 0;
  v_ob_changes integer := 0;
  v_unchanged integer := 0;
  v_item_changed boolean;
BEGIN
  p_update_items := COALESCE(p_update_items, false);
  p_update_quantities := COALESCE(p_update_quantities, false);
  p_dry_run := COALESCE(p_dry_run, true);
  IF NOT p_update_items AND NOT p_update_quantities THEN
    RAISE EXCEPTION 'اختر ما تريد تحديثه من الملف' USING ERRCODE = 'P0001';
  END IF;
  IF p_update_items THEN
    v_user := public.app_require_role('admin', 'warehouse_manager');
  END IF;
  -- also checks the branch exists (for both modes)
  IF p_update_quantities THEN
    v_user := public.inv_require_stock_access(p_branch_id);
  ELSIF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'الفرع غير موجود' USING ERRCODE = 'P0001';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'الملف لا يحتوي على بيانات' USING ERRCODE = 'P0001';
  END IF;
  v_rows := jsonb_array_length(p_rows);
  -- keeps one call well inside the 8 s API statement timeout (measured: 4000 rows took 6.5 s, too close)
  IF v_rows > 2500 THEN
    RAISE EXCEPTION 'الملف كبير جداً (الحد الأقصى 2500 سطر). قسّمه إلى أكثر من ملف' USING ERRCODE = 'P0001';
  END IF;

  SELECT string_agg(code, '، ' ORDER BY code) INTO v_dup FROM (
    SELECT btrim(e ->> 'code') AS code FROM jsonb_array_elements(p_rows) e
    WHERE COALESCE(btrim(e ->> 'code'), '') <> ''
    GROUP BY 1 HAVING count(*) > 1 ORDER BY 1 LIMIT 20
  ) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'الملف يحتوي على أكواد مكررة: %. احذف التكرار ثم أعد الاستيراد', v_dup USING ERRCODE = 'P0001';
  END IF;

  FOR v_el, v_ord IN SELECT e, o FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(e, o) LOOP
    v_num := public.inv_to_number(v_el ->> 'row'); -- line number in the file, for messages only
    v_line := CASE WHEN v_num <> 'NaN'::numeric AND v_num BETWEEN 1 AND 1000000 THEN round(v_num)::integer ELSE v_ord::integer END;
    v_code := COALESCE(btrim(v_el ->> 'code'), '');
    v_name := NULLIF(btrim(v_el ->> 'name'), '');
    v_cat_name := NULLIF(btrim(v_el ->> 'category'), '');
    v_unit_text := NULLIF(btrim(v_el ->> 'unit'), '');
    v_qty := public.inv_to_number(v_el ->> 'quantity');
    v_ob := public.inv_to_number(v_el ->> 'opening_balance');
    v_pp := public.inv_to_number(v_el ->> 'purchase_price');
    v_sp := public.inv_to_number(v_el ->> 'selling_price');

    IF v_code = '' THEN
      v_errors := v_errors || jsonb_build_object('row', v_line, 'code', '', 'message', 'كود الصنف فارغ');
      CONTINUE;
    END IF;

    v_bad := NULL;
    IF p_update_quantities AND v_qty IS NOT NULL AND (v_qty = 'NaN'::numeric OR v_qty < 0) THEN
      v_bad := 'الكمية';
    ELSIF p_update_items AND v_ob IS NOT NULL AND (v_ob = 'NaN'::numeric OR v_ob < 0) THEN
      v_bad := 'رصيد أول المدة';
    ELSIF p_update_items AND v_pp IS NOT NULL AND (v_pp = 'NaN'::numeric OR v_pp < 0) THEN
      v_bad := 'سعر الشراء';
    ELSIF p_update_items AND v_sp IS NOT NULL AND (v_sp = 'NaN'::numeric OR v_sp < 0) THEN
      v_bad := 'سعر البيع';
    END IF;
    IF v_bad IS NOT NULL THEN
      v_errors := v_errors || jsonb_build_object('row', v_line, 'code', v_code,
        'message', format('قيمة "%s" غير صحيحة أو سالبة', v_bad));
      CONTINUE;
    END IF;
    IF NOT p_update_quantities THEN v_qty := NULL; END IF;
    IF NOT p_update_items THEN v_ob := NULL; v_pp := NULL; v_sp := NULL; v_cat_name := NULL; END IF;

    IF p_dry_run THEN
      SELECT * INTO v_item FROM items WHERE code = v_code;
    ELSE
      SELECT * INTO v_item FROM items WHERE code = v_code FOR UPDATE;
    END IF;
    v_found := FOUND;
    v_unit := NULL;

    IF NOT v_found THEN
      v_item := NULL;
      IF NOT p_update_items THEN
        v_errors := v_errors || jsonb_build_object('row', v_line, 'code', v_code, 'message', 'الصنف غير موجود في النظام');
        CONTINUE;
      END IF;
      IF v_code ~* '^[0-9]+(\.[0-9]+)?e[+-]?[0-9]+$' THEN
        v_errors := v_errors || jsonb_build_object('row', v_line, 'code', v_code,
          'message', 'الكود بصيغة علمية فقد أرقامه في Excel. اكتب الكود كاملاً في الملف');
        CONTINUE;
      END IF;
      IF v_name IS NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_line, 'code', v_code, 'message', 'اسم الصنف مطلوب للصنف الجديد');
        CONTINUE;
      END IF;
      IF v_unit_text IS NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_line, 'code', v_code, 'message', 'الوحدة مطلوبة للصنف الجديد');
        CONTINUE;
      END IF;
      IF v_units ? v_unit_text THEN -- looked up once per distinct unit text
        v_unit := NULLIF(v_units ->> v_unit_text, '')::uuid;
      ELSE
        SELECT u.id INTO v_unit FROM units u
        WHERE public.inv_fold_arabic(u.name_ar) = public.inv_fold_arabic(v_unit_text)
           OR lower(u.code) = lower(v_unit_text)
           OR lower(u.name) = lower(v_unit_text)
           OR (u.code = 'KG' AND public.inv_fold_arabic(v_unit_text) IN ('كيلو', 'كجم', 'كغ', 'ك'))
           OR (u.code = 'G' AND public.inv_fold_arabic(v_unit_text) IN ('جم', 'غرام', 'جرام'))
           OR (u.code = 'L' AND public.inv_fold_arabic(v_unit_text) IN ('لتر', 'لترات'))
           OR (u.code = 'ML' AND public.inv_fold_arabic(v_unit_text) IN ('مل', 'ملي', 'مللي'))
           OR (u.code = 'PC' AND public.inv_fold_arabic(v_unit_text) IN ('قطعه', 'حبه', 'عدد'))
        ORDER BY (u.name_ar = v_unit_text) DESC, u.is_active DESC NULLS LAST, u.code
        LIMIT 1;
        v_units := v_units || jsonb_build_object(v_unit_text, COALESCE(v_unit::text, ''));
      END IF;
      IF v_unit IS NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_line, 'code', v_code,
          'message', format('الوحدة "%s" غير معروفة', v_unit_text));
        CONTINUE;
      END IF;
    END IF;

    -- category (created once per name)
    v_cat := NULL;
    v_cat_new := false;
    IF v_cat_name IS NOT NULL THEN
      SELECT id INTO v_cat FROM categories WHERE btrim(name_ar) = v_cat_name
      ORDER BY is_active DESC NULLS LAST, created_at LIMIT 1;
      IF v_cat IS NULL THEN
        IF v_new_cats ? v_cat_name THEN
          v_cat := NULLIF(v_new_cats ->> v_cat_name, '')::uuid;
        ELSE
          IF NOT p_dry_run THEN
            INSERT INTO categories (code, name, name_ar, is_active, sort_order)
            VALUES (public.next_document_number('CAT'), v_cat_name, v_cat_name, true, 0)
            RETURNING id INTO v_cat;
          END IF;
          v_new_cats := v_new_cats || jsonb_build_object(v_cat_name, COALESCE(v_cat::text, ''));
          v_created_cats := v_created_cats + 1;
        END IF;
        v_cat_new := true;
      END IF;
    END IF;

    v_change := jsonb_build_object('row', v_line, 'code', v_code, 'name', COALESCE(v_item.name_ar, v_name));
    v_item_changed := false;

    IF NOT v_found THEN
      IF NOT p_dry_run THEN
        INSERT INTO items (code, name, name_ar, unit_id, category_id, purchase_price, selling_price,
                           min_stock_level, status, created_by)
        VALUES (v_code, v_name, v_name, v_unit, v_cat, round(COALESCE(v_pp, 0), 2), round(COALESCE(v_sp, 0), 2),
                0, 'active', v_user)
        RETURNING * INTO v_item;
      END IF;
      v_created_items := v_created_items + 1;
      v_change := v_change || jsonb_build_object('action', 'new',
        'purchase_price_after', round(COALESCE(v_pp, 0), 2), 'selling_price_after', round(COALESCE(v_sp, 0), 2));
      IF v_cat_name IS NOT NULL THEN v_change := v_change || jsonb_build_object('category_after', v_cat_name); END IF;
      v_item_changed := true;
    ELSIF p_update_items THEN
      -- both sides at 2 dp: stored prices like 8.333333333 are exported in full, so an unchanged re-import must not count as a change
      IF v_pp IS NOT NULL AND round(v_pp, 2) IS DISTINCT FROM round(v_item.purchase_price, 2) THEN
        v_change := v_change || jsonb_build_object('purchase_price_before', v_item.purchase_price, 'purchase_price_after', round(v_pp, 2));
        v_item_changed := true;
      END IF;
      IF v_sp IS NOT NULL AND round(v_sp, 2) IS DISTINCT FROM round(v_item.selling_price, 2) THEN
        v_change := v_change || jsonb_build_object('selling_price_before', v_item.selling_price, 'selling_price_after', round(v_sp, 2));
        v_item_changed := true;
      END IF;
      -- compared by name: with two categories of the same name the item keeps the one it is in
      IF v_cat_name IS NOT NULL AND (v_cat_new OR (v_cat IS DISTINCT FROM v_item.category_id AND NOT EXISTS (
           SELECT 1 FROM categories c WHERE c.id = v_item.category_id AND btrim(c.name_ar) = v_cat_name))) THEN
        v_change := v_change || jsonb_build_object('category_before',
          (SELECT c.name_ar FROM categories c WHERE c.id = v_item.category_id), 'category_after', v_cat_name);
        v_item_changed := true;
      ELSE
        v_cat := NULL; -- category unchanged: the UPDATE below keeps category_id
      END IF;
      IF v_item_changed THEN
        IF NOT p_dry_run THEN
          UPDATE items SET
            purchase_price = COALESCE(round(v_pp, 2), purchase_price),
            selling_price = COALESCE(round(v_sp, 2), selling_price),
            category_id = COALESCE(v_cat, category_id),
            updated_at = now()
          WHERE id = v_item.id;
        END IF;
        v_updated_items := v_updated_items + 1;
        v_change := v_change || jsonb_build_object('action', 'update');
      END IF;
    END IF;

    -- stock row of the item in the target branch
    v_has_inv := false;
    v_inv_qty := 0;
    v_inv_ob := NULL;
    IF v_found THEN
      IF p_dry_run THEN
        SELECT quantity, opening_balance INTO v_inv_qty, v_inv_ob FROM inventory
        WHERE branch_id = p_branch_id AND item_id = v_item.id;
      ELSE
        SELECT quantity, opening_balance INTO v_inv_qty, v_inv_ob FROM inventory
        WHERE branch_id = p_branch_id AND item_id = v_item.id FOR UPDATE;
      END IF;
      v_has_inv := FOUND;
      IF NOT v_has_inv THEN v_inv_qty := 0; v_inv_ob := NULL; END IF;
    END IF;

    -- a new item gets an (empty) stock row in the target branch; an existing item only when a quantity or
    -- opening balance actually changes below (the preview's "unchanged" rows create nothing)
    IF NOT p_dry_run AND NOT v_found THEN
      INSERT INTO inventory (branch_id, item_id, quantity, opening_balance, min_quantity)
      VALUES (p_branch_id, v_item.id, 0, 0, 0)
      ON CONFLICT (branch_id, item_id) DO NOTHING;
    END IF;

    IF v_qty IS NOT NULL AND round(v_qty, 3) <> round(v_inv_qty, 3) THEN
      IF NOT p_dry_run THEN
        PERFORM public.stock_adjust(p_branch_id, v_item.id, round(v_qty, 3) - v_inv_qty, 'adjustment',
          'stock_import', v_batch, 'استيراد المخزون من ملف', v_item.purchase_price, true);
      END IF;
      v_qty_changes := v_qty_changes + 1;
      v_change := v_change || jsonb_build_object('quantity_before', v_inv_qty, 'quantity_after', round(v_qty, 3));
      IF NOT v_change ? 'action' THEN v_change := v_change || jsonb_build_object('action', 'update'); END IF;
      v_item_changed := true;
    END IF;

    IF v_ob IS NOT NULL AND round(v_ob, 3) IS DISTINCT FROM COALESCE(v_inv_ob, CASE WHEN v_has_inv THEN NULL ELSE 0 END) THEN
      IF NOT p_dry_run THEN
        -- the stock row may not exist yet (stock_adjust above creates it only for a quantity change)
        INSERT INTO inventory (branch_id, item_id, quantity, opening_balance, min_quantity)
        VALUES (p_branch_id, v_item.id, 0, 0, 0)
        ON CONFLICT (branch_id, item_id) DO NOTHING;
        UPDATE inventory SET opening_balance = round(v_ob, 3), updated_at = now()
        WHERE branch_id = p_branch_id AND item_id = v_item.id;
      END IF;
      v_ob_changes := v_ob_changes + 1;
      v_change := v_change || jsonb_build_object('opening_balance_before', v_inv_ob, 'opening_balance_after', round(v_ob, 3));
      IF NOT v_change ? 'action' THEN v_change := v_change || jsonb_build_object('action', 'update'); END IF;
      v_item_changed := true;
    END IF;

    IF v_item_changed THEN
      IF cardinality(v_changes) < 2000 THEN
        v_changes := v_changes || v_change;
      END IF;
    ELSE
      v_unchanged := v_unchanged + 1;
    END IF;
  END LOOP;

  IF NOT p_dry_run AND cardinality(v_errors) > 0 THEN
    RAISE EXCEPTION 'لم يتم الاستيراد: يوجد % سطر به أخطاء. راجع المعاينة وصحّح الملف أو تجاهل هذه الأسطر', cardinality(v_errors)
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'rows', v_rows,
    'created_items', v_created_items,
    'updated_items', v_updated_items,
    'created_categories', v_created_cats,
    'quantity_changes', v_qty_changes,
    'opening_balance_changes', v_ob_changes,
    'unchanged', v_unchanged,
    'errors', to_jsonb(v_errors),
    'changes', to_jsonb(v_changes)
  );
END $$;
REVOKE ALL ON FUNCTION public.inv_import_stock(uuid, jsonb, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_import_stock(uuid, jsonb, boolean, boolean, boolean) TO authenticated;

-- ---------- Daily counts ----------

-- Saves a count as a draft. p_items: [{item_id, system_quantity, actual_quantity, variance_reason}]
-- (system_quantity = what the system showed when counting; missing -> the current stock).
CREATE OR REPLACE FUNCTION public.daily_count_create(
  p_branch_id uuid,
  p_count_date date,
  p_count_type text,
  p_notes text,
  p_items jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.inv_require_stock_access(p_branch_id);
  v_id uuid;
  v_el jsonb;
  v_item uuid;
  v_sys numeric;
  v_act numeric;
  v_existing text;
  v_dup text;
BEGIN
  IF p_count_type IS NULL OR p_count_type NOT IN ('opening', 'closing') THEN
    RAISE EXCEPTION 'نوع الجرد غير صحيح' USING ERRCODE = 'P0001';
  END IF;
  IF p_count_date IS NULL THEN
    RAISE EXCEPTION 'تاريخ الجرد مطلوب' USING ERRCODE = 'P0001';
  END IF;
  IF p_count_date > (now() AT TIME ZONE 'Africa/Cairo')::date THEN
    RAISE EXCEPTION 'لا يمكن تسجيل جرد بتاريخ مستقبلي' USING ERRCODE = 'P0001';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'لا توجد أصناف في الجرد' USING ERRCODE = 'P0001';
  END IF;

  -- one open count per branch, day and type (a double click or a second tab must not create two)
  PERFORM pg_advisory_xact_lock(hashtext('daily_count:' || p_branch_id::text || ':' || p_count_date::text || ':' || p_count_type));
  SELECT public.inv_count_status_ar(status) INTO v_existing FROM daily_inventory_counts
  WHERE branch_id = p_branch_id AND count_date = p_count_date AND count_type = p_count_type
    AND COALESCE(status, 'draft') <> 'rejected'
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'يوجد جرد % لهذا الفرع بنفس التاريخ (الحالة: %)',
      CASE p_count_type WHEN 'opening' THEN 'افتتاحي' ELSE 'ختامي' END, v_existing USING ERRCODE = 'P0001';
  END IF;

  SELECT string_agg(i.name_ar, '، ') INTO v_dup FROM (
    SELECT e ->> 'item_id' AS item_id FROM jsonb_array_elements(p_items) e GROUP BY 1 HAVING count(*) > 1
  ) d JOIN items i ON i.id::text = d.item_id;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'أصناف مكررة في الجرد: %', v_dup USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO daily_inventory_counts (branch_id, count_date, count_type, status, notes, counted_by)
  VALUES (p_branch_id, p_count_date, p_count_type, 'draft', NULLIF(btrim(p_notes), ''), v_user)
  RETURNING id INTO v_id;

  FOR v_el IN SELECT e FROM jsonb_array_elements(p_items) e LOOP
    v_item := public.inv_json_uuid(v_el, 'item_id', 'الصنف');
    IF v_item IS NULL OR NOT EXISTS (SELECT 1 FROM items WHERE id = v_item) THEN
      RAISE EXCEPTION 'يوجد صنف غير موجود في الجرد، أعد تحميل الصفحة' USING ERRCODE = 'P0001';
    END IF;
    -- only items stocked in this branch (lines loaded for another branch must never be saved for this one)
    IF NOT EXISTS (SELECT 1 FROM inventory WHERE branch_id = p_branch_id AND item_id = v_item) THEN
      RAISE EXCEPTION 'الصنف "%" غير موجود في مخزون هذا الفرع. أعد تحميل الصفحة',
        (SELECT name_ar FROM items WHERE id = v_item) USING ERRCODE = 'P0001';
    END IF;
    v_act := public.inv_json_number(v_el, 'actual_quantity', 'الكمية الفعلية');
    IF v_act IS NULL THEN
      RAISE EXCEPTION 'أدخل الكمية الفعلية لكل الأصناف' USING ERRCODE = 'P0001';
    END IF;
    v_sys := public.inv_json_number(v_el, 'system_quantity', 'الكمية بالنظام');
    IF v_sys IS NULL THEN
      SELECT quantity INTO v_sys FROM inventory WHERE branch_id = p_branch_id AND item_id = v_item;
      v_sys := COALESCE(v_sys, 0);
    END IF;
    INSERT INTO daily_inventory_count_items (count_id, item_id, system_quantity, actual_quantity, variance_reason)
    VALUES (v_id, v_item, round(v_sys, 3), round(v_act, 3), NULLIF(btrim(v_el ->> 'variance_reason'), ''));
  END LOOP;

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.daily_count_create(uuid, date, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_count_create(uuid, date, text, text, jsonb) TO authenticated;

-- draft -> completed (sent for approval)
CREATE OR REPLACE FUNCTION public.daily_count_submit(p_count_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  v_count daily_inventory_counts%ROWTYPE;
BEGIN
  SELECT * INTO v_count FROM daily_inventory_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND OR v_count.count_type NOT IN ('opening', 'closing') THEN
    RAISE EXCEPTION 'الجرد غير موجود' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.inv_require_stock_access(v_count.branch_id);
  IF COALESCE(v_count.status, 'draft') <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن إرسال الجرد لأن حالته "%"', public.inv_count_status_ar(v_count.status) USING ERRCODE = 'P0001';
  END IF;
  UPDATE daily_inventory_counts SET status = 'completed', submitted_at = now(), updated_at = now() WHERE id = p_count_id;
END $$;
REVOKE ALL ON FUNCTION public.daily_count_submit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_count_submit(uuid) TO authenticated;

-- completed -> approved: corrects stock by each item's variance (actual - system quantity at count time),
-- as logged 'adjustment' movements. Returns the number of items adjusted.
CREATE OR REPLACE FUNCTION public.daily_count_approve(p_count_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  v_count daily_inventory_counts%ROWTYPE;
  v_line record;
  v_n integer := 0;
  v_note text;
BEGIN
  SELECT * INTO v_count FROM daily_inventory_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND OR v_count.count_type NOT IN ('opening', 'closing') THEN
    RAISE EXCEPTION 'الجرد غير موجود' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.inv_require_stock_access(v_count.branch_id);
  IF COALESCE(v_count.status, 'draft') <> 'completed' THEN
    RAISE EXCEPTION 'لا يمكن اعتماد الجرد لأن حالته "%"', public.inv_count_status_ar(v_count.status) USING ERRCODE = 'P0001';
  END IF;

  v_note := format('تسوية جرد %s بتاريخ %s',
    CASE v_count.count_type WHEN 'opening' THEN 'افتتاحي' ELSE 'ختامي' END, v_count.count_date);
  FOR v_line IN
    SELECT ci.item_id, ci.system_quantity, ci.actual_quantity, i.purchase_price
    FROM daily_inventory_count_items ci JOIN items i ON i.id = ci.item_id
    WHERE ci.count_id = p_count_id AND ci.actual_quantity <> ci.system_quantity
    ORDER BY ci.item_id
  LOOP
    PERFORM public.stock_adjust(v_count.branch_id, v_line.item_id, v_line.actual_quantity - v_line.system_quantity,
      'adjustment', 'daily_count', p_count_id, v_note, v_line.purchase_price, true);
    v_n := v_n + 1;
  END LOOP;

  UPDATE inventory SET last_count_date = now()
  WHERE branch_id = v_count.branch_id
    AND item_id IN (SELECT item_id FROM daily_inventory_count_items WHERE count_id = p_count_id);

  UPDATE daily_inventory_counts
  SET status = 'approved', approved_by = v_user, approved_at = now(), updated_at = now()
  WHERE id = p_count_id;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.daily_count_approve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_count_approve(uuid) TO authenticated;

-- draft / completed -> rejected (stock is not changed; a new count can then be recorded for the same day)
CREATE OR REPLACE FUNCTION public.daily_count_reject(p_count_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.app_require_role('admin', 'warehouse_manager', 'branch_supervisor');
  v_count daily_inventory_counts%ROWTYPE;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  SELECT * INTO v_count FROM daily_inventory_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND OR v_count.count_type NOT IN ('opening', 'closing') THEN
    RAISE EXCEPTION 'الجرد غير موجود' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.inv_require_stock_access(v_count.branch_id);
  IF COALESCE(v_count.status, 'draft') NOT IN ('draft', 'completed') THEN
    RAISE EXCEPTION 'لا يمكن رفض الجرد لأن حالته "%"', public.inv_count_status_ar(v_count.status) USING ERRCODE = 'P0001';
  END IF;
  UPDATE daily_inventory_counts
  SET status = 'rejected',
      notes = CASE WHEN v_reason IS NULL THEN notes
                   ELSE concat_ws(' | ', NULLIF(notes, ''), 'سبب الرفض: ' || v_reason) END,
      updated_at = now()
  WHERE id = p_count_id;
END $$;
REVOKE ALL ON FUNCTION public.daily_count_reject(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_count_reject(uuid, text) TO authenticated;

-- ---------- Chef consumption ----------

-- Records what the kitchen consumed and deducts exactly that from the branch stock ('consumption' movements).
-- p_items: [{item_id, quantity, content, notes}]; rows of the same item are merged (quantities added).
-- Refused (nothing saved) when an item has no stock row in the branch or not enough stock.
-- Stored as daily_inventory_counts (count_type 'morning', status 'approved'): actual_quantity = consumed
-- quantity, system_quantity = the "content" value the form shows, variance_reason = notes.
CREATE OR REPLACE FUNCTION public.chef_consumption_record(
  p_branch_id uuid,
  p_date date,
  p_notes text,
  p_items jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- chef consumption page: admin and warehouse_manager (roleAccess chefConsumption); branch access checked too
  v_role_check uuid := public.app_require_role('admin', 'warehouse_manager');
  v_user uuid := public.inv_require_stock_access(p_branch_id);
  v_id uuid;
  v_line record;
  v_after numeric;
BEGIN
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'التاريخ مطلوب' USING ERRCODE = 'P0001';
  END IF;
  IF p_date > (now() AT TIME ZONE 'Africa/Cairo')::date THEN
    RAISE EXCEPTION 'لا يمكن تسجيل استهلاك بتاريخ مستقبلي' USING ERRCODE = 'P0001';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يرجى إضافة صنف واحد على الأقل' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO daily_inventory_counts (branch_id, count_date, count_type, status, notes, counted_by,
                                      submitted_at, approved_by, approved_at)
  VALUES (p_branch_id, p_date, 'morning', 'approved', COALESCE(NULLIF(btrim(p_notes), ''), 'استهلاك الطباخ'), v_user,
          now(), v_user, now())
  RETURNING id INTO v_id;

  FOR v_line IN
    WITH src AS (
      SELECT public.inv_json_uuid(e, 'item_id', 'الصنف') AS item_id,
             public.inv_json_number(e, 'quantity', 'الكمية') AS qty,
             public.inv_json_number(e, 'content', 'المحتوى') AS content,
             NULLIF(btrim(e ->> 'notes'), '') AS notes,
             o
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(e, o)
    )
    SELECT s.item_id, i.id AS found_id, i.name_ar, i.purchase_price,
           round(sum(COALESCE(s.qty, 0)), 3) AS qty,
           bool_or(s.qty IS NULL OR s.qty <= 0) AS has_empty,
           max(s.content) AS content,
           string_agg(DISTINCT s.notes, ' / ') AS notes
    FROM src s LEFT JOIN items i ON i.id = s.item_id
    GROUP BY s.item_id, i.id, i.name_ar, i.purchase_price
    ORDER BY s.item_id -- same stock lock order as every other stock function (deadlock avoidance)
  LOOP
    IF v_line.found_id IS NULL THEN
      RAISE EXCEPTION 'يوجد صنف غير موجود في القائمة، أعد تحميل الصفحة' USING ERRCODE = 'P0001';
    END IF;
    IF v_line.has_empty THEN
      RAISE EXCEPTION 'أدخل كمية أكبر من صفر للصنف "%"', v_line.name_ar USING ERRCODE = 'P0001';
    END IF;
    v_after := public.stock_adjust(p_branch_id, v_line.item_id, -v_line.qty, 'consumption',
      'chef_consumption', v_id, COALESCE(v_line.notes, 'استهلاك الطباخ'), v_line.purchase_price, false);
    IF v_after IS NULL THEN
      RAISE EXCEPTION 'الصنف "%" غير موجود في مخزون هذا الفرع', v_line.name_ar USING ERRCODE = 'P0001', HINT = 'INSUFFICIENT_STOCK';
    END IF;
    INSERT INTO daily_inventory_count_items (count_id, item_id, system_quantity, actual_quantity, variance_reason)
    VALUES (v_id, v_line.item_id, COALESCE(v_line.content, 1), v_line.qty, v_line.notes);
  END LOOP;

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.chef_consumption_record(uuid, date, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chef_consumption_record(uuid, date, text, jsonb) TO authenticated;
