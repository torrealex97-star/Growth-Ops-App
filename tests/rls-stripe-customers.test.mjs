import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// RESTO DE F01 — `stripe_customers` seguía legible por cualquier miembro de la subcuenta.
// Medido en producción el 4-oct con perfiles que SON miembros de WDC: un colaborador y el setter
// leían 32 de 32 clientes de Stripe (correo y nombre) con 0 ventas, citas y contactos visibles.
// Tras aplicar la migración: colaborador con atribuciones 16 (exactamente los suyos), sin
// atribuciones 0, admin 32. Este test fija la FORMA; la prueba real es esa medición.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sql = readFileSync(
  join(root, 'supabase/migrations/20261004100000_scope_stripe_customers_to_contact_visibility.sql'),
  'utf8'
)
const codigo = sql.replace(/--[^\n]*/g, '')

test('solo reescribe la política de lectura abierta a todos los miembros', () => {
  const alteradas = [...codigo.matchAll(/ALTER POLICY (\w+) ON public\.(\w+)/g)].map((m) => `${m[2]}.${m[1]}`)
  assert.deepEqual(alteradas, ['stripe_customers.stripe_customers_select_team'])
  assert.doesNotMatch(codigo, /DROP POLICY|CREATE POLICY|ALTER TABLE/i)
})

test('liderazgo conserva todo; el resto hereda la visibilidad del contacto', () => {
  assert.match(codigo, /is_super_admin\(\)/)
  assert.match(codigo, /is_admin_or_director\(\)/)
  // Reutiliza el helper de la migración 20261003120000 en vez de inventar otra regla de «equipo».
  assert.match(codigo, /is_team_scope_allowed\(\)/)
  assert.match(codigo, /EXISTS \(SELECT 1 FROM public\.contacts c WHERE c\.id = stripe_customers\.contact_id\)/)
})

test('la pertenencia a la subcuenta sigue siendo condición, no se sustituye por el contacto', () => {
  assert.match(codigo, /tenant_id IN \(SELECT auth_tenant_ids\(\)\)/)
})

test('un cliente sin contacto enlazado solo lo ve liderazgo', () => {
  // `contact_id IS NOT NULL` evita que un NULL pase por la subconsulta; esos clientes son
  // reconciliación pendiente, no dato de un vendedor concreto.
  assert.match(codigo, /contact_id IS NOT NULL/)
})
