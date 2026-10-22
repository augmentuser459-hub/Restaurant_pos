-- ============================================
-- Reset Data Script  --  DEV / TEST DATABASES ONLY
-- ============================================
-- !!! NEVER run this on the production database. It permanently deletes business data. !!!
-- Take a backup first, even on a test database.
--
-- DELETES (every row, every branch):
--   - Sales: orders, order lines, cashier shifts, notifications; pos_backfill_issues rows go with their
--     orders (ON DELETE CASCADE)
--   - Items, categories, stock (inventory, batches, stock movements), daily counts
--   - POS / menu setup: branch POS items and prices, menu items and categories, recipes, production logs
--   - Cashier/chef category permissions (each user's POS and kitchen category assignments; they point at
--     the deleted categories)
--   - Transfers, damages, branch returns, supplier returns
--   - Purchasing: purchase requests and orders with their payments, supplies (invoices), supplier payments,
--     supplier items, supplier debt history; every supplier balance is set to 0
-- KEEPS: suppliers, branches, users (their accounts and roles, but not their category permissions), roles,
--   units, damage/return reasons, settings, audit logs, document number counters.
--
-- GUARD: the script refuses to run unless the current session carries an explicit confirmation that
-- includes today's date (database server date). Put this line directly above the script, in the same run:
--     SET app.confirm_reset = 'DELETE ALL BUSINESS DATA YYYY-MM-DD';   -- today's date
-- The confirmation is cleared again when the reset finishes.
--
-- Everything runs as ONE statement (one DO block): it either deletes everything or nothing. If a table that is
-- not listed below references one of these tables without ON DELETE CASCADE, the foreign key stops the reset
-- and nothing is deleted.
-- ============================================

DO $$
DECLARE
  v_expected text := 'DELETE ALL BUSINESS DATA ' || to_char(current_date, 'YYYY-MM-DD');
  v_table text;
  v_rows bigint;
  -- Children before parents (foreign-key order)
  v_tables text[] := ARRAY[
    'order_items',
    'orders',
    'cashier_shifts',
    'notification_reads',
    'notifications',
    'branch_pos_items',
    'branch_menu_prices',
    'menu_item_ingredients',
    'menu_items',
    'menu_categories',
    'purchase_order_payments',
    'purchase_order_items',
    'purchase_orders',
    'purchase_request_items',
    'purchase_requests',
    'supplier_payments',
    'supplier_returns',
    'supplier_items',
    'supplier_debt_transactions',
    'branch_return_items',
    'branch_returns',
    'damages',
    'transfer_items',
    'transfers',
    'daily_inventory_count_items',
    'daily_inventory_counts',
    'recipe_ingredients',
    'production_logs',
    'inventory_transactions',
    'inventory_batches',
    'supply_items',
    'supplies',
    'inventory',
    'cashier_category_permissions',
    'chef_category_permissions',
    'items',
    'categories'
  ];
BEGIN
  IF coalesce(current_setting('app.confirm_reset', true), '') <> v_expected THEN
    RAISE EXCEPTION 'Reset.sql is DEV-ONLY and deletes all business data. Nothing was deleted.'
      USING HINT = format('If this is really a test database and you have a backup, run first: SET app.confirm_reset = %L;', v_expected);
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I', v_table);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RAISE NOTICE 'deleted % rows from %', v_rows, v_table;
    END IF;
  END LOOP;

  -- Debt history is gone, so balances start again from zero
  UPDATE public.suppliers SET current_balance = 0, updated_at = CURRENT_TIMESTAMP WHERE current_balance IS DISTINCT FROM 0;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'reset the balance of % suppliers', v_rows;

  -- Clear the confirmation so a later run in the same session has to confirm again
  PERFORM set_config('app.confirm_reset', '', false);
END $$;

-- ============================================
-- Summary
-- ============================================
SELECT
    'Data Reset Complete!' as status,
    (SELECT COUNT(*) FROM items) as remaining_items,
    (SELECT COUNT(*) FROM inventory) as remaining_inventory,
    (SELECT COUNT(*) FROM categories) as remaining_categories,
    (SELECT COUNT(*) FROM purchase_orders) as remaining_purchase_orders,
    (SELECT COUNT(*) FROM orders) as remaining_orders,
    (SELECT COUNT(*) FROM suppliers) as remaining_suppliers,
    (SELECT SUM(current_balance) FROM suppliers) as total_supplier_balance;
