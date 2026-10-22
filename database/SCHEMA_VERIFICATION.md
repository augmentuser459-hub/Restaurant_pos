# Schema Verification

How to check that a database matches what the app needs. The facts below were checked against the staging
database's `information_schema` on 2026-10-21.

## Checks (run in the SQL Editor)

```sql
-- 1. Tables (about 52) and views (v_branch_pos_items_with_stock, v_notifications_inbox)
SELECT table_name, table_type FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;

-- 2. Row-level security: after migrations/090_security_rls.sql every row must say true
--    (before 090 only the tables created by migrations say true)
SELECT relname AS table_name, relrowsecurity AS rls_enabled
FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY relrowsecurity, relname;

-- 3. Objects added by migrations/001_live_only_objects.sql (expect 1, 1 and 3)
SELECT count(*) FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'categories' AND column_name = 'is_kitchen';
SELECT count(*) FROM pg_constraint WHERE conname = 'branch_pos_items_branch_id_item_id_key';
SELECT count(*) FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename IN ('orders', 'order_items', 'notifications');

-- 4. Shared helpers from migrations/005_core_functions.sql (expect 4 names)
SELECT DISTINCT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('app_require_role', 'stock_adjust', 'supplier_balance_adjust', 'next_document_number');

-- 5. Every ACTIVE staff member has a Supabase Auth account with the same id
--    (expect 0 after go-live step 4, set-temp-passwords.js; inactive users have no login on purpose)
SELECT count(*) FROM users u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.id);
```

## Facts

- **No `payments` table.** Supplier payments: `supplier_payments`. Purchase-order payments: `purchase_order_payments`.
- **RLS:** the tables from `schema.sql` start with RLS disabled (as in the old production database).
  `migrations/090_security_rls.sql` enables it with role-based policies on every table. Check 2 shows the result.
  090 is written in the integration step; until it is applied, only the tables created by migrations have RLS
  (on 2026-10-21: `document_counters`, `pos_order_counters`, `pos_backfill_issues`, `notification_reads`).
- **Logins:** Supabase Auth; `users.id` = `auth.users.id` (check 5). The role is `users.role_id` → `roles.name`.
  Logins are created by the Users screen (`create_user`), by `tools/go-live/set-temp-passwords.js`, or for the
  first admin by hand (`SETUP_GUIDE.md` §3); never by a migration.
- **Columns that do NOT exist** (selecting or writing them fails with error 42703):

  | Table | Not a column | Use instead |
  |---|---|---|
  | items | `unit` | `unit_id`, or embed `unit:units(id, name_ar, code)` |
  | items | `reorder_point`, `is_menu_item` | `reorder_level`; POS items are in `branch_pos_items` |
  | inventory | `max_quantity` | (none; items have `max_stock_level`) |
  | supplies | `supply_date`, `created_by` | `invoice_date` or `received_at`; `received_by` |
  | transfers | `transfer_date`, `total_items` | `requested_at` / `created_at`; count `transfer_items` |
  | menu_items | `preparation_time` | `preparation_time_minutes` |
  | supplier_returns | `received_at` | `received_by_supplier_at` |

- `daily_inventory_counts.count_type` is free text: the app writes `opening`, `closing` and `morning`
  (chef consumption).
- `chef_category_permissions` and `get_chef_categories` still exist but are retired: the kitchen screen filters
  by `categories.is_kitchen`.
- The app's TypeScript types (`restaurant-react/src/types/database.types.ts`) are hand-written to match these
  columns: every field there that is not an embedded relation is a real column.
