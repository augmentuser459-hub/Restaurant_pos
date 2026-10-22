// Applies database/migrations/*.sql in file-name order, each in its own transaction; stops at the first failure.
// All migrations are idempotent, so this is safe to run again (it also re-applies their data fixes).
//
//   TARGET_DB_URL="postgresql://..." node run-migrations.js
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const TARGET = process.env.TARGET_DB_URL
const DIR = path.resolve(__dirname, '..', '..', 'migrations')

if (!TARGET) {
  console.error('Set TARGET_DB_URL to the NEW database connection string.')
  process.exit(2)
}
if (TARGET.includes('hqjwhhqcymgkwohlofvf')) {
  console.error('TARGET_DB_URL points at the OLD production project. Refusing.')
  process.exit(2)
}

;(async () => {
  const db = new Client({ connectionString: TARGET, ssl: { rejectUnauthorized: false } })
  db.on('notice', n => console.log(`    [${n.severity}] ${n.message}`))
  await db.connect()
  const files = fs.readdirSync(DIR).filter(f => /^\d+_.*\.sql$/.test(f)).sort()
  for (const file of files) {
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8')
    process.stdout.write(`${file} ... `)
    await db.query('BEGIN')
    try {
      await db.query(sql)
      await db.query('COMMIT')
      console.log('ok')
    } catch (e) {
      await db.query('ROLLBACK').catch(() => {})
      const line = e.position ? ` (line ${sql.slice(0, Number(e.position)).split('\n').length})` : ''
      console.log('FAILED')
      console.error(`${e.message}${line}${e.detail ? `\nDETAIL: ${e.detail}` : ''}`)
      await db.end()
      process.exit(1)
    }
  }
  await db.end()
  console.log(`All ${files.length} migrations applied.`)
})()
