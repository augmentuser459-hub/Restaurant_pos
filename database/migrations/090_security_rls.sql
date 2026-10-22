-- ============================================
-- 090: Row-level security for every public table. Idempotent. Applied LAST (after 001-050) on every go-live.
--
-- Model:
--   * anon (no login) gets nothing: no table, view or sequence, and new objects stop granting it anything.
--   * Every public table has RLS on. This file owns the policies: any policy it does not create is dropped,
--     except 025's notifications_select_visible and notification_reads_select_own, which are kept as they are.
--   * authenticated may only SELECT, and only what the screens read (see the access list below). The only direct
--     write left to the browser is notifications INSERT (damages.service / transfers.service); everything else is
--     written by SECURITY DEFINER functions. Those are owned by postgres (table owner, BYPASSRLS), so RLS never
--     blocks them. RLS is not FORCEd for the same reason.
--   * Internal SECURITY DEFINER helpers the browser never calls (next_document_number, ...) are not executable
--     through the API; the business functions that use them run as postgres and keep working.
--   * Cross-branch roles (admin, warehouse_manager, purchase_manager) see every branch. A branch supervisor sees
--     its own branch's stock movements; cashier and chef see only their own branch's sales (orders, POS items,
--     stock). Per-user parts are written as (SELECT fn()) so they are evaluated once per query, not once per row.
--
-- Access list (table -> who may read which rows):
--   reference: roles, branches, categories, units, items, menu_items, damage_reasons, branch_return_reasons
--              -> any active user
--   users -> own row (any status, so the "account inactive" message still shows); every row for admin,
--            warehouse_manager, branch_supervisor, purchase_manager (names in counts, requests, shift reports)
--   cashier/chef_category_permissions -> admin; own rows
--   orders, order_items (through the order), branch_pos_items -> cross-branch roles; own branch
--   inventory -> cross-branch roles and branch_supervisor (transfer source picker); own branch
--   cashier_shifts -> cross-branch roles; the cashier's own shifts
--   daily_inventory_counts (+ items), damages, supplier_returns -> cross-branch roles; branch_supervisor: own branch
--   transfers, branch_returns (+ items) -> cross-branch roles; branch_supervisor: either side is its branch
--   production_logs, recipe_ingredients -> cross-branch roles (recipe screens, calculate_recipe_cost inside
--            v_branch_pos_items_with_stock)
--   suppliers -> admin, purchase_manager, warehouse_manager, branch_supervisor (supplier return form)
--   supplies, supplier_payments, supplier_debt_transactions -> admin, purchase_manager
--   purchase_requests/_items, purchase_orders/_items, purchase_order_payments -> admin, purchase_manager,
--            warehouse_manager
--   notifications -> 025's notifications_select_visible (the bell rule, also what Realtime delivers), plus the
--            rows the user created (needed for INSERT ... RETURNING); INSERT for admin, warehouse_manager,
--            branch_supervisor
--   notification_reads -> 025's own-rows policy
--   views v_notifications_inbox, v_branch_pos_items_with_stock (security_invoker) -> SELECT, rows by the above
--   no access (read only by SECURITY DEFINER functions): alert_settings, audit_logs, branch_menu_prices,
--            branch_settings, document_counters, inventory_batches, inventory_transactions, menu_categories,
--            menu_item_ingredients, pos_backfill_issues, pos_order_counters, supplier_items, supply_items,
--            system_settings, user_sessions, and any table not listed here
--
-- Deploying:
--   * The whole file is ONE DO statement, so it is applied completely or not at all, however it is run (SQL
--     editor, psql with or without --single-transaction). Users never see a half-applied state.
--   * It takes a short ACCESS EXCLUSIVE lock on every public table. Run it in a quiet window. If lock_timeout is
--     off, it uses 10s: if a long query holds a table, 090 fails with 55P03 and changes nothing; run it again.
--   * After it is committed, smoke-test Realtime once: a new cashier order appears on that branch's kitchen screen
--     without waiting for the 10 s poll, and a transfer notification reaches the receiving branch's bell.
-- ============================================

DO $mig$
DECLARE
  r record;
  v_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF v_lock_timeout IN ('0', '0ms') THEN
    PERFORM set_config('lock_timeout', '10s', true);
  END IF;

  -- ---------- 1. anon: nothing ----------

  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;          -- tables and views
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;  -- explicit grants only; API functions already refuse anon

  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

  -- Objects created by supabase_admin (platform upgrades) get the same treatment when this role may change them.
  BEGIN
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
  EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE '090: default privileges of supabase_admin left unchanged (%)', SQLERRM;
  END;

  -- ---------- 2. Internal helpers: not callable through the API ----------
  -- next_document_number writes document_counters with no role check (anyone could burn document numbers);
  -- the other two return any user's category mapping. The browser calls none of them; the SECURITY DEFINER
  -- functions that use them run as their owner (postgres) and are unaffected.
  FOR r IN
    SELECT f.sig FROM unnest(ARRAY['public.next_document_number(text)',
                                   'public.cashier_has_category_access(uuid, uuid)',
                                   'public.get_chef_categories(uuid)']) AS f(sig)
    WHERE to_regprocedure(f.sig) IS NOT NULL
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;

  -- ---------- 3. notifications.created_by ----------
  -- The app inserts with RETURNING (.insert().select()), so the new row must pass a SELECT policy. A warehouse
  -- manager or branch supervisor notifies OTHER branches, which the bell rule (correctly) hides from them; this
  -- column lets the creator read back only what they created, without widening the bell or Realtime.
  ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS created_by uuid;
  ALTER TABLE public.notifications ALTER COLUMN created_by SET DEFAULT auth.uid();

  -- ---------- 4. RLS on every table ----------

  FOR r IN
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    IF NOT r.relrowsecurity THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    END IF;
    IF r.relforcerowsecurity THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', r.relname);
    END IF;
  END LOOP;

  -- ---------- 5. Policies: drop everything this file does not own (025's two read rules stay) ----------

  FOR r IN
    SELECT p.tablename, p.policyname
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND (p.tablename, p.policyname) NOT IN (('notifications', 'notifications_select_visible'),
                                              ('notification_reads', 'notification_reads_select_own'))
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;

  -- ---------- 6. Privileges: authenticated reads, writes only notifications ----------

  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;

  GRANT SELECT ON
    public.roles, public.branches, public.categories, public.units, public.items, public.menu_items,
    public.damage_reasons, public.branch_return_reasons,
    public.users, public.cashier_category_permissions, public.chef_category_permissions,
    public.orders, public.order_items, public.cashier_shifts, public.branch_pos_items,
    public.inventory, public.daily_inventory_counts, public.daily_inventory_count_items,
    public.damages, public.production_logs, public.recipe_ingredients,
    public.transfers, public.transfer_items, public.branch_returns, public.branch_return_items,
    public.suppliers, public.supplier_returns, public.supplies, public.supplier_payments,
    public.supplier_debt_transactions,
    public.purchase_requests, public.purchase_request_items, public.purchase_orders,
    public.purchase_order_items, public.purchase_order_payments,
    public.notifications, public.notification_reads,
    public.v_notifications_inbox, public.v_branch_pos_items_with_stock
  TO authenticated;

  -- Exactly the columns notificationsService.create sends (id, created_at, read_at, created_by keep their defaults).
  GRANT INSERT (user_id, branch_id, type, title, message, priority, reference_type, reference_id, expires_at, is_read)
    ON public.notifications TO authenticated;

  -- ---------- 7. Read policies ----------

  -- Reference data: any active user.
  CREATE POLICY roles_select ON public.roles FOR SELECT TO authenticated
    USING ((SELECT public.app_user_id()) IS NOT NULL);
  CREATE POLICY branches_select ON public.branches FOR SELECT TO authenticated
    USING ((SELECT public.app_user_id()) IS NOT NULL);
  CREATE POLICY categories_select ON public.categories FOR SELECT TO authenticated
    USING ((SELECT public.app_user_id()) IS NOT NULL);
  CREATE POLICY units_select ON public.units FOR SELECT TO authenticated
    USING ((SELECT public.app_user_id()) IS NOT NULL);
  CREATE POLICY items_select ON public.items FOR SELECT TO authenticated
    USING ((SELECT public.app_user_id()) IS NOT NULL);
  CREATE POLICY menu_items_select ON public.menu_items FOR SELECT TO authenticated
    USING ((SELECT public.app_user_id()) IS NOT NULL);
  CREATE POLICY damage_reasons_select ON public.damage_reasons FOR SELECT TO authenticated
    USING ((SELECT public.app_user_id()) IS NOT NULL);
  CREATE POLICY branch_return_reasons_select ON public.branch_return_reasons FOR SELECT TO authenticated
    USING ((SELECT public.app_user_id()) IS NOT NULL);

  -- Users: own row always (login reads it before checking the status); managers read names of other staff.
  CREATE POLICY users_select ON public.users FOR SELECT TO authenticated
    USING (
      id = (SELECT auth.uid())
      OR (SELECT public.app_has_role('admin', 'warehouse_manager', 'branch_supervisor', 'purchase_manager'))
    );

  CREATE POLICY cashier_category_permissions_select ON public.cashier_category_permissions FOR SELECT TO authenticated
    USING ((SELECT public.app_has_role('admin')) OR user_id = (SELECT public.app_user_id()));
  CREATE POLICY chef_category_permissions_select ON public.chef_category_permissions FOR SELECT TO authenticated
    USING ((SELECT public.app_has_role('admin')) OR user_id = (SELECT public.app_user_id()));

  -- Sales of a branch: cross-branch roles see all, everyone else (POS, kitchen, Realtime) their own branch.
  CREATE POLICY orders_select ON public.orders FOR SELECT TO authenticated
    USING (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager'))
      OR branch_id = (SELECT public.app_user_branch())
    );
  CREATE POLICY order_items_select ON public.order_items FOR SELECT TO authenticated
    USING (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager'))
      OR EXISTS (SELECT 1 FROM public.orders o
                 WHERE o.id = order_items.order_id AND o.branch_id = (SELECT public.app_user_branch()))
    );
  CREATE POLICY branch_pos_items_select ON public.branch_pos_items FOR SELECT TO authenticated
    USING (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager'))
      OR branch_id = (SELECT public.app_user_branch())
    );

  -- Stock: own branch; a branch supervisor picks any source branch for a transfer and sees its stock.
  CREATE POLICY inventory_select ON public.inventory FOR SELECT TO authenticated
    USING (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager', 'branch_supervisor'))
      OR branch_id = (SELECT public.app_user_branch())
    );

  -- Shifts: managers (shift list, cashier report) and the cashier's own shifts.
  CREATE POLICY cashier_shifts_select ON public.cashier_shifts FOR SELECT TO authenticated
    USING (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager'))
      OR cashier_id = (SELECT public.app_user_id())
    );

  -- Stock movements of a branch: cross-branch roles see all, a branch supervisor its own branch.
  CREATE POLICY daily_inventory_counts_select ON public.daily_inventory_counts FOR SELECT TO authenticated
    USING (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager'))
      OR ((SELECT public.app_has_role('branch_supervisor')) AND branch_id = (SELECT public.app_user_branch()))
    );
  CREATE POLICY daily_inventory_count_items_select ON public.daily_inventory_count_items FOR SELECT TO authenticated
    USING (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager'))
      OR ((SELECT public.app_has_role('branch_supervisor'))
          AND EXISTS (SELECT 1 FROM public.daily_inventory_counts c
                      WHERE c.id = daily_inventory_count_items.count_id
                        AND c.branch_id = (SELECT public.app_user_branch())))
    );
  CREATE POLICY damages_select ON public.damages FOR SELECT TO authenticated
    USING (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager'))
      OR ((SELECT public.app_has_role('branch_supervisor')) AND branch_id = (SELECT public.app_user_branch()))
    );
  CREATE POLICY supplier_returns_select ON public.supplier_returns FOR SELECT TO authenticated
    USING (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager'))
      OR ((SELECT public.app_has_role('branch_supervisor')) AND branch_id = (SELECT public.app_user_branch()))
    );

  -- Movements between branches: a branch supervisor sees both sides.
  CREATE POLICY transfers_select ON public.transfers FOR SELECT TO authenticated
    USING (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager'))
      OR ((SELECT public.app_has_role('branch_supervisor'))
          AND (from_branch_id = (SELECT public.app_user_branch())
               OR to_branch_id = (SELECT public.app_user_branch())))
    );
  CREATE POLICY transfer_items_select ON public.transfer_items FOR SELECT TO authenticated
    USING (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager'))
      OR ((SELECT public.app_has_role('branch_supervisor'))
          AND EXISTS (SELECT 1 FROM public.transfers t
                      WHERE t.id = transfer_items.transfer_id
                        AND (t.from_branch_id = (SELECT public.app_user_branch())
                             OR t.to_branch_id = (SELECT public.app_user_branch()))))
    );
  CREATE POLICY branch_returns_select ON public.branch_returns FOR SELECT TO authenticated
    USING (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager'))
      OR ((SELECT public.app_has_role('branch_supervisor'))
          AND (from_branch_id = (SELECT public.app_user_branch())
               OR to_branch_id = (SELECT public.app_user_branch())))
    );
  CREATE POLICY branch_return_items_select ON public.branch_return_items FOR SELECT TO authenticated
    USING (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager'))
      OR ((SELECT public.app_has_role('branch_supervisor'))
          AND EXISTS (SELECT 1 FROM public.branch_returns br
                      WHERE br.id = branch_return_items.return_id
                        AND (br.from_branch_id = (SELECT public.app_user_branch())
                             OR br.to_branch_id = (SELECT public.app_user_branch()))))
    );

  -- Recipes (recipe screens; calculate_recipe_cost runs as the caller inside v_branch_pos_items_with_stock).
  CREATE POLICY production_logs_select ON public.production_logs FOR SELECT TO authenticated
    USING ((SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager')));
  CREATE POLICY recipe_ingredients_select ON public.recipe_ingredients FOR SELECT TO authenticated
    USING ((SELECT public.app_has_role('admin', 'warehouse_manager', 'purchase_manager')));

  -- Suppliers and purchasing: the roles that open those screens.
  CREATE POLICY suppliers_select ON public.suppliers FOR SELECT TO authenticated
    USING ((SELECT public.app_has_role('admin', 'purchase_manager', 'warehouse_manager', 'branch_supervisor')));
  CREATE POLICY supplies_select ON public.supplies FOR SELECT TO authenticated
    USING ((SELECT public.app_has_role('admin', 'purchase_manager')));
  CREATE POLICY supplier_payments_select ON public.supplier_payments FOR SELECT TO authenticated
    USING ((SELECT public.app_has_role('admin', 'purchase_manager')));
  CREATE POLICY supplier_debt_transactions_select ON public.supplier_debt_transactions FOR SELECT TO authenticated
    USING ((SELECT public.app_has_role('admin', 'purchase_manager')));
  CREATE POLICY purchase_requests_select ON public.purchase_requests FOR SELECT TO authenticated
    USING ((SELECT public.app_has_role('admin', 'purchase_manager', 'warehouse_manager')));
  CREATE POLICY purchase_request_items_select ON public.purchase_request_items FOR SELECT TO authenticated
    USING ((SELECT public.app_has_role('admin', 'purchase_manager', 'warehouse_manager')));
  CREATE POLICY purchase_orders_select ON public.purchase_orders FOR SELECT TO authenticated
    USING ((SELECT public.app_has_role('admin', 'purchase_manager', 'warehouse_manager')));
  CREATE POLICY purchase_order_items_select ON public.purchase_order_items FOR SELECT TO authenticated
    USING ((SELECT public.app_has_role('admin', 'purchase_manager', 'warehouse_manager')));
  CREATE POLICY purchase_order_payments_select ON public.purchase_order_payments FOR SELECT TO authenticated
    USING ((SELECT public.app_has_role('admin', 'purchase_manager', 'warehouse_manager')));

  -- ---------- 8. Notifications (025's notifications_select_visible stays the bell / Realtime rule) ----------

  -- Lets INSERT ... RETURNING succeed when a manager notifies another branch. The bell (v_notifications_inbox)
  -- and the Realtime channels filter on the user's own branch / id, so they are unchanged.
  CREATE POLICY notifications_select_created ON public.notifications FOR SELECT TO authenticated
    USING (created_by = (SELECT auth.uid()));

  -- Damage and transfer notifications for a branch, sent by the roles that record damages and transfers.
  CREATE POLICY notifications_insert_staff ON public.notifications FOR INSERT TO authenticated
    WITH CHECK (
      (SELECT public.app_has_role('admin', 'warehouse_manager', 'branch_supervisor'))
      AND created_by = (SELECT auth.uid())
      AND user_id IS NULL
      AND branch_id IS NOT NULL
      AND type IN ('transfer', 'damage')
      AND is_read IS NOT TRUE
      AND read_at IS NULL
    );

  PERFORM set_config('lock_timeout', v_lock_timeout, true);
END $mig$;
