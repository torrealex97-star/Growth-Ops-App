// Aplica un fichero .sql de scripts/ directamente contra POSTGRES_URL (.env.local).
// Uso: node scripts/apply-sql.mjs migration-v53-youtube-uploads.sql
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const file = process.argv[2]
if (!file) { console.error('Uso: node scripts/apply-sql.mjs <fichero.sql>'); process.exit(1) }
if (!env.POSTGRES_URL) { console.error('Falta POSTGRES_URL en .env.local'); process.exit(1) }

const sqlText = readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8')
const sql = postgres(env.POSTGRES_URL, { ssl: 'require', max: 1, prepare: false, idle_timeout: 20 })
try {
  await sql.unsafe(sqlText)
  console.log(`OK: ${file} aplicado.`)
} catch (err) {
  console.error(`Error aplicando ${file}:`, err.message)
  process.exit(1)
} finally {
  await sql.end()
}
