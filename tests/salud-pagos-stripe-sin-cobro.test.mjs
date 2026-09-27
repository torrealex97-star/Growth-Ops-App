import assert from 'node:assert/strict'
import test from 'node:test'

import { runCrossChecks } from '../lib/data-health/cross-source.ts'

// S0.4 — POR QUÉ 12 PAGOS DE STRIPE (5.095,41 €) NO TENÍAN COBRO Y NINGÚN AVISO SALTÓ.
//
// El control existente mira CLIENTES: "cliente de Stripe con contacto y sin venta". Un cliente con
// alguna venta da OK. En producción se escapaban así dos casos reales (docs/S0-5-CONSISTENCIA-DATOS.md):
//
//   1. La SEGUNDA cuota de alguien que ya tiene venta: el cliente "ya está", la cuota no.
//   2. Los pagos SIN cliente en Stripe (pago por enlace): no hay cliente que revisar.
//
// Estos tests fijan que el control nuevo mira el PAGO, que es donde está el dinero.

const vacio = {
  cuentasSeleccionadas: [],
  cuentasConCampanas: [],
  clientesStripe: [],
  contactosConVenta: [],
  ventas: [],
  contactos: [],
  campanas: [],
  agendas: [],
  llamadas: [],
  campanasFueraDeSeleccion: [],
  ultimaSyncPorFuente: {},
}

const control = (checks, id) => checks.find((c) => c.id === id)
const pago = (id, status = 'succeeded') => ({ id, refs: [id, `ch_${id}`], status })

test('la segunda cuota de un cliente con venta sale como pago sin cobro', () => {
  const checks = runCrossChecks({
    ...vacio,
    // El cliente ya tiene venta: el control viejo da OK...
    clientesStripe: [{ id: 'cus_1', contactId: 'c1' }],
    contactosConVenta: ['c1'],
    // ...pero solo la primera cuota está registrada.
    pagosStripe: [pago('pi_cuota1'), pago('pi_cuota2')],
    referenciasCobro: ['pi_cuota1'],
  })
  assert.equal(control(checks, 'pago_stripe_sin_venta').gravedad, 'ok', 'el control por cliente no lo ve')
  const c = control(checks, 'pago_stripe_sin_cobro')
  assert.equal(c.gravedad, 'critico')
  assert.deepEqual(c.ejemplos, ['pi_cuota2'])
})

test('un pago sin cliente en Stripe también cuenta', () => {
  const checks = runCrossChecks({ ...vacio, pagosStripe: [pago('pi_enlace')], referenciasCobro: [] })
  assert.equal(control(checks, 'pago_stripe_sin_cobro').afectados, 1)
})

test('un cobro registrado con la referencia del charge cuenta como registrado', () => {
  // El registro histórico usa a veces el ch_… en vez del pi_…: los dos son el mismo pago.
  const checks = runCrossChecks({ ...vacio, pagosStripe: [pago('pi_x')], referenciasCobro: ['ch_pi_x'] })
  assert.equal(control(checks, 'pago_stripe_sin_cobro').gravedad, 'ok')
})

test('ni los devueltos ni los disputados se piden como cobro pendiente', () => {
  // Devuelto entero no es ingreso; en disputa todavía no se sabe. Pedir que se registren inflaría el cash.
  const checks = runCrossChecks({
    ...vacio,
    pagosStripe: [pago('pi_dev', 'refunded'), pago('pi_disp', 'disputed')],
    referenciasCobro: [],
  })
  assert.equal(control(checks, 'pago_stripe_sin_cobro').afectados, 0)
})

test('un cobro que apunta a un pago devuelto se señala', () => {
  // El caso de S0.5 §1.2: el dinero volvió, la app lo sigue contando y la comisión no se revirtió.
  const checks = runCrossChecks({
    ...vacio,
    pagosStripe: [pago('pi_dev', 'refunded'), pago('pi_ok')],
    referenciasCobro: ['pi_dev', 'pi_ok'],
  })
  const c = control(checks, 'cobro_de_pago_devuelto')
  assert.equal(c.gravedad, 'critico')
  assert.deepEqual(c.ejemplos, ['pi_dev'])
})

test('si no se pudo leer el espejo o los cobros, se dice que no se pudo comprobar', () => {
  // Un 0 inventado aquí diría "todo cobrado" justo cuando no se sabe.
  for (const falta of [
    { pagosStripe: null, referenciasCobro: [] },
    { pagosStripe: [], referenciasCobro: null },
  ]) {
    const checks = runCrossChecks({ ...vacio, ...falta })
    assert.equal(control(checks, 'pago_stripe_sin_cobro').gravedad, 'desconocido')
    assert.equal(control(checks, 'cobro_de_pago_devuelto').gravedad, 'desconocido')
  }
})

test('el aviso dice a dónde ir en cada caso, no solo que falta', () => {
  const checks = runCrossChecks({ ...vacio, pagosStripe: [pago('pi_1')], referenciasCobro: [] })
  const { detalle } = control(checks, 'pago_stripe_sin_cobro')
  assert.match(detalle, /Registrar cobro/, 'la cuota de una venta existente se registra como cobro')
  assert.match(detalle, /Buscar pagos sin registrar/, 'la venta nueva, en el registrador')
})
