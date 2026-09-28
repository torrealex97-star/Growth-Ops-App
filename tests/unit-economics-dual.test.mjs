// GRÁFICO DUAL de unit-economics — facturación vs cash por cubo, CAC solo donde hubo gasto.
//
// Fija la semántica de lib/unit-economics.ts (serieDualFacturacionCash / ejeCacVisible):
//   · Facturación = ventas ACTIVAS (active/partial_refund) del cubo de su sale_date.
//   · Clientes del cubo = contact_id ÚNICOS (mismo convenio que totals/buildChannelRows).
//   · cash del cubo lo trae quien llama (serieCanonicaCash): aquí se inyecta.
//   · CAC del cubo SOLO con gasto > 0 y clientes > 0 en ese cubo; fuera, hueco (null).
//   · El eje derecho del CAC solo aparece con densidad mínima de cubos con gasto.
// Y la fuente de app/[tenant]/unit-economics/page.tsx: el gráfico usa ComposedChart (barras € +
// línea CAC en eje derecho), comparte el estado de granularidad con Evolución y el cash por cubo
// viene de serieCanonicaCash (canonical), no de un sumar-a-ciegas.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mod = await import(`file://${join(root, 'lib/unit-economics.ts')}`)
const { serieDualFacturacionCash, ejeCacVisible } = mod
const cashMod = await import(`file://${join(root, 'lib/canonical/cash.ts')}`)
const { serieCanonicaCash } = cashMod

const venta = (over = {}) => ({
  id: 'v',
  gross_amount: 1000,
  status: 'active',
  contact_id: 'c1',
  sale_date: '2026-09-01',
  ...over,
})
const dia = (iso) => iso.slice(0, 10)

test('facturación del cubo: suma ventas activas por sale_date y cuenta clientes únicos', () => {
  const serie = serieDualFacturacionCash(
    ['2026-09-01'],
    [
      venta({ id: 'a', contact_id: 'c1' }),
      venta({ id: 'b', contact_id: 'c1', gross_amount: 500 }), // mismo cliente: 1 cliente, 1.500 €
      venta({ id: 'c', contact_id: 'c2', gross_amount: 250 }),
    ],
    new Map(),
    new Map(),
    dia
  )
  assert.equal(serie[0].facturacion, 1750)
  assert.equal(serie[0].cash, 0)
  assert.equal(serie[0].cac, null) // sin gasto no hay CAC, aunque haya clientes
})

test('devoluciones parciales (partial_refund) siguen siendo ventas activas', () => {
  const serie = serieDualFacturacionCash(
    ['2026-09-01'],
    [venta({ status: 'partial_refund', gross_amount: 900 })],
    new Map(),
    new Map(),
    dia
  )
  assert.equal(serie[0].facturacion, 900)
})

test('venta de otro cubo no contamina; cubo sin ventas → facturación 0', () => {
  const serie = serieDualFacturacionCash(
    ['2026-09-01'],
    [venta({ sale_date: '2026-08-30' })],
    new Map(),
    new Map(),
    dia
  )
  assert.equal(serie[0].facturacion, 0)
})

test('CAC del cubo = adspend / clientes únicos del cubo, SOLO si hubo gasto', () => {
  const serie = serieDualFacturacionCash(
    ['2026-09-01', '2026-09-02'],
    [venta({ contact_id: 'c1' }), venta({ id: 'b', contact_id: 'c2', sale_date: '2026-09-01' })],
    new Map(),
    new Map([['2026-09-01', 300]]),
    dia
  )
  assert.equal(serie[0].cac, 150) // 300 € / 2 clientes
  assert.equal(serie[1].cac, null) // cubo sin gasto: hueco, no 0
})

test('cubo con gasto pero sin clientes de cierre: CAC hueco (división imposible, no cero)', () => {
  const serie = serieDualFacturacionCash(['2026-09-01'], [], new Map(), new Map([['2026-09-01', 300]]), dia)
  assert.equal(serie[0].cac, null)
})

test('ejeCacVisible: densidad mínima 1/3; con gasto esparcido el eje se apaga', () => {
  const cubos = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
  // Ventas en los tres días con gasto: el CAC exige gasto Y clientes en el cubo; la densidad se
  // mide sobre cubos con CAC trazable, no solo con gasto.
  const ventas3 = [
    venta({ id: 'a', sale_date: '2026-09-01' }),
    venta({ id: 'b', sale_date: '2026-09-02' }),
    venta({ id: 'c', sale_date: '2026-09-03' }),
  ]
  const serie = serieDualFacturacionCash(
    cubos,
    ventas3,
    new Map(),
    new Map([
      ['2026-09-01', 100],
      ['2026-09-02', 100],
      ['2026-09-03', 100],
    ]),
    dia
  )
  assert.equal(ejeCacVisible(serie), false) // 3/30 < 1/3
  const serie2 = serieDualFacturacionCash(
    cubos.slice(0, 6),
    ventas3,
    new Map(),
    new Map([
      ['2026-09-01', 100],
      ['2026-09-02', 100],
    ]),
    dia
  )
  assert.equal(ejeCacVisible(serie2), true) // 2/6 >= 1/3
  assert.equal(ejeCacVisible([]), false)
})

test('serieCanonicaCash: día, semana (dominio UTC) y mes, con las reglas del canónico', () => {
  const stripe = [
    {
      payment_id: 'pi_1',
      charge_id: null,
      amount: 500,
      refunded_amount: 0,
      status: 'succeeded',
      paid_at: '2026-09-03T10:00:00Z',
      customer_email: null,
    },
    {
      payment_id: 'pi_2',
      charge_id: 'ch_9',
      amount: 300,
      refunded_amount: 100,
      status: 'succeeded',
      paid_at: '2026-09-05T10:00:00Z',
      customer_email: null,
    },
  ]
  const collections = [
    {
      id: 'i1',
      payment_reference: 'pi_1',
      gross_amount: 500,
      status: 'collected',
      collected_at: '2026-09-06T10:00:00Z',
    }, // duplicado: fuera
    { id: 'i2', payment_reference: null, gross_amount: 200, status: 'collected', collected_at: '2026-09-07T10:00:00Z' }, // interno vivo
  ]
  const refunds = [
    { collection_id: 'i2', refund_date: '2026-09-08T10:00:00Z', gross_refund_amount: 50, status: 'processed' },
  ]

  const serieDia = serieCanonicaCash(stripe, collections, refunds, 'dia')
  assert.deepEqual(serieDia, [
    { cubo: '2026-09-03', neto: 500 },
    { cubo: '2026-09-05', neto: 200 },
    { cubo: '2026-09-07', neto: 200 },
    { cubo: '2026-09-08', neto: -50 },
  ])

  const semana = serieCanonicaCash(stripe, collections, refunds, 'semana')
  // 3–5 sep (jue–sáb) caen en la semana del domingo 30-ago; 7–8 sep (lun–mar) en la del 6-sep.
  assert.deepEqual(semana, [
    { cubo: '2026-08-30', neto: 700 },
    { cubo: '2026-09-06', neto: 150 },
  ])

  const mes = serieCanonicaCash(stripe, collections, refunds, 'mes')
  assert.deepEqual(mes, [{ cubo: '2026-09', neto: 850 }]) // 500+300-100+200-50; neto == cash.net canónico
})

test('PAGE (fuente): el dual usa ComposedChart, comparte granularidad y trae el cash canónico por cubo', () => {
  const src = readFileSync(join(root, 'app/[tenant]/unit-economics/page.tsx'), 'utf8')
  assert.ok(src.includes('serieDualFacturacionCash'), 'la página consume el helper canónico')
  assert.ok(src.includes('serieCanonicaCash'), 'cash por cubo del canónico, no suma a ciegas')
  assert.ok(src.includes('<FinanceDual'), 'gráfico dual renderizado')
  const chart = readFileSync(join(root, 'components/finanzas/FinanceCharts.tsx'), 'utf8')
  assert.ok(chart.includes('export function FinanceDual'), 'FinanceDual exportado')
  assert.ok(chart.includes('<ComposedChart') && chart.includes('yAxisId'), 'barras € + CAC en eje derecho')
  assert.ok(chart.includes('dataKey="cac"'), 'línea del CAC')
  // Nunca solo color: leyenda con las tres series.
  assert.ok(chart.includes('<Legend'), 'leyenda declarada')
})
