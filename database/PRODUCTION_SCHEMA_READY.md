# Production Database: Go-Live Procedure

The new Supabase project (today's staging) becomes the production database. Its structure comes from the files
listed in `SETUP_GUIDE.md` §1; its data is copied from the old production project right before go-live, and then
every migration runs again. Nothing is ever written to the old production project.

## Before go-live day

- `database/migrations/090_security_rls.sql` (row-level security for every table) must be in the folder. It is
  written in the integration step; until it is applied, RLS is enabled only on the few tables that migrations
  created (`SCHEMA_VERIFICATION.md` check 2 shows which). Do not go live without it.
- `database/tools/go-live/set-temp-passwords.js` must be in the folder (step 4).
- `cd restaurant-react && npx tsc --noEmit -p tsconfig.json` must report 0 errors, otherwise the Pages build
  command `npm run build:check` fails (see `SETUP_GUIDE.md` §5).

## Steps

1. **Freeze the old system.** Ask staff to stop using the old app (no sales, transfers or supplies) until step 6.
   Anything entered there after the copy is not carried over.
2. **Copy the data** into the new project (old project read only, through its REST API):
   ```bash
   cd database/tools/go-live
   npm install
   TARGET_DB_URL="postgresql://..." npm run copy-data:dry-run   # loads everything, then rolls back
   TARGET_DB_URL="postgresql://..." npm run copy-data
   ```
   `TARGET_DB_URL` is the NEW project's connection string (Supabase → Connect → Session pooler). The tool refuses
   the old project's URL.
3. **Run every migration, in order:**
   ```bash
   TARGET_DB_URL="postgresql://..." npm run migrate
   ```
   It applies `database/migrations/*.sql` in file-name order and stops at the first failure. The migrations are
   idempotent and re-apply their data fixes to the freshly copied rows (for example, 010 updates the email and
   status of the existing Supabase Auth logins, whose id is `users.id`, and 090 enables row-level security).
   (PowerShell: `$env:TARGET_DB_URL = "postgresql://..."` once, then `npm run ...`.)
4. **Logins for active staff that have none yet** (010 never creates a login without a password; inactive users
   get none on purpose). Still in `database/tools/go-live`:
   ```bash
   TARGET_DB_URL="postgresql://..." node set-temp-passwords.js --dry-run   # lists who would get one
   TARGET_DB_URL="postgresql://..." node set-temp-passwords.js
   ```
   It gives each of them a temporary password and appends the list to `POS-handover\staff-temporary-passwords.txt`
   next to the repository folder (e.g. `D:\POS-handover\`; set `PASSWORDS_FILE` to choose another file outside the
   repository). The script is `database/tools/go-live/set-temp-passwords.js`.
   - The 10 staff members who already exist received their temporary passwords in an earlier block of
     `D:\POS-handover\staff-temporary-passwords.txt`; they already have logins, so the script lists nothing for
     them (when nobody is missing it prints "Nothing to do"). Only staff added since then get a new block.
   - Keep the file until every password has been handed out, then delete it.
   - Lost password: the admin opens the Users screen, edits that user and types a new password.
   - Lost admin password: in the Supabase SQL editor run
     `SELECT public.auth_upsert_account(id, '<new password>') FROM users WHERE email = '<admin email>';`
5. **Verify** with the checks in `SCHEMA_VERIFICATION.md` (every table has RLS, every active staff member has an
   Auth account), then log in once with each role.
6. **Point the app at the new project:** in Cloudflare Pages set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   to the new project and redeploy (the values are baked in at build time). Then reopen the system to staff.
   On developer machines, delete `restaurant-react/.env` if it still names the old project (see `SETUP_GUIDE.md` §4).

## Never

- Run `Reset.sql` on this database (DEV-ONLY; it deletes all sales, stock and supplier history).
- Run `add_default_user.sql` (test seed with the password `1234`).
- Change stock or supplier balances with hand-written SQL: use the app, or `stock_adjust()` /
  `supplier_balance_adjust()` inside a migration.
