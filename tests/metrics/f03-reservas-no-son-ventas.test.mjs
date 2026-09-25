import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { cuentaComoVenta, isActiveSale, monthlyKpis } from '../../lib/analytics.ts'
import { metodoDePlan } from '../../lib/metrics/agregados.ts'

// F03 — LA MISMA RESERVA CONTABA 0 VENTAS EN UN SITIO Y 1 EN OTRO.
//
// `lib/metrics/agregados.ts` excluía las reservas abiertas (MONEY D8) y el motor de comisiones
// también. `lib/analytics.ts` —que alimenta el Dashboard, el ranking, el P&L, los objetivos y la
// IA— solo miraba el estado de la venta. Resultado: una seña de 50 € aparecía como una venta
// completa, con el importe del programa entero, en la mitad de las pantallas.

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

const venta = (extra = {}) => ({
  id: 's1',
  gross_amount: 2000,
  status: 'active',
  sale_date: '2026-09-10',
  closer_id: null,
  setter_id: null,
  contact_id: 'c1',
  ...extra,
})

test('una reserva abierta no es una venta', () => {
  const reserva = venta({ payment_plan_method: 'reserva', reservation_completed_at: null })
  assert.equal(isActiveSale(reserva), true, 'su estado sí es activo: por eso colaba')
  assert.equal(cuentaComoVenta(reserva), false)
})

test('la misma reserva, completada, sí es una venta', () => {
  const completada = venta({ payment_plan_method: 'reserva', reservation_completed_at: '2026-09-20' })
  assert.equal(cuentaComoVenta(completada), true)
})

test('una venta normal no se ve afectada, y una anulada sigue fuera', () => {
  assert.equal(cuentaComoVenta(venta({ payment_plan_method: 'completo' })), true)
  assert.equal(cuentaComoVenta(venta({ status: 'cancelled' })), false)
  assert.equal(cuentaComoVenta(venta({ status: 'chargeback' })), false)
})

test('los KPIs del mes dejan de contar la seña como facturación', () => {
  // El caso que la auditoría reprodujo: una reserva activa de 50 € daba 0 ventas en agregados y
  // 1 venta con su importe en monthlyKpis.
  const ventas = [
    venta({ id: 'a', gross_amount: 2000, payment_plan_method: 'completo' }),
    venta({ id: 'b', gross_amount: 50, payment_plan_method: 'reserva', reservation_completed_at: null }),
  ]
  const kpis = monthlyKpis(ventas, [], '2026-09')
  assert.equal(kpis.count, 1)
  assert.equal(kpis.gross, 2000)
  assert.equal(kpis.avgTicket, 2000, 'el ticket medio no puede hundirse con señas')
})

test('el embed de PostgREST se aplana igual venga como objeto o como array', () => {
  // Es la forma en que llega `payment_plans(method)` según el driver. Resolverlo a mano en cada
  // pantalla era la vía para volver a equivocarse en una de ellas.
  assert.equal(metodoDePlan({ payment_plans: { method: 'reserva' } }), 'reserva')
  assert.equal(metodoDePlan({ payment_plans: [{ method: 'reserva' }] }), 'reserva')
  assert.equal(metodoDePlan({ payment_plans: null }), null)
  assert.equal(metodoDePlan({}), null)
})

test('el predicado de reserva no se reescribe: se importa el canónico', () => {
  const analytics = read('../../lib/analytics.ts')
  assert.match(analytics, /import \{ esReservaAbierta \} from '@\/lib\/metrics\/agregados'/)
  // Dos definiciones de lo mismo es exactamente cómo nació esta discrepancia.
  assert.ok(!/payment_plan_method === 'reserva'/.test(analytics))
})

// ── SIN LOS DATOS, EL ARREGLO NO EXISTE ──────────────────────────────────────────────────────

test('toda pantalla que cuenta ventas pide las columnas de reserva', () => {
  // `cuentaComoVenta` con la fila incompleta devuelve lo mismo que antes y el fallo vuelve en
  // silencio. Por eso se comprueba consulta a consulta.
  const pantallas = [
    '../../app/[tenant]/dashboard/page.tsx',
    '../../app/[tenant]/finanzas/analitica/resumen/page.tsx',
    '../../app/[tenant]/finanzas/analitica/cohortes/page.tsx',
    '../../app/[tenant]/finanzas/analitica/pnl/page.tsx',
  ]
  for (const p of pantallas) {
    const src = read(p)
    const select = src.slice(src.indexOf("from('sales')"), src.indexOf("from('sales')") + 400)
    assert.match(select, /reservation_completed_at/, `${p}: falta reservation_completed_at`)
    assert.match(select, /payment_plans\(method\)/, `${p}: falta payment_plans(method)`)
    assert.match(src, /payment_plan_method: metodoDePlan\(v\)/, `${p}: no aplana el embed`)
  }
})

test('la IA cuenta las ventas igual que la pantalla', () => {
  // La brecha semántica de F10: los mismos nombres devolviendo conceptos distintos según quién
  // pregunte. Aquí se cierra para "ventas".
  const tools = read('../../lib/ai/agent/tools.ts')
  assert.ok(!/isActiveSale/.test(tools), 'la IA no puede usar un criterio de venta propio')
  assert.equal((tools.match(/reservation_completed_at/g) ?? []).length >= 3, true)
})
