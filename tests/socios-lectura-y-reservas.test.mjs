import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { computeMonthlyPnl } from '../lib/finance/pnl.ts'

// AUDITORÍA F13 (+ F03 en el mismo camino) — REPARTO DE SOCIOS.
//
// La ruta repartía beneficio entre socios con `data ?? []` sin mirar el error de las lecturas, y
// además alimentaba el P&L con ventas sin los datos de reserva. Dos fallos que no rompen nada a la
// vista: publican una cifra de reparto equivocada que parece correcta.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const ruta = readFileSync(join(root, 'app/api/[tenant]/evergreen/finanzas/socios/route.ts'), 'utf8')

const cobro = { id: 'c1', gross_amount: 1000, processing_fee: 0, collected_at: '2026-09-10', status: 'collected' }
const venta = (extra) => ({ gross_amount: 2000, discount: 0, status: 'active', sale_date: '2026-09-05', ...extra })
const vacio = { collections: [cobro], refunds: [], expenses: [], commissions: [] }

test('el descuento de una reserva abierta no rebaja el beneficio repartible', () => {
  // Sin los datos de reserva, esa venta entraba en `totalDiscounts` y restaba al neto del mes.
  const abierta = venta({ discount: 300, payment_plan_method: 'reserva', reservation_completed_at: null })
  const conReserva = computeMonthlyPnl('2026-09', { ...vacio, sales: [abierta] })
  const sinVentas = computeMonthlyPnl('2026-09', { ...vacio, sales: [] })
  assert.equal(conReserva.preTaxProfit, sinVentas.preTaxProfit)
  assert.equal(conReserva.preTaxProfit, 1000)
})

test('una venta normal con descuento sí lo rebaja: el arreglo no apaga el descuento', () => {
  const normal = venta({ discount: 300, payment_plan_method: 'completo' })
  assert.equal(computeMonthlyPnl('2026-09', { ...vacio, sales: [normal] }).preTaxProfit, 700)
})

test('la ruta pide los datos de reserva y los aplana', () => {
  assert.match(ruta, /reservation_completed_at, payment_plans\(method\)/)
  assert.match(ruta, /payment_plan_method: metodoDePlan\(v\)/)
})

test('una lectura fallida detiene el reparto: no se reparte con lo que haya llegado', () => {
  // Antes: `salesRes.data ?? []`, `expensesRes.data ?? []`… sin mirar `.error`. Sin gastos, el
  // beneficio sale inflado y cada socio ve una cifra falsa que parece buena.
  for (const res of ['salesRes', 'collRes', 'refundsRes', 'expensesRes', 'commissionsRes', 'partnersRes']) {
    assert.match(ruta, new RegExp(`\\[${res}\\.error, '`), `${res} no se comprueba`)
  }
  const guardia = ruta.indexOf('fuentesEnError.length > 0')
  const calculo = ruta.indexOf('computeMonthlyPnl(ym')
  assert.ok(guardia > 0 && calculo > 0 && guardia < calculo, 'la comprobación tiene que ir ANTES de calcular')
  assert.match(ruta, /status: 503/)
  assert.match(ruta, /El reparto NO se calcula porque estaría incompleto/)
})

test('un fallo de lectura no se disfraza de "no hay socios"', () => {
  // La página ya muestra `d.error` cuando la respuesta no es ok; lo que no puede pasar es un 200
  // con un reparto vacío por haber fallado la lectura de `partners`.
  assert.match(ruta, /\[partnersRes\.error, 'socios'\]/)
})
