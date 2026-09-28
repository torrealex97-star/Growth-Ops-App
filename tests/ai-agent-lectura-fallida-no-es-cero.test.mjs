import assert from 'node:assert/strict'
import test from 'node:test'
import { getBusinessOverview, getFunnel, getSales } from '../lib/ai/agent/tools.ts'
import { detectAnomalies } from '../lib/ai/insights/detectors.ts'

// REGRESIÓN — "un hueco no es un cero" en las tools del agente de IA y los detectores de
// insights (informe de auditoría FASE A, 26-sep, hallazgo P1 #5). Antes, un fallo de lectura en
// `sales`/`campaigns` se tragaba (`const { data } = await sb...`) y se presentaba como "0 ventas"
// / "0 € de ingresos" / ROAS 0 — tanto al usuario que lee la respuesta del agente como a
// detectAnomalies, que compararía contra ese cero fabricado y anunciaría una caída que nunca
// ocurrió.

/** Cliente falso: cada tabla puede devolver éxito (rows) o un error concreto. */
function client(overrides = {}) {
  return {
    from(table) {
      const cfg = overrides[table] ?? { rows: [] }
      let head = false
      const query = {
        select(_columns, options) {
          head = options?.head === true
          return query
        },
        eq() {
          return query
        },
        gte() {
          return query
        },
        lte() {
          return query
        },
        order() {
          return query
        },
        not() {
          return query
        },
        in() {
          return query
        },
        lt() {
          return query
        },
        limit() {
          return query
        },
        then(resolve, reject) {
          if (cfg.error) return Promise.resolve({ data: null, count: null, error: cfg.error }).then(resolve, reject)
          return Promise.resolve({
            data: head ? null : cfg.rows,
            count: cfg.rows.length,
            error: null,
          }).then(resolve, reject)
        },
      }
      return query
    },
  }
}

test('getSales: un fallo de lectura devuelve error, nunca "0 ventas"', async () => {
  const sb = client({ sales: { error: { message: 'timeout' } } })
  const result = await getSales({ tenantId: 't1', sb }, {})
  assert.equal(result.error, 'timeout')
  assert.equal('total_ventas' in result, false, 'no debe fabricar total_ventas cuando la lectura falló')
})

test('getBusinessOverview: fallo en sales → ventas/ingresos en null + error, no en 0', async () => {
  const sb = client({ sales: { error: { message: 'timeout ventas' } }, campaigns: { rows: [] } })
  const result = await getBusinessOverview({ tenantId: 't1', sb }, {})
  assert.equal(result.ventas, null)
  assert.equal(result.ingresos, null)
  assert.match(result.error, /timeout ventas/)
})

test('getFunnel: fallo en campaigns devuelve solo error, ROAS no se pinta 0', async () => {
  const sb = client({ campaigns: { error: { message: 'timeout campañas' } } })
  const result = await getFunnel({ tenantId: 't1', sb }, {})
  assert.match(result.error, /timeout campañas/)
  assert.equal('roas' in result, false)
})

test('detectAnomalies: si getBusinessOverview falla, NO anuncia un cac_increase fabricado', async () => {
  // sales falla en AMBAS ventanas (current/previous llaman a la misma tabla) → sin comparación.
  const sb = client({
    sales: { error: { message: 'timeout' } },
    campaigns: { rows: [] },
    appointments: { rows: [] },
  })
  const anomalies = await detectAnomalies('t1', sb)
  assert.ok(
    !anomalies.some((a) => a.type === 'cac_increase'),
    'sin datos reales de ventas no puede haber una anomalía de CAC'
  )
})

test('detectAnomalies: si getFunnel falla, NO anuncia un roas_decrease/roas_opportunity fabricado', async () => {
  const sb = client({
    campaigns: { error: { message: 'timeout' } },
    sales: { rows: [] },
    appointments: { rows: [] },
  })
  const anomalies = await detectAnomalies('t1', sb)
  assert.ok(
    !anomalies.some((a) => a.type === 'roas_decrease' || a.type === 'roas_opportunity'),
    'sin datos reales de campañas no puede haber una anomalía de ROAS'
  )
})
