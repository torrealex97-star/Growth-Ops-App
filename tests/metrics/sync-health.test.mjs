import assert from 'node:assert/strict'
import test from 'node:test'
import { assessAll, assessSync, SYNC_DEFS } from '../../lib/ops/sync-health.ts'

const facts = (over = {}) => ({
  configuredKeys: new Set(['META_ACCESS_TOKEN', 'ANTHROPIC_API_KEY']),
  rowCounts: {},
  vercelScheduled: new Set(),
  pgCronReady: false,
  ...over,
})

const def = (over = {}) => ({
  id: 'x',
  label: 'X',
  route: 'cron/x',
  table: 'tabla_x',
  requiredKeys: [],
  scheduler: 'vercel',
  ...over,
})

// El fallo real que motivó este módulo: credenciales puestas y NADIE ejecutando la ruta. No falla,
// simplemente nunca corre — y un panel que mirara solo las credenciales diría "conectado".
test('con credenciales pero sin planificador el estado es sin_planificador, no "ok"', () => {
  const r = assessSync(def({ requiredKeys: ['META_ACCESS_TOKEN'] }), facts({ rowCounts: { tabla_x: 0 } }))
  assert.equal(r.status, 'sin_planificador')
  assert.match(r.detail, /vercel\.json/)
})

test('una sincronización de pg_cron sin pg_cron habilitada también es sin_planificador', () => {
  const r = assessSync(def({ scheduler: 'pg_cron' }), facts({ pgCronReady: false }))
  assert.equal(r.status, 'sin_planificador')
  assert.match(r.detail, /pg_cron/)
})

test('faltar credenciales pesa más que faltar planificador: no puede ni intentarlo', () => {
  const r = assessSync(def({ requiredKeys: ['NO_ESTA'] }), facts())
  assert.equal(r.status, 'sin_credenciales')
  assert.deepEqual(r.missingKeys, ['NO_ESTA'])
})

test('programada y con datos es ok', () => {
  const r = assessSync(def(), facts({ vercelScheduled: new Set(['cron/x']), rowCounts: { tabla_x: 1234 } }))
  assert.equal(r.status, 'ok')
  // Sin formato de locale a propósito: la cifra cruda va en `rows` y la formatea la UI.
  assert.match(r.detail, /1234 filas/)
  assert.equal(r.rows, 1234)
})

test('programada y con la tabla vacía es sin_datos, y lo dice sin culpar a nadie', () => {
  const r = assessSync(def(), facts({ vercelScheduled: new Set(['cron/x']), rowCounts: { tabla_x: 0 } }))
  assert.equal(r.status, 'sin_datos')
  assert.match(r.detail, /vacía/)
})

test('no poder leer la tabla no es lo mismo que cero filas', () => {
  const r = assessSync(def(), facts({ vercelScheduled: new Set(['cron/x']), rowCounts: { tabla_x: null } }))
  assert.equal(r.status, 'sin_datos')
  assert.equal(r.rows, null)
  assert.match(r.detail, /No se pudo leer/)
})

test('lo manual se reporta como manual, con su motivo, no como un fallo', () => {
  const r = assessSync(def({ scheduler: 'manual', manualReason: 'porque gasta cuota' }), facts())
  assert.equal(r.status, 'manual')
  assert.equal(r.detail, 'porque gasta cuota')
})

test('toda sincronización manual tiene que justificar por qué', () => {
  // Si no, "manual" se convierte en el cajón donde acaba lo que nadie programó por olvido.
  for (const d of SYNC_DEFS.filter((x) => x.scheduler === 'manual')) {
    assert.ok(d.manualReason && d.manualReason.length > 20, `${d.id} es manual sin motivo escrito`)
  }
})

test('el catálogo declara tabla, ruta y planificador para cada sincronización', () => {
  assert.ok(SYNC_DEFS.length >= 10)
  const ids = SYNC_DEFS.map((d) => d.id)
  assert.equal(new Set(ids).size, ids.length, 'hay ids repetidos')
  for (const d of SYNC_DEFS) {
    assert.ok(d.table, `${d.id} sin tabla`)
    // `route` null = se dispara desde la interfaz, no hay cron. Lo que NO se admite es una ruta
    // inventada para que una sincronización manual encaje en el catálogo.
    if (d.route !== null) assert.match(d.route, /^cron\//, `${d.id} con ruta rara`)
    else assert.equal(d.scheduler, 'manual', `${d.id} sin ruta pero programado`)
    assert.ok(['vercel', 'pg_cron', 'manual'].includes(d.scheduler), `${d.id} con planificador inválido`)
  }
})

test('assessAll devuelve una entrada por sincronización', () => {
  assert.equal(assessAll(facts()).length, SYNC_DEFS.length)
})
