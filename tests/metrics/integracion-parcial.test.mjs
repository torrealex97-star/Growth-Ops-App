import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { assessIntegration, SYNCS_BY_GROUP } from '../../lib/integrations/health.ts'
import { SYNC_DEFS } from '../../lib/ops/sync-health.ts'

const ahora = Date.parse('2026-09-14T12:00:00Z')
const hace = (min) => new Date(ahora - min * 60_000).toISOString()

// Meta tiene TRES sincronizaciones. `facts` simula que las credenciales están puestas, que las
// tablas tienen filas y que cada job tiene un último resultado.
function facts(runs) {
  return {
    configuredKeys: new Set(['META_ACCESS_TOKEN']),
    rowCounts: { campaigns: 12, campaign_daily: 340, campaign_ads: 55 },
    // Las tres syncs de Meta están declaradas en vercel.json: así ninguna sale "sin planificador",
    // que es otro camino a rojo y taparía lo que este test mide.
    vercelScheduled: new Set(SYNC_DEFS.filter((d) => d.route).map((d) => d.route)),
    pgCronReady: false,
    lastRuns: runs,
  }
}
const grupoMeta = { id: 'meta', required: ['META_ACCESS_TOKEN'], testable: true }
const comprobacionOk = { ok: true, message: 'Meta responde.', checkedAt: hace(10) }

const jobsMeta = SYNCS_BY_GROUP.meta
const ok = (job) => [
  job,
  { status: 'ok', startedAt: hace(31), finishedAt: hace(30), rowsWritten: 10, errorCode: null, errorMessage: null },
]
const fallo = (job, code) => [
  job,
  {
    status: 'error',
    startedAt: hace(21),
    finishedAt: hace(20),
    rowsWritten: 0,
    errorCode: code,
    errorMessage: `falló: ${code}`,
  },
]

test('un límite de peticiones con el resto sano es PARCIAL, no error', () => {
  // ESTE es el salto que veía el usuario: una de las tres syncs topa con el rate limit de la Graph
  // API y toda la integración pintaba roja; al siguiente cron volvía a verde sin tocar nada.
  const runs = Object.fromEntries([fallo(jobsMeta[0], 'limite_de_uso'), ok(jobsMeta[1]), ok(jobsMeta[2])])
  const h = assessIntegration(grupoMeta, { facts: facts(runs), lastCheck: comprobacionOk, now: ahora })
  assert.equal(h.status, 'parcial')
  // Y dice explícitamente que las credenciales están bien, que es lo que el usuario iba a tocar.
  assert.match(h.detail, /credenciales están bien/)
})

test('un fallo de credenciales sigue siendo ERROR aunque las otras vayan', () => {
  const runs = Object.fromEntries([fallo(jobsMeta[0], 'token_invalido'), ok(jobsMeta[1]), ok(jobsMeta[2])])
  const h = assessIntegration(grupoMeta, { facts: facts(runs), lastCheck: comprobacionOk, now: ahora })
  assert.equal(h.status, 'error')
  assert.match(h.headline, /1 de 3 sincronizaciones fallaron/)
  // Y el arreglo concreto es el del código real, no el genérico.
  assert.match(h.fix ?? '', /caducado, rotado o revocado/)
})

test('si TODAS fallan es ERROR, aunque el motivo sea reintentable', () => {
  const runs = Object.fromEntries(jobsMeta.map((j) => fallo(j, 'red')))
  const h = assessIntegration(grupoMeta, { facts: facts(runs), lastCheck: comprobacionOk, now: ahora })
  assert.equal(h.status, 'error')
})

test('todo en orden sigue siendo verde', () => {
  const runs = Object.fromEntries(jobsMeta.map((j) => ok(j)))
  const h = assessIntegration(grupoMeta, { facts: facts(runs), lastCheck: comprobacionOk, now: ahora })
  assert.equal(h.status, 'conectada')
})

test('sin credenciales manda el "sin configurar", no el estado de las syncs', () => {
  const runs = Object.fromEntries([fallo(jobsMeta[0], 'limite_de_uso'), ok(jobsMeta[1]), ok(jobsMeta[2])])
  const h = assessIntegration(grupoMeta, {
    facts: { ...facts(runs), configuredKeys: new Set() },
    lastCheck: comprobacionOk,
    now: ahora,
  })
  assert.equal(h.status, 'sin_configurar')
})

test('la pantalla pinta el estado parcial y lo trata como conectada', () => {
  const ui = readFileSync(new URL('../../app/[tenant]/settings/integraciones/page.tsx', import.meta.url), 'utf8')
  // Ámbar: ni verde (mentiría) ni rojo (no hay nada que arreglar).
  assert.match(ui, /parcial: \{ dot: 'bg-amber-400'/)
  assert.match(ui, /h\.status === 'parcial'/)
  // Y el botón no invita a reconfigurar algo que ya está conectado.
  assert.match(ui, /h\?\.status === 'conectada' \|\| h\?\.status === 'parcial' \? 'Ver' : 'Configurar'/)
})

test('un solo módulo decide el estado de integración', () => {
  // §8 del brief: nada de componentes calculando el estado cada uno a su manera.
  const ui = readFileSync(new URL('../../app/[tenant]/settings/integraciones/page.tsx', import.meta.url), 'utf8')
  assert.ok(!/function assessIntegration/.test(ui), 'la UI no debe recalcular el estado')
  assert.ok(!/sync_fallido.*\?.*'error'/s.test(ui.slice(0, 400)), 'la UI no debe derivar el estado de las syncs')
})
