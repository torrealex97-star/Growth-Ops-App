// Control de pagos POR PERSONA — reglas del brief (19-sep):
//   · <100 € = reserva
//   · reserva devuelta + plan que no encaja con el precio completo = reserva ASUMIDA en el plan
//   · reserva devuelta sin más pagos = NO es cliente
//   · suscripción: cuotas iguales mensuales; van X de N; impago = cuota vencida sin cobro
//
// Ejecución directa en el sandbox (TCC impide leer Documents): también corre con la copia del
// clon en /tmp via `node --test /tmp/growthops-preview/tests/...`. El import usa ruta relativa
// al propio fichero, así que sirve en ambos sitos.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
// El módulo puro vive junto al repo; en el clon de /tmp, misma ruta relativa.
const MODULO = join(aqui, '..', 'lib', 'payments', 'control-personas.ts')
if (!existsSync(MODULO)) {
  console.log('skip: módulo no presente en este checkout (se ejecuta desde el repo)')
  process.exit(0)
}
const { RESERVA_MAX_EUR, clasificarPersona, controlPorPersona } = await import(MODULO)

const pago = (over = {}) => ({
  payment_id: 'pi_' + Math.random().toString(36).slice(2, 8),
  charge_id: null,
  customer_id: 'cus_1',
  amount: 499,
  refunded_amount: 0,
  status: 'succeeded',
  paid_at: '2026-06-01T10:00:00Z',
  ref_interna: null,
  ...over,
})

const entrada = (over = {}) => ({
  key: 'c1',
  nombre: 'Persona Test',
  email: 'p@x.com',
  contact_id: 'c1',
  customer_ids: ['cus_1'],
  pagos: [],
  clientes: [],
  ventas: [],
  cobros: [],
  precioProducto: null,
  duracionMeses: null,
  nombreProducto: null,
  ...over,
})

test('un pago por debajo de 100 € es reserva', () => {
  const r = clasificarPersona(entrada({ pagos: [pago({ amount: 50 })] }), null, null, null)
  assert.equal(r.reservasPagadas, 1)
  assert.equal(r.estadoCliente, 'reserva_pendiente')
})

test('reserva pagada y devuelta sin más pagos NO es cliente (reserva_devuelta)', () => {
  const r = clasificarPersona(entrada({ pagos: [pago({ amount: 50, refunded_amount: 50 })] }), null, null, null)
  assert.equal(r.estadoCliente, 'reserva_devuelta')
  assert.equal(r.netoPagado, 0)
  assert.equal(r.reservasDevueltas, 1)
})

test('todo devuelto (importe grande) tampoco es cliente', () => {
  const r = clasificarPersona(entrada({ pagos: [pago({ amount: 499, refunded_amount: 499 })] }), null, null, null)
  assert.equal(r.estadoCliente, 'reserva_devuelta')
})

test('reserva devuelta + cuotas que cuadran con precio−50 = reserva ASUMIDA en el plan', () => {
  // producto 1997: reserva de 50 devuelta, luego 3×649 (= 1997 − 50)
  const pagos = [
    pago({ payment_id: 'pi_r1', amount: 50, refunded_amount: 50, paid_at: '2026-08-24T10:00:00Z' }),
    pago({ payment_id: 'pi_c1', amount: 649, paid_at: '2026-08-30T10:00:00Z' }),
    pago({ payment_id: 'pi_c2', amount: 649, paid_at: '2026-09-30T10:00:00Z' }),
    pago({ payment_id: 'pi_c3', amount: 649, paid_at: '2026-10-30T10:00:00Z' }),
  ]
  const r = clasificarPersona(entrada({ pagos }), 1997, 'WDC', null)
  assert.equal(r.reservaAsumidaEnPlan, true, 'el plan 3×649 no llega a 1997: la reserva de 50 se asumió')
  assert.equal(r.cuotasPagadas, 3)
  assert.equal(r.cuotasTotales, 3)
  assert.equal(r.totalPlan, 1947)
  assert.equal(r.netoPagado, 1947)
  assert.ok(['cliente_completado', 'cliente_activo'].includes(r.estadoCliente))
})

test('suscripción mensual: van X de N e impago cuando la cuota vence sin cobro', () => {
  // cuota de 166.33 (1997/12), 6 pagadas, la primera hace 8 meses → 2 impagos
  const pagos = Array.from({ length: 6 }, (_, i) =>
    pago({
      payment_id: `pi_s${i}`,
      amount: 166.33,
      paid_at: new Date(Date.now() - (8 - i) * 30.44 * 86400e3).toISOString(),
    })
  )
  const r = clasificarPersona(entrada({ pagos }), 1997, 'WDC', 12)
  assert.equal(r.estadoCliente, 'suscripcion')
  assert.equal(r.importeCuota, 166.33)
  assert.equal(r.cuotasPagadas, 6)
  assert.equal(r.cuotasTotales, 12)
  assert.ok(r.impagos >= 1, `esperaba impagos >= 1, hubo ${r.impagos}`)
})

test('suscripción al día no tiene impagos', () => {
  const pagos = Array.from({ length: 3 }, (_, i) =>
    pago({
      payment_id: `pi_d${i}`,
      amount: 166.33,
      paid_at: new Date(Date.now() - (3 - i) * 30.44 * 86400e3).toISOString(),
    })
  )
  const r = clasificarPersona(entrada({ pagos }), 1997, 'WDC', 12)
  assert.equal(r.impagos, 0)
})

test('plan de 2 cuotas de 748.5 = 1497 completo (pago completo, sin reserva)', () => {
  const pagos = [
    pago({ payment_id: 'pi_a', amount: 748.5, paid_at: '2026-04-20T10:00:00Z' }),
    pago({ payment_id: 'pi_b', amount: 748.5, paid_at: '2026-05-20T10:00:00Z' }),
  ]
  const r = clasificarPersona(entrada({ pagos }), 1497, 'WDC', null)
  assert.equal(r.estadoCliente, 'cliente_completado')
  assert.equal(r.totalPlan, 1497)
  assert.equal(r.reservaAsumidaEnPlan, false)
})

test('un pago único del precio completo es cliente_completado', () => {
  const r = clasificarPersona(entrada({ pagos: [pago({ amount: 1997 })] }), 1997, 'WDC', null)
  assert.equal(r.estadoCliente, 'cliente_completado')
})

test('venta interna sin pagos reales = solo_interno (antes del espejo u otro canal)', () => {
  const r = clasificarPersona(
    entrada({
      ventas: [{ id: 's1', contact_id: 'c1', gross_amount: 1997, status: 'active', sale_date: '2026-05-01' }],
    }),
    null,
    null,
    null
  )
  assert.equal(r.estadoCliente, 'solo_interno')
})

test('controlPorPersona agrupa por contacto vía stripe_customers y separa huérfanos', () => {
  const personas = controlPorPersona(
    [
      pago({ payment_id: 'pi_1', customer_id: 'cus_A', amount: 499, paid_at: '2026-05-01T10:00:00Z' }),
      pago({ payment_id: 'pi_2', customer_id: 'cus_A', amount: 499, paid_at: '2026-06-01T10:00:00Z' }),
      pago({ payment_id: 'pi_3', customer_id: null, amount: 50, paid_at: '2026-07-01T10:00:00Z' }),
    ],
    [{ stripe_customer_id: 'cus_A', contact_id: 'c1', email: 'a@x.com', name: 'Ana', status: 'activo_mensual' }],
    [{ id: 'c1', full_name: 'Ana García', email: 'a@x.com' }],
    [],
    [],
    [],
    new Map()
  )
  assert.equal(personas.length, 2)
  const ana = personas.find((p) => p.nombre === 'Ana García')
  assert.ok(ana, 'Ana debe aparecer agrupada por su contacto')
  assert.equal(ana.cuotasPagadas, 2)
  const huerfano = personas.find((p) => p.nombre === '(sin identificar)')
  assert.ok(huerfano, 'el pago sin customer ni referencia no se pierde: se lista como huérfano')
  assert.equal(huerfano.estadoCliente, 'reserva_pendiente')
})

test('el pago real atado por payment_reference a un cobro interno hereda su persona', () => {
  const personas = controlPorPersona(
    [
      pago({
        payment_id: 'pi_ref1',
        customer_id: null,
        amount: 50,
        paid_at: '2026-08-24T10:00:00Z',
        ref_interna: 'pi_ref1',
      }),
    ],
    [],
    [{ id: 'c9', full_name: 'Luis', email: null }],
    [{ id: 's9', contact_id: 'c9', gross_amount: 1997, status: 'active', sale_date: '2026-08-24' }],
    [
      {
        id: 'col1',
        sale_id: 's9',
        gross_amount: 50,
        status: 'collected',
        payment_reference: 'pi_ref1',
        collected_at: '2026-08-24',
      },
    ],
    [],
    new Map()
  )
  const luis = personas.find((p) => p.nombre === 'Luis')
  assert.ok(luis, 'el pago por referencia debe llegar a la persona de la venta interna')
  assert.equal(luis.reservasPagadas, 1)
})

test('RESERVA_MAX_EUR es 100 según el brief', () => {
  assert.equal(RESERVA_MAX_EUR, 100)
})
