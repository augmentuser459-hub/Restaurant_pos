# Database migrations

`../schema.sql` plus the `../add_*.sql` / `../fix_*.sql` / `../pos_views_functions.sql` / `../user_functions.sql` files describe the
database as it was originally built. Every change since then lives here, as numbered files applied **in order**.

| File | Area |
|---|---|
| `001_live_only_objects.sql` | Objects the original production DB had that no other SQL file defines |
| `005_core_functions.sql` | Shared helpers: `app_*` (current user/role/branch), `stock_adjust`, `supplier_balance_adjust`, `next_document_number` |
| `010_auth.sql` | Supabase Auth accounts for staff, user-management functions |
| `020_pos.sql` | POS checkout, orders, shifts, sale stock deduction (and the one-time back-fill of missed deductions) |
| `025_kitchen_pos_management.sql` | Kitchen screen status changes, POS management (branch menu and prices), notification read state |
| `030_stock.sql` | Items, stock list, categories, branches, daily counts, chef consumption |
| `040_movements.sql` | Transfers, branch/supplier returns, damages, recipes and production |
| `050_purchasing.sql` | Suppliers, supplies, purchase requests/orders, payments, reports |
| `090_security_rls.sql` | Row-level security for every table. Applied last. |

## Rules

- **Idempotent.** Every file can run again safely (`CREATE OR REPLACE`, `IF NOT EXISTS`, guarded `DO` blocks).
  When the data is re-copied from the old production database at go-live, all files run again in order.
- **Data fixes are re-runnable too**: write them so a second run changes nothing.
- Stock quantities change **only** through `stock_adjust()`; supplier balances **only** through `supplier_balance_adjust()`.
- Multi-step business actions (checkout, approve/receive a transfer, produce a recipe…) are single `SECURITY DEFINER`
  functions with `SET search_path = public` that check permissions with `app_require_role()` / `app_can_access_branch()`,
  so they either fully happen or not at all.
- Business errors are raised with an Arabic message (`RAISE EXCEPTION '...' USING ERRCODE = 'P0001'`); the app shows it via `toUserMessage()`.
- Every new table states its row-level security explicitly (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).
