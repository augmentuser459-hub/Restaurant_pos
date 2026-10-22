# Database and App Setup

For moving the live system to the new database, see `PRODUCTION_SCHEMA_READY.md`.
To check a database, see `SCHEMA_VERIFICATION.md`.

## 1. How a database is built

`schema.sql` alone does **not** produce the database the app needs. Run these files in this order, each one
completely (Supabase SQL Editor or `psql`):

1. `schema.sql`
2. The original add-on files, in this order:
   `add_cashier_category_permissions.sql`, `add_chef_category_permissions.sql`, `fix_cashier_permissions_rls.sql`,
   `pos_views_functions.sql`, `fix_pos_in_stock.sql`, `add_inventory_deduction_trigger.sql`,
   `fix_supplier_returns.sql`, `user_functions.sql`
3. Every file in `migrations/`, in file-name order (`001_…`, `005_…`, `010_…` … `090_…`).
   They are idempotent, so running them again is safe. `tools/go-live/run-migrations.js` applies them all
   (see `migrations/README.md`). `090_security_rls.sql` is written in the integration step: until it is in the
   folder and applied, the database has no row-level security on the original tables.

Do **not** run:
- `add_default_user.sql`: an old test seed. Its fixed-id roles clash with the roles `schema.sql` already creates,
  so it fails, and it sets the password `1234`.
- `Reset.sql`: DEV-ONLY, deletes all business data (it refuses to run without an explicit confirmation).

Optional: `add_recipe_category.sql` adds the `CAT-RECIPE` category for recipe items.

## 2. Facts the app relies on

- **Logins use Supabase Auth.** Every row in `users` must have `users.id` = the Supabase Auth user id
  (`auth.users.id`). The role is `users.role_id` → `roles.name` (`admin`, `warehouse_manager`, `branch_supervisor`,
  `chef`, `cashier`, `purchase_manager`).
- **Row-level security comes from `migrations/090_security_rls.sql`.** The tables from `schema.sql` start with RLS
  disabled (like the old production database); 090 enables it on every table with role-based policies.
  Tables created by migrations enable RLS themselves. Until 090 exists (integration step), only those have it.
- **There is no `payments` table.** Supplier payments are in `supplier_payments`, purchase-order payments in
  `purchase_order_payments`.
- Stock changes only through `stock_adjust()` and supplier balances only through `supplier_balance_adjust()`
  (`migrations/005_core_functions.sql`).

## 3. First admin user (new, empty database only)

Run this after all files of §1. Don't use the dashboard's *Authentication → Add user*: `010_auth.sql` blocks
sign-ups, because every login must belong to a `users` row with the same id.

1. In the SQL Editor (replace the email and the password, at least 6 characters):
   ```sql
   INSERT INTO users (employee_code, username, email, full_name, full_name_ar, role_id, status)
   SELECT 'EMP001', 'admin', 'admin@example.com', 'System Administrator', 'مدير النظام', r.id, 'active'
   FROM roles r WHERE r.name = 'admin';

   -- Creates the Supabase Auth login with the same id (returns true)
   SELECT public.auth_upsert_account(u.id, 'choose-a-strong-password')
   FROM users u WHERE u.email = 'admin@example.com';
   ```
   `users.password_hash` only holds a placeholder: the password lives in Supabase Auth.
2. Create the main warehouse:
   ```sql
   INSERT INTO branches (code, name, name_ar, is_main_warehouse, status)
   VALUES ('MAIN', 'Main Warehouse', 'المخزن الرئيسي', true, 'active');
   ```
3. Log in as this admin and add the other staff from the Users page (المستخدمين); that creates their logins.

## 4. App configuration (local)

Create `restaurant-react/.env.local` (git-ignored) from `restaurant-react/.env.example`:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<the project's publishable (anon) key>
```

Vite also loads `restaurant-react/.env` and uses it for any value `.env.local` doesn't set (or for everything
when `.env.local` is missing). So `restaurant-react/.env` must not exist, or must name the current project: an
old copy that still names the old production project (`hqjw…`) makes the app talk to that project as soon as
`.env.local` is removed. Both files are git-ignored and never reach Cloudflare Pages.

```bash
cd restaurant-react
npm ci
npm run dev          # http://localhost:5173
npm run typecheck    # type-check only (tsc), must report 0 errors
npm run build:check  # type-check + production build: must pass before every deploy
```

## 5. Deploy (Cloudflare Pages)

- `wrangler.toml` at the repository root names the Pages project (`restaurant-pos`) and the output folder
  (`restaurant-react/dist`).
- Build command (from the repository root): `cd restaurant-react && npm ci && npm run build:check`.
  It fails while `npm run typecheck` reports any error. If a deploy can't wait for those to be fixed, set the
  command to `cd restaurant-react && npm ci && npm run build` (production build without the type-check) and
  switch back once `npm run typecheck` is clean.
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Pages project's environment variables. They are
  baked in at build time, so redeploy after changing them.
- Page routing needs no `_redirects` file: the build has no top-level `404.html`, so Pages serves `index.html` for
  every unknown path (its single-page-app mode). Do not add a `404.html` to `public/`, and do not add a
  `/* /index.html 200` rule (Pages ignores it as an infinite loop).
