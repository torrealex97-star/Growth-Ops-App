import assert from 'node:assert/strict'
import test from 'node:test'
import { assessDataState, assessSync, DATA_STALE_MS } from '../../lib/ops/sync-health.ts'

// "Vacío" no es un estado: son cinco, con cinco acciones distintas. Colapsarlos es lo que hacía que
// un token caducado se leyera como "esta cuenta no tiene campañas".
const AHORA = Date.parse('2026-09-13T12:00:00Z')
const run = (over = {}) => ({
  job: 'meta',
  provider: 'meta',
  status: 'ok',
  trigger: 'cron',
  startedAt: new Date(AHORA - 60_000).toISOString(),
  finishedAt: new Date(AHORA - 30_000).toISOString(),
  rowsWritten: 10,
  errorCode: null,
  errorMessage: null,
  ...over,
})

test('sin credenciales el estado es NOT_CONNECTED, antes que cualquier otra cosa', () => {
  assert.equal(assessDataState(['META_ACCESS_TOKEN'], 0, run({ status: 'error' }), AHORA), 'NOT_CONNECTED')
})

test('una ejecución fallida es SYNC_FAILED aunque haya datos viejos en la tabla', () => {
  assert.equal(assessDataState([], 500, run({ status: 'error', errorMessage: 'token' }), AHORA), 'SYNC_FAILED')
  assert.equal(assessDataState([], 0, run({ status: 'timeout' }), AHORA), 'SYNC_FAILED')
})

test('sin ninguna ejecución: pendiente si no hay datos, disponible si los hay', () => {
  // Sin historial no se puede juzgar la frescura. Decir "vacía" teniendo filas sería falso, y decir
  // "vieja" sería inventado.
  assert.equal(assessDataState([], 0, null, AHORA), 'SYNC_PENDING')
  assert.equal(assessDataState([], 120, null, AHORA), 'DATA_AVAILABLE')
})

test('una ejecución en curso es SYNC_PENDING, no un fallo', () => {
  assert.equal(assessDataState([], 0, run({ status: 'running', finishedAt: null }), AHORA), 'SYNC_PENDING')
})

test('corrió bien y el proveedor no devolvió nada: SYNC_SUCCESS_NO_DATA', () => {
  assert.equal(assessDataState([], 0, run({ rowsWritten: 0 }), AHORA), 'SYNC_SUCCESS_NO_DATA')
})

test('si no se pudo contar la tabla, manda lo que la ejecución dice que escribió', () => {
  // Un hueco no es un cero: "no se pudo leer" y "hay 0 filas" son cosas distintas.
  assert.equal(assessDataState([], null, run({ rowsWritten: 0 }), AHORA), 'SYNC_SUCCESS_NO_DATA')
  assert.equal(assessDataState([], null, run({ rowsWritten: 7 }), AHORA), 'DATA_AVAILABLE')
  assert.equal(assessDataState([], null, run({ rowsWritten: null }), AHORA), 'SYNC_PENDING')
})

test('datos con la última ejecución correcta demasiado antigua: DATA_STALE', () => {
  const vieja = new Date(AHORA - DATA_STALE_MS - 1000).toISOString()
  assert.equal(assessDataState([], 300, run({ finishedAt: vieja, startedAt: vieja }), AHORA), 'DATA_STALE')
})

test('la tarjeta se pone en rojo con el motivo real del fallo, no con "está vacía"', () => {
  const def = {
    id: 'meta',
    label: 'Meta Ads',
    route: 'cron/meta',
    table: 'campaigns',
    requiredKeys: ['META_ACCESS_TOKEN'],
    scheduler: 'vercel',
  }
  const facts = {
    configuredKeys: new Set(['META_ACCESS_TOKEN']),
    rowCounts: { campaigns: 0 },
    vercelScheduled: new Set(['cron/meta']),
    pgCronReady: false,
    lastRuns: {
      meta: run({
        status: 'error',
        errorCode: 'proof_invalido',
        errorMessage: 'El App Secret guardado no corresponde a la app que generó el token.',
      }),
    },
  }
  const salud = assessSync(def, facts, AHORA)
  assert.equal(salud.status, 'sync_fallido')
  assert.equal(salud.dataState, 'SYNC_FAILED')
  assert.equal(salud.lastErrorCode, 'proof_invalido')
  assert.match(salud.detail, /App Secret/)
  assert.doesNotMatch(salud.detail, /Revisa el último error/)
})

test('sin ejecuciones y sin datos, la tarjeta lo dice sin insinuar que el proveedor no tiene nada', () => {
  const def = {
    id: 'meta-daily',
    label: 'Gasto diario',
    route: 'cron/meta-daily',
    table: 'campaign_daily',
    requiredKeys: [],
    scheduler: 'vercel',
  }
  const salud = assessSync(
    def,
    {
      configuredKeys: new Set(),
      rowCounts: { campaign_daily: 0 },
      vercelScheduled: new Set(['cron/meta-daily']),
      pgCronReady: false,
    },
    AHORA
  )
  assert.equal(salud.dataState, 'SYNC_PENDING')
  assert.match(salud.detail, /Todavía no se ha ejecutado/)
})
