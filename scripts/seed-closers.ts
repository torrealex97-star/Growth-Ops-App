/**
 * Run: npx tsx scripts/seed-closers.ts
 * Seeds the 4 launch closers with a default password.
 * Change the password before deploying.
 */
import postgres from 'postgres'
import bcrypt from 'bcryptjs'

const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require' })

const DEFAULT_PASSWORD = 'closer2026!'

const CLOSERS = [
  { email: 'almu_larranaga@businesswomango.com', nombre: 'Almudena Larrañaga' },
  { email: 'anagonzalez@businesswomango.com',    nombre: 'Ana González' },
  { email: 'ruthmontoyainfo@gmail.com',          nombre: 'Ruth Montoya' },
  { email: 'paula_lopez@businesswomango.com',    nombre: 'Paula López' },
]

async function main() {
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10)
  for (const c of CLOSERS) {
    await sql`
      INSERT INTO launch_closers (email, nombre, password_hash, activa)
      VALUES (${c.email}, ${c.nombre}, ${hash}, true)
      ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, activa = true
    `
    console.log(`✓ ${c.nombre} (${c.email})`)
  }
  console.log(`\nPassword por defecto: ${DEFAULT_PASSWORD}`)
  await sql.end()
}

main().catch(console.error)
