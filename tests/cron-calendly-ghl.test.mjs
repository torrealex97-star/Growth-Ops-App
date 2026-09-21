// El cron de CITAS (Calendly + GHL): pull diario que repara lo que los webhooks no cubren.
// Nació de un fallo real: la sync solo existía como botón manual, la importación inicial del
// 12-sep jamás tuvo planificador y las agendas nuevas dejaron de entrar en silencio (ni un run
// de estos proveedores en integration_sync_runs). Estos invariantes impiden que vuelva a pasar:
//   · autenticación CRON_SECRET (el pull dispara ingesta con service-role: no es público)
//   · config EXPLÍCITA por subcuenta (el token de Calendly de una no lee la cuenta de otra)
//   · candado de ejecución (recordSyncRun) y registro de la corrida por proveedor
//   · ventana incremental declarada (el pull no puede volver a ser "todo o nada")
//   · el workflow delegado existe, apunta a la ruta real y usa el Bearer CRON_SECRET
//   · SYNC_DEFS y SYNCS_BY_GROUP declaran las dos syncs (nada de sincronizaciones huérfanas)
//   · UNA sola implementación: botón y cron comparten lib/integrations/citas-sync
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

const sinComentarios = (src) =>
  src
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()

const ROUTE = 'app/api/[tenant]/evergreen/cron/calendly-ghl/route.ts'
const WORKFLOW = '.github/workflows/cron-calendly-ghl.yml'
const LIB = 'lib/integrations/citas-sync.ts'

test('el cron calendly-ghl existe y se autentica con CRON_SECRET', () => {
  const code = sinComentarios(read(ROUTE))
  assert.match(code, /export async function GET/)
  assert.match(code, /process\.env\.CRON_SECRET/, 'el cron debe exigir CRON_SECRET en el runtime')
  assert.match(code, /auth !== `Bearer \$\{process\.env\.CRON_SECRET\}`/, 'sin Bearer CRON_SECRET exacto no hay puerta')
  assert.match(code, /401/, 'el rechazo debe ser 401')
})

test('el cron recorre subcuentas con su config explícita y registra la corrida de Calendly', () => {
  const code = sinComentarios(read(ROUTE))
  assert.match(code, /from\('tenants'\)\.select\('id, slug'\)\.eq\('status', 'active'\)/)
  assert.match(code, /getTenantConfigWithFallback\(tn\.id/, 'la config de la subcuenta se lee, no se hereda')
  assert.doesNotMatch(code, /ensureConfig\(/, 'prohibido volcar credenciales en process.env')
  assert.match(code, /syncCalendly\(sb, tn\.id, cfg/, 'la sync de Calendly recibe la config de SU subcuenta')
  // GHL NO va en el cron (dos pasadas en producción: 504 y run colgado): su API lista todos los
  // contactos antes de tocar eventos y no cabe en los 60 s de Vercel. Lo cubren webhook + botón.
  assert.doesNotMatch(code, /syncGhl\(/, 'GHL prohibido en el cron: timeout garantizado')
  assert.match(code, /recordSyncRun\(/, 'sin registro de corrida, la tabla vacía no tiene causa')
  assert.match(code, /job: 'calendly-citas'/)
})

test('el cron omite sin error las subcuentas sin Calendly ni GHL y usa ventana incremental', () => {
  const code = sinComentarios(read(ROUTE))
  assert.match(code, /omitida: true/, 'sin credenciales no es un fallo: es una omisión declarada')
  assert.match(code, /desdeInicio/, 'la ventana incremental es la diferencia entre pull y re-importación')
})

test('la lib de citas es idempotente y acotada por presupuesto', () => {
  const code = sinComentarios(read(LIB))
  assert.match(code, /deadlineMs/, 'sin presupuesto de tiempo el cron repite el colgado de 60 s')
  assert.match(code, /cortado/, 'el corte debe declararse, no tragarse')
  // Idempotencia: upsert lógico por external_id — re-leer nunca duplica.
  assert.match(code, /eq\('external_id', eventId\)/, 'GHL deduplica por external_id')
  assert.match(code, /eq\('external_id', uri\)/, 'Calendly deduplica por external_id')
  // tenant_id estampado en los inserts: la fila nunca existe fuera de la subcuenta.
  const inserts = code.match(/\.insert\(\{[^}]*\}/g) || []
  assert.ok(inserts.length >= 2, 'hay inserts de contactos y citas')
  for (const ins of inserts) assert.match(ins, /tenant_id/, 'todo insert lleva tenant_id explícito')
})

test('el workflow delegado existe, apunta a la ruta real y usa el secret', () => {
  const yml = read(WORKFLOW)
  assert.match(yml, /name: ["']cron: calendly-ghl["']/, 'el name entrecomillado (gotcha YAML con dos puntos)')
  assert.match(yml, /- cron: '\d+ \d+ \* \* \*'/, 'schedule diario válido')
  assert.match(yml, /workflow_dispatch:/, 'debe poder dispararse a mano (primera carga / reintentos)')
  assert.match(yml, /\/api\/_\/evergreen\/cron\/calendly-ghl/, 'la URL debe ser la ruta global del cron')
  assert.match(yml, /secrets\.CRON_SECRET/, 'sin el secret el endpoint responde 401')
  assert.match(yml, /concurrency:\s*\n\s*group: cron-calendly-ghl/, 'grupo de concurrencia propio')
})

test('el horario 04:20 no colisiona con ningún otro cron delegado', () => {
  const ocupados = new Set()
  for (const f of [
    'cron-ai-insights',
    'cron-analyze-calls',
    'cron-instagram',
    'cron-meta-daily',
    'cron-meta',
    'cron-monthly',
    'cron-sequra-morosos',
    'cron-stripe-payments',
    'cron-calendly-ghl',
  ]) {
    const yml = read(`.github/workflows/${f}.yml`)
    const m = yml.match(/- cron: '(\d+) (\d+)/)
    assert.ok(m, `${f} tiene schedule`)
    const key = `${m[2]}:${m[1]}`
    assert.ok(!ocupados.has(key), `colisión de horario entre ${f} y otro cron en ${key}`)
    ocupados.add(key)
  }
})

test('SYNC_DEFS declara las syncs de citas y GHL queda sin cron (timeout garantizado)', () => {
  const m = read('lib/ops/sync-health.ts')
  const bloque = m.slice(m.indexOf("id: 'calendly-citas'"))
  assert.match(bloque, /route: 'cron\/calendly-ghl'/, 'calendly-citas debe declarar su ruta, no quedar huérfano')
  assert.match(bloque, /table: 'appointments'/)
  assert.match(bloque, /manualReason:/, 'manual-por-delegación también se justifica')
  const ghl = m.slice(m.indexOf("id: 'ghl-citas'"))
  assert.match(ghl, /route: null/, 'GHL sin cron: su API no cabe en los 60 s de Vercel')
  assert.match(ghl, /table: 'appointments'/)
})

test('los grupos calendly y ghl del panel incluyen sus syncs', () => {
  const m = read('lib/integrations/health.ts')
  assert.match(m, /calendly: \['calendly-citas'\]/)
  assert.match(m, /ghl: \['ghl-citas'\]/)
})

test('el botón manual y el cron comparten UNA implementación (sin copias que deriven)', () => {
  const ruta = sinComentarios(read('app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts'))
  assert.match(ruta, /from '@\/lib\/integrations\/citas-sync'/, 'history-sync consume la lib compartida')
  assert.doesNotMatch(
    ruta,
    /async function syncGhl|async function syncCalendly/,
    'prohibido duplicar las syncs: la deriva entre copias dejó la ingesta muerta'
  )
  // La ruta del cron importa de la misma lib.
  const cron = sinComentarios(read(ROUTE))
  assert.match(cron, /from '@\/lib\/integrations\/citas-sync'/)
})
