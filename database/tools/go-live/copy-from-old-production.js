// Go-live step 1: replace all data in the NEW database with a fresh copy of the OLD production project.
// The old project is read only through its public REST API with GET requests; nothing is ever written there.
//
//   TARGET_DB_URL="postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres" node copy-from-old-production.js
//   add --dry-run to download and load everything inside a transaction that is rolled back.
//
// Every public table in the target is emptied and reloaded in one transaction (triggers and FK checks off while
// loading, so historical rows don't fire stock triggers). Tables that only exist in the new database are emptied too.
// Afterwards run run-migrations.js: the migrations re-apply their data fixes (auth placeholders, stock back-fill...).
const { Client } = require('pg')

const OLD_URL = process.env.OLD_SUPABASE_URL || 'https://hqjwhhqcymgkwohlofvf.supabase.co'
const OLD_KEY = process.env.OLD_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxandoaHFjeW1na3dvaGxvZnZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MzU0NjIsImV4cCI6MjA5MTMxMTQ2Mn0.nXBqG9P7_6I5eqxtMxaaSKr2NM5PTdkhC6jZH0GJu08'
const TARGET = process.env.TARGET_DB_URL
const DRY_RUN = process.argv.includes('--dry-run')
const PAGE = 1000
const INSERT_CHUNK = 1000

if (!TARGET) {
  console.error('Set TARGET_DB_URL to the NEW database connection string (Supabase > Connect > Session pooler).')
  process.exit(2)
}
if (TARGET.includes('hqjwhhqcymgkwohlofvf')) {
  console.error('TARGET_DB_URL points at the OLD production project. Refusing.')
  process.exit(2)
}

async function getPage(table, order, offset) {
  const url = `${OLD_URL}/rest/v1/${table}?select=*&order=${order}&limit=${PAGE}&offset=${offset}`
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { apikey: OLD_KEY, Authorization: `Bearer ${OLD_KEY}` } })
    if (res.ok) return res.json()
    const body = await res.text()
    if (res.status === 404 && body.includes('PGRST205')) return null // table doesn't exist in the old project
    if (attempt >= 3 || res.status < 500) throw new Error(`${table}: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
}

async function download(table, columns) {
  // created_at first keeps paging stable while the old system may still be receiving rows
  const order = columns.includes('created_at') ? 'created_at.asc,id.asc' : columns.includes('id') ? 'id.asc' : columns[0] + '.asc'
  const byKey = new Map()
  for (let offset = 0; ; offset += PAGE) {
    const page = await getPage(table, order, offset)
    if (page === null) return null
    for (const row of page) byKey.set(row.id ?? JSON.stringify(row), row)
    if (page.length < PAGE) return [...byKey.values()]
  }
}

;(async () => {
  const db = new Client({ connectionString: TARGET, ssl: { rejectUnauthorized: false } })
  await db.connect()
  const colRows = (await db.query(`
    select c.table_name, c.column_name from information_schema.columns c
    join information_schema.tables t using (table_schema, table_name)
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.is_generated = 'NEVER'
    order by c.table_name, c.ordinal_position`)).rows
  const tables = {}
  for (const r of colRows) (tables[r.table_name] ||= []).push(r.column_name)

  console.log(`Downloading ${Object.keys(tables).length} tables from the old project (read-only)...`)
  const data = {}
  for (const [table, columns] of Object.entries(tables)) {
    const rows = await download(table, columns)
    data[table] = rows
    console.log(`  ${table.padEnd(34)} ${rows === null ? 'new table (not in old project)' : rows.length}`)
  }

  await db.query('BEGIN')
  try {
    await db.query('SET LOCAL session_replication_role = replica')
    await db.query(`TRUNCATE ${Object.keys(tables).map(t => `public."${t}"`).join(', ')} CASCADE`)
    for (const [table, rows] of Object.entries(data)) {
      if (!rows || !rows.length) continue
      const targetCols = new Set(tables[table])
      const cols = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(c => targetCols.has(c))
      const list = cols.map(c => `"${c}"`).join(', ')
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await db.query(
          `INSERT INTO public."${table}" (${list}) SELECT ${list} FROM jsonb_populate_recordset(null::public."${table}", $1::jsonb)`,
          [JSON.stringify(rows.slice(i, i + INSERT_CHUNK))])
      }
    }

    let problems = 0
    for (const [table, rows] of Object.entries(data)) {
      const got = Number((await db.query(`select count(*) from public."${table}"`)).rows[0].count)
      const want = rows ? rows.length : 0
      if (got !== want) { problems++; console.error(`COUNT MISMATCH ${table}: downloaded ${want}, loaded ${got}`) }
    }
    const fks = (await db.query(`
      select conrelid::regclass::text tbl, a.attname col, confrelid::regclass::text ref, af.attname refcol
      from pg_constraint k
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[1]
      where k.contype = 'f' and k.connamespace = 'public'::regnamespace and array_length(k.conkey, 1) = 1`)).rows
    for (const f of fks) {
      const n = Number((await db.query(`select count(*) from ${f.tbl} x where x."${f.col}" is not null
        and not exists (select 1 from ${f.ref} y where y."${f.refcol}" = x."${f.col}")`)).rows[0].count)
      if (n) { problems++; console.error(`BROKEN REFERENCES ${f.tbl}.${f.col} -> ${f.ref}: ${n}`) }
    }
    if (problems) throw new Error(`${problems} integrity problem(s); nothing was changed`)

    await db.query(DRY_RUN ? 'ROLLBACK' : 'COMMIT')
    console.log(DRY_RUN ? 'DRY RUN OK: everything loaded and verified, then rolled back.' : 'DONE: data replaced and verified. Now run run-migrations.js.')
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    console.error('FAILED, nothing was changed:', e.message)
    process.exitCode = 1
  } finally {
    await db.end()
  }
})()
