import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { financialTrend, periodKpis } from '../../lib/analytics.ts'

const sales = [
  {
    id: 'old',
    gross_amount: 900,
    status: 'active',
    sale_date: '2026-07-20',
    closer_id: null,
    setter_id: null,
    contact_id: null,
  },
  {
    id: 'current',
    gross_amount: 1200,
    status: 'active',
    sale_date: '2026-08-05',
    closer_id: null,
    setter_id: null,
    contact_id: null,
  },
]
const collections = [
  { sale_id: 'old', gross_amount: 300, collected_at: '2026-08-06', status: 'collected' },
  { sale_id: 'current', gross_amount: 400, collected_at: '2026-08-07', status: 'collected' },
]
const range = { from: new Date(2026, 7, 1, 0, 0, 0, 0), to: new Date(2026, 7, 31, 23, 59, 59, 999) }

test('los KPIs del periodo separan booked y collected por la fecha de cada hecho', () => {
  const kpis = periodKpis([sales[1]], collections)
  assert.equal(kpis.gross, 1200)
  assert.equal(kpis.cash, 700, 'el cobro de una venta anterior también entra cuando se cobra en el periodo')
  assert.equal(kpis.avgCash, 350)
})

test('el ticket medio agrupa varias ventas del mismo cliente', () => {
  const kpis = periodKpis(
    [
      { ...sales[1], id: 'sale-a', contact_id: 'contact-1', gross_amount: 1200 },
      { ...sales[1], id: 'sale-b', contact_id: 'contact-1', gross_amount: 800 },
      { ...sales[1], id: 'sale-c', contact_id: 'contact-2', gross_amount: 1000 },
    ],
    []
  )
  assert.equal(kpis.avgTicket, 1500)
})

test('la tendencia usa exactamente el rango activo y conserva días sin movimientos', () => {
  const result = financialTrend(sales, collections, range)
  assert.equal(result.granularity, 'día')
  assert.equal(result.points.length, 31)
  assert.equal(
    result.points.reduce((sum, point) => sum + point.amount, 0),
    1200
  )
  assert.equal(
    result.points.reduce((sum, point) => sum + point.cash, 0),
    700
  )
})

test('Analítica reutiliza las series financieras del brief, sin una consulta o fórmula paralela', () => {
  const route = readFileSync(
    new URL('../../app/api/[tenant]/evergreen/metricas/brief/route.ts', import.meta.url),
    'utf8'
  )
  const panel = readFileSync(new URL('../../components/metrics/PanelGrowth.tsx', import.meta.url), 'utf8')
  assert.match(route, /serieFacturacion: consulta\.serieFacturacion/)
  assert.match(route, /serieCash: consulta\.serieCash/)
  assert.match(panel, /<SalesChart/)
  assert.match(panel, /acumulado del periodo/)
})

test('serie con fuente consolidada no vuelve a sumar los cobros internos', () => {
  const range = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') }
  const result = financialTrend(
    [],
    [{ sale_id: 's', gross_amount: 100, collected_at: '2026-08-05', status: 'collected' }],
    range,
    new Map([
      ['2026-08-05', 150],
      ['2026-08-06', 25],
    ])
  )
  assert.equal(
    result.points.reduce((sum, p) => sum + p.cash, 0),
    175
  )
})
