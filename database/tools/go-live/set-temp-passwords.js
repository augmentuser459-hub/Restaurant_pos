// Go-live step 4: gives every ACTIVE staff member (public.users) that has no login account yet their own
// temporary password. Self-contained: uses this folder's `pg` dependency (npm install) and TARGET_DB_URL,
// like the other go-live tools.
//
//   TARGET_DB_URL="postgresql://..." node set-temp-passwords.js --dry-run   only list who would get a password
//   TARGET_DB_URL="postgresql://..." node set-temp-passwords.js             create the missing accounts
//
// Needs database/migrations/010_auth.sql applied first (it provides public.auth_upsert_account()).
// For each user it generates a random 10-character password (letters and digits, no look-alike characters),
// creates the Supabase Auth account with the user's existing id, and APPENDS
//   full name | email | role | password
// to PASSWORDS_FILE (default: POS-handover\staff-temporary-passwords.txt next to the repository folder, e.g.
// D:\POS-handover\). The file must be outside the repository. Passwords are never printed to the console.
// Re-runnable: users that already have a login account are skipped, so at go-live only new users get one.
// Inactive users get no login on purpose. The admin can change any password later from the Users screen.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Client } = require('pg')

const TARGET = process.env.TARGET_DB_URL
const DRY_RUN = process.argv.includes('--dry-run')
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const OUT_FILE = path.resolve(process.env.PASSWORDS_FILE ||
  path.join(path.dirname(REPO_ROOT), 'POS-handover', 'staff-temporary-passwords.txt'))

if (!TARGET) {
  console.error('Set TARGET_DB_URL to the NEW database connection string (Supabase > Connect > Session pooler).')
  process.exit(2)
}
if (TARGET.includes('hqjwhhqcymgkwohlofvf')) {
  console.error('TARGET_DB_URL points at the OLD production project. Refusing.')
  process.exit(2)
}
const rel = path.relative(REPO_ROOT, OUT_FILE)
if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
  console.error(`PASSWORDS_FILE (${OUT_FILE}) is inside the repository. Choose a folder outside it. Refusing.`)
  process.exit(2)
}

// No 0/O/o, 1/l/I/i: passwords are read off paper and typed on tablets
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghjkmnpqrstuvwxyz'
const DIGITS = '23456789'
const ALL = UPPER + LOWER + DIGITS

function randomPassword(length = 10) {
  // At least one upper-case letter, one lower-case letter and one digit, in random positions
  const chars = [
    UPPER[crypto.randomInt(UPPER.length)],
    LOWER[crypto.randomInt(LOWER.length)],
    DIGITS[crypto.randomInt(DIGITS.length)],
  ]
  while (chars.length < length) chars.push(ALL[crypto.randomInt(ALL.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function appendLine(text) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  // UTF-8 BOM on a new file so Arabic names show correctly in every Windows editor
  if (!fs.existsSync(OUT_FILE)) fs.writeFileSync(OUT_FILE, '\uFEFF', 'utf8')
  fs.appendFileSync(OUT_FILE, text + '\r\n', 'utf8')
}

;(async () => {
  const db = new Client({ connectionString: TARGET, ssl: { rejectUnauthorized: false } })
  await db.connect()
  try {
    const fn = await db.query(`select to_regprocedure('public.auth_upsert_account(uuid, text)') is not null as ok`)
    if (!fn.rows[0].ok) throw new Error('public.auth_upsert_account(uuid, text) is missing: apply database/migrations/010_auth.sql first')

    const { rows } = await db.query(`
      select u.id, u.email, u.full_name, u.full_name_ar, r.name as role, r.name_ar as role_ar
      from public.users u
      join public.roles r on r.id = u.role_id
      where u.status = 'active'
        and not exists (select 1 from auth.users a where a.id = u.id)
      order by r.name, u.full_name`)

    if (rows.length === 0) {
      console.log('Every active user already has a login account. Nothing to do.')
      return
    }

    if (DRY_RUN) {
      console.log(`${rows.length} active user(s) without a login account (dry run, nothing changed):`)
      for (const u of rows) console.log(`  ${u.email}  (${u.role})`)
      console.log(`Passwords would be appended to ${OUT_FILE}`)
      return
    }

    const stamp = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })
    appendLine('')
    appendLine(`=== Temporary passwords created ${stamp} (Cairo time) ===`)
    appendLine('Full name | Email (login) | Role | Temporary password')

    let created = 0
    const failed = []
    for (const u of rows) {
      const password = randomPassword()
      const name = u.full_name_ar && u.full_name_ar !== u.full_name ? `${u.full_name_ar} (${u.full_name})` : u.full_name
      await db.query('BEGIN')
      try {
        await db.query('select public.auth_upsert_account($1, $2)', [u.id, password])
        // Written before COMMIT: if the file can't be written, the account is not created either
        appendLine(`${name} | ${String(u.email).trim().toLowerCase()} | ${u.role_ar || u.role} (${u.role}) | ${password}`)
        await db.query('COMMIT')
        created++
        console.log(`  account created: ${u.email} (${u.role})`)
      } catch (e) {
        await db.query('ROLLBACK').catch(() => {})
        failed.push(u.email)
        console.error(`  FAILED: ${u.email} (${u.role}): ${e.message}`)
      }
    }
    if (failed.length) appendLine(`(no account was created for: ${failed.join(', ')})`)

    console.log(`\n${created} account(s) created, ${failed.length} failed.`)
    console.log(`Passwords were appended to ${OUT_FILE}`)
    if (failed.length) process.exitCode = 1
  } finally {
    await db.end()
  }
})().catch(e => {
  console.error(e.message)
  process.exit(1)
})
