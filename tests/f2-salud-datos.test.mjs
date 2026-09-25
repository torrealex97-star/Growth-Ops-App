import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { duracionDe, saludDeConector } from '../lib/data-health/conectores.ts'
import { clavesQueFaltan, SyncOmitidaError } from '../lib/integrations/sync-runs.ts'

// F2 — SALUD DE DATOS POR CONECTOR.
//
// "Data Health muestra last sync, cursor, error o backoff y estado de credenciales sin exponer
// secretos". Lo que se prueba aquí es sobre todo lo que NO debe pasar: que una subcuenta sin
// credenciales parezca averiada, que una pasada cortada declare una duración inventada, y que un
// valor de credencial se escape a la pantalla.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

const MANIFIESTO = {
  provider: 'meta',
  version: '1.0',
  label: 'Meta Ads',
  authMode: 'api_key',
  requiredKeys: ['META_ACCESS_TOKEN'],
  webhookKeys: [],
  supportedObjects: ['campaigns'],
  syncModes: ['backfill', 'manual'],
  capabilities: { backfill: true },
}

const ejecucion = (extra) => ({
  job: 'meta',
  provider: 'meta',
  status: 'ok',
  trigger: 'cron',
  startedAt: '2026-09-23T03:00:00.000Z',
  finishedAt: '2026-09-23T03:00:42.000Z',
  rowsWritten: 12,
  errorCode: null,
  errorMessage: null,
  ...extra,
})

// ── CREDENCIALES ─────────────────────────────────────────────────────────────────────────────

test('sin credenciales no es "fallando": es una integración que esta subcuenta no usa', () => {
  const s = saludDeConector(MANIFIESTO, { clavesConfiguradas: new Set(), ejecuciones: {} })
  assert.equal(s.estado, 'sin_credenciales')
  assert.deepEqual(s.credenciales.faltan, ['META_ACCESS_TOKEN'])
})

test('de las credenciales solo sale el NOMBRE de la clave, nunca el valor', () => {
  // La salida de esta función va a una pantalla. Un valor aquí es una credencial publicada.
  const s = saludDeConector(MANIFIESTO, { clavesConfiguradas: new Set(), ejecuciones: {} })
  assert.ok(!JSON.stringify(s).includes('EAA'), 'no puede viajar ningún valor de token')
  assert.deepEqual(Object.keys(s.credenciales).sort(), ['completas', 'faltan'])
})

test('un mensaje de error se vuelve a redactar antes de pintarlo', () => {
  const s = saludDeConector(MANIFIESTO, {
    clavesConfiguradas: new Set(['META_ACCESS_TOKEN']),
    ejecuciones: {
      meta: ejecucion({
        status: 'error',
        errorCode: 'token_invalido',
        errorMessage: 'GET https://graph.facebook.com/v25.0/me?access_token=EAAsecretoquenodebesalir falló',
      }),
    },
  })
  assert.ok(!s.incidencia.mensaje.includes('EAAsecretoquenodebesalir'))
  assert.match(s.incidencia.mensaje, /access_token=\[oculto\]/)
})

// ── ÚLTIMA EJECUCIÓN Y DURACIÓN ──────────────────────────────────────────────────────────────

test('una pasada cortada no declara duración: se dice que no se sabe', () => {
  // Es el arreglo de S0.7 §3.6: sellar la hora del barrido producía pasadas de 24 h. Un hueco no
  // es un cero, y tampoco es un día.
  const run = ejecucion({ status: 'timeout', finishedAt: null, errorCode: 'timeout', errorMessage: 'Se cortó.' })
  assert.equal(duracionDe(run), null)
  const s = saludDeConector(MANIFIESTO, {
    clavesConfiguradas: new Set(['META_ACCESS_TOKEN']),
    ejecuciones: { meta: run },
  })
  assert.equal(s.ultima.duracionMs, null)
  assert.equal(s.estado, 'fallando')
})

test('con varias pasadas del mismo proveedor manda la más reciente, pero el fallo no se tapa', () => {
  // Meta tiene tres pasadas distintas. Mirar solo la última diría "al día" con las otras dos caídas.
  const s = saludDeConector(MANIFIESTO, {
    clavesConfiguradas: new Set(['META_ACCESS_TOKEN']),
    ejecuciones: {
      meta: ejecucion({ startedAt: '2026-09-23T03:00:00.000Z' }),
      'meta-ads': ejecucion({
        job: 'meta-ads',
        startedAt: '2026-09-23T02:00:00.000Z',
        status: 'error',
        errorCode: 'limite_de_uso',
        errorMessage: 'Meta limitó las llamadas.',
      }),
    },
  })
  assert.equal(s.ultima.job, 'meta')
  assert.equal(s.estado, 'fallando')
  assert.equal(s.incidencia.seReintentaSolo, true, 'un límite de uso se reintenta solo')
})

test('las pasadas de otro proveedor no cuentan como propias', () => {
  const s = saludDeConector(MANIFIESTO, {
    clavesConfiguradas: new Set(['META_ACCESS_TOKEN']),
    ejecuciones: { ghl: ejecucion({ job: 'ghl', provider: 'ghl', status: 'error', errorMessage: 'lo de GHL' }) },
  })
  assert.equal(s.estado, 'nunca_ejecutada')
  assert.equal(s.incidencia, null)
})

// ── CURSOR ───────────────────────────────────────────────────────────────────────────────────

test('el cursor se explica, no se deja en blanco', () => {
  // "Sin cursor" es una decisión con motivo (Meta reescribe el pasado), no un dato que falte.
  const sinCursor = saludDeConector(MANIFIESTO, { clavesConfiguradas: new Set(['META_ACCESS_TOKEN']), ejecuciones: {} })
  assert.equal(sinCursor.cursor.soportado, false)
  assert.match(sinCursor.cursor.motivo, /ventana entera/)
  const conCursor = saludDeConector(
    { ...MANIFIESTO, syncModes: ['incremental'] },
    { clavesConfiguradas: new Set(['META_ACCESS_TOKEN']), ejecuciones: {} }
  )
  assert.equal(conCursor.cursor.soportado, true)
})

// ── LA OMISIÓN NO SE REGISTRA COMO AVERÍA ────────────────────────────────────────────────────

test('faltan las claves que faltan, y "cualquiera de estas" cuenta si hay una', () => {
  assert.deepEqual(clavesQueFaltan(['A', 'B'], { A: 'x' }), ['B'])
  assert.deepEqual(clavesQueFaltan([['A', 'B']], { B: 'x' }), [])
  assert.deepEqual(clavesQueFaltan([['A', 'B']], {}), ['A o B'])
  // Un valor en blanco no es una credencial configurada.
  assert.deepEqual(clavesQueFaltan(['A'], { A: '   ' }), ['A'])
})

test('la sincronización sin credenciales se omite SIN abrir ejecución', () => {
  // 19 filas `error` en catorce días eran subcuentas que no usan el proveedor (S0.7 §3.5). Un error
  // de configuración previsible apuntado como avería esconde las averías de verdad.
  const src = leer('lib/integrations/sync-runs.ts')
  const guardia = src.indexOf('throw new SyncOmitidaError')
  const insercion = src.indexOf(".from('integration_sync_runs')\n    .insert(")
  assert.ok(guardia > 0 && insercion > 0)
  assert.ok(guardia < insercion, 'la comprobación tiene que ir ANTES de registrar nada')
  const e = new SyncOmitidaError('meta', ['META_ACCESS_TOKEN'])
  assert.equal(e.code, 'sin_credenciales')
})

test('los crons tratan la omisión como omisión, no como error', () => {
  for (const job of ['meta', 'meta-daily', 'meta-ads', 'instagram']) {
    const src = leer(`app/api/[tenant]/evergreen/cron/${job}/route.ts`)
    assert.match(src, /requiere: \{ claves:/, `${job} no declara qué credenciales necesita`)
    assert.match(src, /omitida: e instanceof SyncBusyError \|\| e instanceof SyncOmitidaError/, job)
  }
})

test('el barrido de colgados no inventa la hora de fin', () => {
  const src = leer('lib/integrations/sync-runs.ts')
  const barrido = src.slice(src.indexOf('export async function reclaimAllStaleRuns'))
  assert.match(barrido.slice(0, 1200), /finished_at: null/, 'no se puede sellar una hora de fin que nadie conoce')
})

// ── LO QUE ENSEÑÓ MIRAR LA PANTALLA DE VERDAD (25-sep) ──────────────────────────────────────

test('faltar el secreto del webhook NO es estar sin configurar', () => {
  // En producción, Stripe salía "Sin configurar" por el signing secret mientras sincronizaba 74
  // filas cada hora sin un fallo. Son dos averías distintas y se rompen por separado: sin la clave
  // de lectura no hay sincronización; sin la del webhook lo que se cae es el aviso en tiempo real.
  const manifiesto = { ...MANIFIESTO, requiredKeys: ['STRIPE_SECRET_KEY'], webhookKeys: ['STRIPE_WEBHOOK_SECRET'] }
  const s = saludDeConector(manifiesto, {
    clavesConfiguradas: new Set(['STRIPE_SECRET_KEY']),
    ejecuciones: { stripe: ejecucion({ job: 'stripe-payments', provider: 'meta' }) },
  })
  assert.equal(s.credenciales.completas, true)
  assert.equal(s.estado, 'al_dia', 'sincroniza: no puede aparecer como "sin configurar"')
  assert.deepEqual(s.webhook.faltan, ['STRIPE_WEBHOOK_SECRET'], 'pero el hueco del webhook se dice')
})

test('la incidencia declara de qué pasada viene', () => {
  // La tarjeta de Meta se contradecía sola: "última pasada 31 s · 160 filas" encima de "se cortó,
  // no se sabe cuánto duró" — dos ejecuciones distintas presentadas como una.
  const s = saludDeConector(MANIFIESTO, {
    clavesConfiguradas: new Set(['META_ACCESS_TOKEN']),
    ejecuciones: {
      'meta-daily': ejecucion({ job: 'meta-daily', startedAt: '2026-09-25T11:01:53.000Z' }),
      meta: ejecucion({
        job: 'meta',
        startedAt: '2026-09-25T10:30:00.000Z',
        status: 'timeout',
        finishedAt: null,
        errorCode: 'timeout',
        errorMessage: 'Se cortó.',
      }),
    },
  })
  assert.equal(s.ultima.job, 'meta-daily')
  assert.equal(s.incidencia.job, 'meta', 'el fallo es de otro job, y la pantalla tiene que decirlo')
  assert.equal(s.incidencia.cuando, '2026-09-25T10:30:00.000Z')
})

test('la pantalla pinta las dos cosas por separado', () => {
  const panel = leer('components/settings/DataHealthPanel.tsx')
  assert.match(panel, /Incidencia en \{conector\.incidencia\.job\}/)
  assert.match(panel, /conector\.webhook\.faltan/)
})
