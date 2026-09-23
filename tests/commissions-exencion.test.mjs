// QUIÉN COMISIONA — exención por persona (2026-09-23, migración 20260923160000).
//
// REQUISITO: "debemos poder marcar o desmarcar quien comisiona o no y cuanto".
// Caso real: una SOCIA que cierra ventas como closer no cobra comisión de
// closer — su beneficio va por la sociedad. La exención vive en
// users.pays_commissions (false = exento) y el MOTOR es el único punto que
// decide: sin fila en el ledger `commissions`, la persona desaparece de TODAS
// las métricas (dashboard, P&L, comisiones, proyección) a la vez.
//
// Patrón del repo: la lógica pura del motor se importa REAL (calculator.ts es
// TS puro, mismo patrón que tests de social-research) y las rutas se verifican
// por fuente.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

const { calculateCommissionsForCollection, esExentoDeComision } = await import('../lib/commissions/calculator.ts')

// Universo mínimo: una venta cerrada por la socia (closer) y cobrada.
const collection = {
  id: 'col_1',
  tenant_id: 't1',
  sale_id: 's1',
  gross_amount: 1000,
  commissionable_amount: 1000,
  collected_at: '2026-09-20T10:00:00Z',
  status: 'collected',
}
const sale = {
  id: 's1',
  tenant_id: 't1',
  setter_id: 'setter_1',
  closer_id: 'socia',
  affiliate_id: null,
  affiliate_commission_percent: null,
}
const rules = [
  {
    participant_type: 'setter',
    percent: 5,
    is_active: true,
    active_from: '2026-01-01',
    active_to: null,
    user_id: null,
    min_cash: 0,
    max_cash: null,
    tramo_id: null,
  },
  {
    participant_type: 'closer',
    percent: 10,
    is_active: true,
    active_from: '2026-01-01',
    active_to: null,
    user_id: null,
    min_cash: 0,
    max_cash: null,
    tramo_id: null,
  },
]

test('sin exención: el motor genera setter y closer como siempre (OLD BEHAVIOR = PASS)', () => {
  const filas = calculateCommissionsForCollection('t1', collection, sale, rules)
  assert.equal(filas.length, 2)
  assert.deepEqual(filas.map((f) => f.participant_type).sort(), ['closer', 'setter'])
  assert.equal(filas.find((f) => f.participant_type === 'closer').commission_amount, 100)
})

test('con la socia exenta: su fila de closer NO se genera, el setter cobra intacto', () => {
  const filas = calculateCommissionsForCollection('t1', collection, sale, rules, {}, {}, null, 0, new Set(['socia']))
  assert.equal(filas.length, 1)
  assert.equal(filas[0].participant_type, 'setter')
  assert.equal(filas[0].commission_amount, 50)
  assert.ok(!filas.some((f) => f.user_id === 'socia'), 'la socia no debe tener comisión')
})

test('la exención vale para CUALQUIER rol: setter exento no cobra, y una afiliada distinta sí', () => {
  const venta = { ...sale, setter_id: 'socio_setter', affiliate_id: 'afiliada_1', affiliate_commission_percent: 15 }
  const filas = calculateCommissionsForCollection(
    't1',
    collection,
    venta,
    rules,
    {},
    {},
    null,
    0,
    new Set(['socio_setter'])
  )
  // Setter exento fuera; closer (no exenta aquí) y afiliada (no exenta) siguen.
  assert.deepEqual(filas.map((f) => f.participant_type).sort(), ['affiliate', 'closer'])
  assert.ok(!filas.some((f) => f.user_id === 'socio_setter'))
  // Y si TODOS los participantes están exentos (socia closer + socio setter + socia afiliada),
  // el motor no genera NINGUNA fila: la exención es por persona, no por rol.
  const todosExentos = calculateCommissionsForCollection(
    't1',
    collection,
    { ...sale, setter_id: 'socio_setter', affiliate_id: 'socia', affiliate_commission_percent: 15 },
    rules,
    {},
    {},
    null,
    0,
    new Set(['socia', 'socio_setter'])
  )
  assert.equal(todosExentos.length, 0)
})

test('exención vacía/null = comportamiento estándar (lista vacía significa "nadie exento")', () => {
  const a = calculateCommissionsForCollection('t1', collection, sale, rules, {}, {}, null, 0, new Set())
  const b = calculateCommissionsForCollection('t1', collection, sale, rules, {}, {}, null, 0, null)
  assert.equal(a.length, 2)
  assert.equal(b.length, 2)
})

test('esExentoDeComision: ids falsy y conjuntos ausentes nunca son exentos', () => {
  assert.equal(esExentoDeComision(null, new Set(['x'])), false)
  assert.equal(esExentoDeComision(undefined, new Set(['x'])), false)
  assert.equal(esExentoDeComision('socia', null), false)
  assert.equal(esExentoDeComision('socia', new Set(['socia'])), true)
})

// ── El motor se aplica en TODOS los caminos de generación ───────────────────

test('hot path y reconcile cargan los exentos y se los pasan al motor', () => {
  const gen = leer('lib/commissions/generate.ts')
  // El loader existe y es tenant-scoped.
  assert.match(gen, /export async function usuariosExentosDeComision/)
  assert.match(gen, /\.eq\('tenant_id', tenantId\)/)
  assert.match(gen, /\.eq\('pays_commissions', false\)/)
  // Ambos caminos (generateCommissionsForCollection y reconcileSaleCommissions) lo usan.
  const usos = (gen.match(/await usuariosExentosDeComision\(/g) || []).length
  assert.equal(usos, 2, 'los DOS generadores deben cargar la exención')
  // Y el reconcile — que RECONSTRUYE filas — no puede revivir comisiones del exento.
  assert.match(gen, /const exentos = await usuariosExentosDeComision\(sb, tenantId\)/)
})

test('la proyección de comisiones futuras no promete lo que el motor no pagará', () => {
  const ruta = leer('app/api/[tenant]/evergreen/commissions/future/route.ts')
  assert.match(ruta, /usuariosExentosDeComision/)
  assert.match(ruta, /if \(exentos\.has\(repId\)\) return/, 'la fila del exento no se proyecta')
})

// ── La marca/desmarca vive en la UI de usuarios, con purga del legado ──────

test('settings/users expone el toggle y purga comisiones pendientes al exentar', () => {
  const ui = leer('app/[tenant]/settings/users/page.tsx')
  assert.match(ui, /pays_commissions/)
  assert.match(ui, /Comisiona/)
  const ruta = leer('app/api/[tenant]/evergreen/users/route.ts')
  // La purga SOLO toca positivas no liquidadas: las liquidadas (dinero ya pagado) y los
  // espejos de devolución quedan intactos.
  assert.match(ruta, /neq\('status', 'liquidated'\)/)
  assert.match(ruta, /direction === 'positive'/)
  assert.match(ruta, /paysCommissions === false/)
})

// ── El esquema sostiene el flag ─────────────────────────────────────────────

test('la migración es aditiva, con default true y registrable', () => {
  const mig = leer('supabase/migrations/20260923160000_users_pays_commissions.sql')
  assert.match(mig, /ADD COLUMN IF NOT EXISTS pays_commissions BOOLEAN NOT NULL DEFAULT true/)
  // Sin DDL destructivo fuera de comentarios: la reversión es un DROP COLUMN posterior, nunca aquí.
  const sinComentarios = mig.replace(/--[^\n]*/g, '')
  assert.doesNotMatch(sinComentarios, /DROP COLUMN|DROP TABLE|DELETE FROM/, 'la migración base no es destructiva')
  assert.match(leer('lib/types/database-generated.ts'), /pays_commissions: boolean/)
})
