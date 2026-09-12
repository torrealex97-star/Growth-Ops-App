// Regenera el tracking_code de TODOS los usuarios que ya tengan uno, sustituyéndolo por un código
// opaco y privado (no derivado del nombre). Los enlaces antiguos con el utm_term viejo dejarán de
// atribuir; cada rep debe recopiar su enlace desde la sección Enlaces.
//
// Uso:  node scripts/regenerate-tracking-codes.mjs           (aplica los cambios)
//       node scripts/regenerate-tracking-codes.mjs --dry     (solo muestra el mapeo, sin escribir)
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Carga simple de .env.local
const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local')
  process.exit(1)
}

const DRY = process.argv.includes('--dry')
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const gen = (n = 8) => {
  const b = new Uint8Array(n)
  globalThis.crypto.getRandomValues(b)
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join('')
}

const sb = createClient(url, key, { auth: { persistSession: false } })

const { data: users, error } = await sb
  .from('users')
  .select('id, full_name, tracking_code')
  .not('tracking_code', 'is', null)
if (error) {
  console.error('Error leyendo usuarios:', error.message)
  process.exit(1)
}

console.log(`Usuarios con tracking_code: ${users.length}${DRY ? '  (DRY RUN)' : ''}\n`)

const used = new Set()
let ok = 0
for (const u of users) {
  let code = gen()
  while (used.has(code)) code = gen()
  used.add(code)
  console.log(`${(u.full_name || u.id).padEnd(28)} ${String(u.tracking_code).padEnd(16)} → ${code}`)
  if (!DRY) {
    const { error: upErr } = await sb.from('users').update({ tracking_code: code }).eq('id', u.id)
    if (upErr) {
      console.error(`  ✗ ${u.id}: ${upErr.message}`)
      continue
    }
  }
  ok++
}

console.log(`\n${DRY ? 'Se cambiarían' : 'Actualizados'}: ${ok}/${users.length}`)
