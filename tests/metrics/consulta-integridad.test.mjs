import test from 'node:test'
import assert from 'node:assert/strict'
import { consultarMetricas } from '../../lib/metrics/consulta.ts'

const periodo = { desde: '2026-01-01', hasta: '2026-01-31' }
function cliente(tablas, falla = '') {
  const consultas = []
  return {
    consultas,
    from(tabla) {
      const filtros = []
      consultas.push({ tabla, filtros })
      const q = {
        select() {
          return q
        },
        eq(k, v) {
          filtros.push([k, v])
          return q
        },
        gte() {
          return q
        },
        lte() {
          return q
        },
        or() {
          return q
        },
        in() {
          return q
        },
        order() {
          return q
        },
        range(a, b) {
          return Promise.resolve({
            data: (tablas[tabla] ?? []).slice(a, b + 1),
            error: tabla === falla ? { message: 'No disponible' } : null,
          })
        },
        then(resolve) {
          return Promise.resolve({ count: (tablas[tabla] ?? []).length, error: null }).then(resolve)
        },
      }
      return q
    },
  }
}
const tablas = {
  sales: [
    {
      contact_id: 'cliente-demo',
      sale_date: '2026-01-02',
      gross_amount: 1000,
      status: 'active',
      payment_plans: { method: 'completo' },
    },
  ],
  collections: [
    {
      id: 'interno-1',
      payment_reference: 'pago-demo',
      gross_amount: 100,
      status: 'collected',
      collected_at: '2026-01-03',
    },
    { id: 'interno-2', payment_reference: null, gross_amount: 50, status: 'collected', collected_at: '2026-01-04' },
  ],
  stripe_payments: [
    {
      payment_id: 'pago-demo',
      charge_id: null,
      amount: 100,
      refunded_amount: 0,
      status: 'succeeded',
      paid_at: '2026-01-03',
      customer_email: null,
    },
  ],
  campaign_daily: [{ date: '2026-01-03', spend: 20, impressions: 1000, clicks: 10, leads: 1 }],
}
test('brief usa cash canónico, deduplica y mantiene serie/tarjeta iguales sin inventar ROAS', async () => {
  const sb = cliente(tablas)
  const r = await consultarMetricas(sb, 'tenant-demo', periodo)
  assert.equal(r.agregados.cash_collected.valor, 150)
  assert.equal(r.serieCash.at(-1).valor, 150)
  assert.equal(r.agregados.cash_roas.valor, null)
  assert.equal(r.agregados.contracted_revenue.valor, 1000)
  for (const q of sb.consultas) assert.ok(q.filtros.some(([k, v]) => k === 'tenant_id' && v === 'tenant-demo'))
})
test('fallo de primaria no presenta el fallback como cash completo ni genera previsión', async () => {
  const r = await consultarMetricas(cliente(tablas, 'stripe_payments'), 'tenant-demo', periodo)
  assert.equal(r.agregados.cash_collected.valor, null)
  assert.equal(r.agregados.cash_collection_ratio.valor, null)
  assert.deepEqual(r.serieCash, [])
  assert.equal(r.agregados.ventas.valor, 1)
})
test('lectura fallida de ventas invalida ratios y serie aunque traiga filas parciales', async () => {
  const r = await consultarMetricas(cliente(tablas, 'sales'), 'tenant-demo', periodo)
  assert.equal(r.agregados.ventas.valor, null)
  assert.equal(r.agregados.cac.valor, null)
  assert.deepEqual(r.serieFacturacion, [])
  assert.equal(r.agregados.cash_collected.valor, 150)
})

import { diagnosticarCuelloBotella } from '../../lib/metrics/cuello-botella.ts'
test('una métrica medida sin objetivo no se declara sin medir', () => {
  const r = diagnosticarCuelloBotella([
    {
      key: 'cash_collected',
      nombre: 'Cash Collected',
      nivel: 'caja',
      valor: 150,
      objetivo: null,
      higherIsBetter: true,
      muestra: 10,
      investigar: [],
    },
  ])
  assert.deepEqual(r.sinDatos, [])
  assert.equal(r.primaria, null)
})

import { funnelBySource } from '../../lib/analytics.ts'
test('un origen de importación no cuenta como canal, pero conserva una UTM conocida', () => {
  const rows = funnelBySource(
    ['a', 'b'],
    [
      { contact_id: 'a', source: 'ghl_import', utm_source: null, is_primary: true },
      { contact_id: 'b', source: 'ghl', utm_source: 'meta', is_primary: true },
    ],
    [],
    []
  )
  assert.equal(rows.find((r) => r.source === 'Directo / Sin atribuir').leads, 1)
  assert.equal(rows.find((r) => r.source === 'meta').leads, 1)
})
