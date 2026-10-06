// El cron de morosos de SeQura: pull semanal (lunes 08:00 UTC por GitHub Actions) más botón manual.
// Invariantes que no pueden relajarse sin abrir un falso rojo o un cruce entre subcuentas:
//   · autenticación CRON_SECRET (el pull dispara ingesta con service-role: no es público)
//   · config EXPLÍCITA por subcuenta (el comercio de una no sincroniza el de otra)
//   · una subcuenta SIN SeQura es una omisión declarada (omitida), no un 500 que tire el cron
//     entero — antes, una sin configurar devolvía 500 y el workflow fallaba todas las semanas
//   · candado y registro de la corrida (recordSyncRun): sin historial, la tabla vacía no tiene causa
//   · SYNC_DEFS declara la ruta con su planificador real (nada de sincronizaciones huérfanas)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { assessSync } from '../lib/ops/sync-health.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

const sinComentarios = (src) =>
  src
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()

const ROUTE = 'app/api/[tenant]/evergreen/cron/sequra-morosos/route.ts'
const WORKFLOW = '.github/workflows/cron-sequra-morosos.yml'

test('el cron sequra-morosos existe y se autentica con CRON_SECRET', () => {
  const code = sinComentarios(read(ROUTE))
  assert.match(code, /export async function GET/)
  assert.match(code, /process\.env\.CRON_SECRET/, 'el cron debe exigir CRON_SECRET en el runtime')
  assert.match(code, /auth === `Bearer \$\{process\.env\.CRON_SECRET\}`/, 'sin Bearer CRON_SECRET exacto no hay puerta')
})

test('recorre subcuentas con config explícita y deja registro de la ejecución', () => {
  const code = sinComentarios(read(ROUTE))
  assert.match(code, /from\('tenants'\)\.select\('id, slug'\)\.eq\('status', 'active'\)/)
  assert.match(code, /getTenantConfigWithFallback\(tn\.id/, 'la config de la subcuenta se lee, no se hereda')
  assert.match(code, /syncSequraDelinquents\(\s*tn\.id,\s*cfg/, 'la sync recibe la config de SU subcuenta')
  assert.match(code, /recordSyncRun\(/, 'sin registro de corrida, la tabla vacía no tiene causa')
  assert.match(code, /job: 'sequra-morosos'/)
  assert.match(
    code,
    /requiere: \{ claves: \['SEQURA_MCP_TOKEN', 'SEQURA_MERCHANT_REFERENCE'\], cfg \}/,
    'sin credenciales la sync se omite antes de ejecutarse (SyncOmitidaError), no falla'
  )
})

test('una subcuenta sin SeQura es una omisión, no un 500 global', () => {
  const code = sinComentarios(read(ROUTE))
  assert.match(code, /omitida: (e|true)/, 'la omisión debe quedar declarada en la respuesta')
  assert.match(code, /omitida: e instanceof SyncBusyError \|\| e instanceof SyncOmitidaError/)
  assert.match(code, /catch \(e\)/, 'el fallo de UNA subcuenta se captura dentro del bucle')
  assert.doesNotMatch(code, /Falta configurar SEQURA_MERCHANT_REFERENCE"\}, \{ status: 500/)
})

test('el botón manual sigue autenticado por sesión y acotado a su subcuenta', () => {
  const code = sinComentarios(read(ROUTE))
  assert.match(code, /requireTenant\(tenantSlug\)/)
  assert.match(code, /role === 'admin' \|\| role === 'director' \|\| role === 'cobros'/)
  assert.match(code, /trigger: 'manual'/)
})

test('una sync delegada con la última corrida fallida se pinta sync_fallido, no manual', () => {
  // Regresión del reorden de assessSync: si "manual" ganara a SYNC_FAILED, el fallo real de una
  // sync ejecutada por GitHub Actions sería invisible (caso real: Instagram, 9 errores seguidos).
  const r = assessSync(
    {
      id: 'instagram',
      label: 'Instagram orgánico',
      route: 'cron/instagram',
      table: 'ig_media',
      requiredKeys: ['INSTAGRAM_ACCESS_TOKEN'],
      scheduler: 'manual',
      manualReason: 'Se ejecuta a diario por GitHub Actions (02:30 UTC, cron-instagram.yml).',
    },
    {
      configuredKeys: new Set(['INSTAGRAM_ACCESS_TOKEN']),
      rowCounts: { ig_media: 5 },
      vercelScheduled: new Set(),
      pgCronReady: false,
      lastRuns: {
        instagram: {
          job: 'instagram',
          provider: 'instagram',
          status: 'error',
          trigger: 'cron',
          startedAt: '2026-10-06T09:00:00Z',
          finishedAt: '2026-10-06T09:01:00Z',
          rowsWritten: null,
          errorCode: 'token_invalido',
          errorMessage: 'Instagram API error (100): token inválido.',
        },
      },
    }
  )
  assert.equal(r.status, 'sync_fallido')
  assert.equal(r.lastErrorCode, 'token_invalido')
  assert.match(r.detail, /falló/)
})

test('el workflow delegado existe, apunta a la ruta real y usa el secret', () => {
  const yml = read(WORKFLOW)
  assert.match(yml, /name: ['"]cron: sequra-morosos['"]/)
  assert.match(yml, /- cron: '\d+ \d+ \* \* 1'/, 'schedule semanal (lunes)')
  assert.match(yml, /workflow_dispatch:/)
  assert.match(yml, /\/api\/_\/evergreen\/cron\/sequra-morosos/, 'la URL debe ser la ruta global del cron')
  assert.match(yml, /secrets\.CRON_SECRET/)
})

test('SYNC_DEFS declara la sync con su planificador real (GitHub Actions)', () => {
  const m = read('lib/ops/sync-health.ts')
  const bloque = m.slice(m.indexOf("id: 'sequra-morosos'"))
  assert.match(bloque, /route: 'cron\/sequra-morosos'/, 'sin ruta declarada sería huérfana')
  assert.match(bloque, /table: 'sequra_delinquent_customers'/)
  assert.match(bloque, /manualReason:/, 'manual-por-delegación también se justifica')
  assert.match(bloque, /cron-sequra-morosos\.yml/, 'el motivo cita el workflow real')
  assert.doesNotMatch(bloque, /scheduler: 'vercel'/, 'si se declara vercel, el panel diría "sin planificador"')
  // Dejarla `vercel` con la ruta fuera de vercel.json pinta un rojo falso: solo meta-ads y
  // reminders viven ahí; el resto lo ejecuta GitHub Actions.
  const vercel = JSON.parse(read('vercel.json'))
  const paths = (vercel.crons ?? []).map((c) => c.path)
  assert.ok(!paths.some((p) => p.includes('sequra-morosos')), 'sequra no está en vercel.json')
})
