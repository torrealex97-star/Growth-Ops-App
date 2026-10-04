import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// F35 (P0) — FUGA ENTRE SUBCUENTAS.
//
// Medido en producción el 4-oct: un usuario con rol `admin` que NO era miembro de una subcuenta leía
// sus 83 pagos de Stripe (importes y correos), mientras que sus ventas salían correctamente en 0.
// `stripe_payments` y `knowledge_chunks` eran las únicas tablas con `tenant_id` sin política
// RESTRICTIVE de aislamiento, y sus políticas permisivas daban acceso a `is_admin_or_director()` sin
// mirar la subcuenta (`stripe_payments_all`, además, de lectura Y escritura).
// Tras aplicarla: admin miembro 83/90 (sin pérdida), admin no miembro 0/0, super admin 83/180.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const FICHERO = 'supabase/migrations/20261004100100_aislamiento_entre_subcuentas_stripe_payments_y_knowledge_chunks.sql'
const codigo = readFileSync(join(root, FICHERO), 'utf8').replace(/--[^\n]*/g, '')

test('añade la política restrictiva de aislamiento a las dos tablas que no la tenían', () => {
  const creadas = [...codigo.matchAll(/CREATE POLICY (\w+) ON public\.(\w+)\s+AS RESTRICTIVE\s+FOR ALL/g)].map(
    (m) => `${m[2]}.${m[1]}`
  )
  assert.deepEqual(creadas.sort(), [
    'knowledge_chunks.knowledge_chunks_tenant_isolation',
    'stripe_payments.stripe_payments_tenant_isolation',
  ])
})

test('es la misma regla que ya usan sales, collections y contacts: miembro de la subcuenta o super admin', () => {
  const reglas = [...codigo.matchAll(/USING \((.+)\);/g)].map((m) => m[1])
  assert.equal(reglas.length, 2)
  for (const r of reglas) {
    assert.match(r, /tenant_id IN \(SELECT auth_tenant_ids\(\)\)/)
    assert.match(r, /is_super_admin\(\)/)
  }
})

test('solo CIERRA: no abre nada ni toca las políticas permisivas existentes', () => {
  // Las políticas RESTRICTIVE se combinan con AND. Reescribir o borrar las permisivas sería otra
  // decisión, y quitarle el acceso a quien hoy lo tiene legítimamente.
  assert.doesNotMatch(codigo, /DROP POLICY|ALTER POLICY|ALTER TABLE|GRANT/i)
  assert.doesNotMatch(codigo, /AS PERMISSIVE/i)
})

test('ninguna otra tabla con tenant_id queda sin política restrictiva en las migraciones', () => {
  // Si una migración futura crea una tabla con tenant_id, debe traer su aislamiento: es lo que hacía
  // falta aquí y no estaba.
  const todas = readdirSync(join(root, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8'))
    .join('\n')
  for (const tabla of ['stripe_payments', 'knowledge_chunks']) {
    assert.match(todas, new RegExp(`CREATE POLICY \\w+ ON public\\.${tabla}\\s+AS RESTRICTIVE`))
  }
})
