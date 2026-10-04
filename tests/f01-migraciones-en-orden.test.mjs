import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

const dir = new URL('../supabase/migrations/', import.meta.url)
const archivos = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

test('is_team_scope_allowed() se define en una migración anterior a la primera que la usa (F01)', () => {
  const definidora = archivos.find((f) =>
    /CREATE OR REPLACE FUNCTION public\.is_team_scope_allowed/i.test(readFileSync(new URL(f, dir), 'utf8'))
  )
  assert.ok(definidora, 'falta la migración que define is_team_scope_allowed()')
  const usos = archivos.filter(
    (f) => f !== definidora && /is_team_scope_allowed\(\)/.test(readFileSync(new URL(f, dir), 'utf8'))
  )
  assert.ok(usos.length >= 2, 'las migraciones posteriores de F01 deben existir en el repo')
  for (const u of usos) assert.ok(definidora < u, `${u} se aplicaría antes que ${definidora}`)
})

test('las migraciones F01 llevan la versión con la que están registradas en producción', () => {
  assert.ok(archivos.includes('20261003082207_gate_team_scope_to_leadership.sql'))
  assert.ok(archivos.includes('20261003122304_scope_stripe_payments_to_attribution.sql'))
})
