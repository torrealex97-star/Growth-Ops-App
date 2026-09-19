// El cron del espejo de pagos Stripe: pull diario que completa el histórico y repara lo que el
// webhook pudo perder. Invariantes que no pueden relajarse sin abrir una fuga o un fantasma:
//   · autenticación CRON_SECRET (el pull dispara ingesta con service-role: no es público)
//   · config EXPLÍCITA por subcuenta (la clave de una no sincroniza la cuenta de otra)
//   · candado de ejecución (recordSyncRun) y registro de la corrida
//   · el workflow delegado existe, apunta a la ruta real y usa el Bearer CRON_SECRET
//   · SYNC_DEFS declara la ruta (nada de sincronizaciones huérfanas)
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

const ROUTE = 'app/api/[tenant]/evergreen/cron/stripe-payments/route.ts'
const WORKFLOW = '.github/workflows/cron-stripe-payments.yml'

test('el cron stripe-payments existe y se autentica con CRON_SECRET', () => {
  const code = sinComentarios(read(ROUTE))
  assert.match(code, /export async function GET/)
  assert.match(code, /process\.env\.CRON_SECRET/, 'el cron debe exigir CRON_SECRET en el runtime')
  assert.match(code, /auth !== `Bearer \$\{process\.env\.CRON_SECRET\}`/, 'sin Bearer CRON_SECRET exacto no hay puerta')
  assert.match(code, /401/, 'el rechazo debe ser 401')
})

test('el cron recorre subcuentas con su config explícita y deja registro de la ejecución', () => {
  const code = sinComentarios(read(ROUTE))
  assert.match(code, /from\('tenants'\)\.select\('id, slug'\)\.eq\('status', 'active'\)/)
  assert.match(code, /getTenantConfigWithFallback\(tn\.id/, 'la config de la subcuenta se lee, no se hereda')
  assert.doesNotMatch(code, /ensureConfig\(/, 'prohibido volcar credenciales en process.env')
  assert.match(code, /syncStripePayments\(\s*sb,\s*tn\.id,\s*cfg\.STRIPE_SECRET_KEY/, 'la sync recibe la clave de SU subcuenta')
  assert.match(code, /recordSyncRun\(/, 'sin registro de corrida, la tabla vacía no tiene causa')
  assert.match(code, /job: 'stripe-payments'/, 'la corrida debe registrarse bajo el job del espejo')
})

test('el cron omite sin error las subcuentas sin Stripe y no inventa tenants', () => {
  const code = sinComentarios(read(ROUTE))
  assert.match(code, /omitida: true/, 'sin clave no es un fallo: es una omisión declarada')
  assert.doesNotMatch(code, /\.neq\(|\.or\(/, 'no filtros raros: solo status=active')
})

test('el workflow delegado existe, apunta a la ruta real y usa el secret', () => {
  const yml = read(WORKFLOW)
  assert.match(yml, /name: "cron: stripe-payments"/, 'el name entrecomillado (gotcha YAML con dos puntos)')
  assert.match(yml, /- cron: '\d+ \d+ \* \* \*'/, 'schedule diario válido')
  assert.match(yml, /workflow_dispatch:/, 'debe poder dispararse a mano (backfill inicial)')
  assert.match(yml, /\/api\/_\/evergreen\/cron\/stripe-payments/, 'la URL debe ser la ruta global del cron')
  assert.match(yml, /secrets\.CRON_SECRET/, 'sin el secret el endpoint responde 401')
  assert.match(yml, /concurrency:\s*\n\s*group: cron-stripe-payments/, 'grupo de concurrencia propio')
})

test('SYNC_DEFS declara el cron stripe-payments con su ruta y su tabla', () => {
  const m = read('lib/ops/sync-health.ts')
  const bloque = m.slice(m.indexOf("id: 'stripe-payments'"))
  const siguiente = bloque.slice(0, bloque.indexOf("id: 'youtube-backfill'"))
  assert.match(siguiente, /route: 'cron\/stripe-payments'/, 'la ruta debe quedar declarada, no huérfana')
  assert.match(siguiente, /table: 'stripe_payments'/)
  assert.match(siguiente, /manualReason:/, 'manual-por-delegación también se justifica')
})

test('el grupo stripe del panel incluye stripe-payments', () => {
  const m = read('lib/integrations/health.ts')
  assert.match(m, /stripe: \['stripe-customers', 'stripe-payments'\]/)
})
