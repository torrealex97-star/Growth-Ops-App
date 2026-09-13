import assert from 'node:assert/strict'
import test from 'node:test'
import {
  REFUND_WINDOW_DAYS,
  addDaysIso,
  buildCollection,
  buildSaleFromPayment,
} from '../../lib/finance/stripeImport.ts'

const choice = {
  productId: 'prod-1',
  paymentPlanId: 'plan-1',
  cashCollectionRatio: 0.9,
  paymentMethod: 'stripe',
  tenantId: 'tenant-1',
  userId: 'user-1',
}

const pago = (over = {}) => ({
  paymentId: 'pi_123',
  createdAt: '2026-03-10T08:30:00.000Z',
  amount: 1200,
  currency: 'EUR',
  email: 'cliente@example.com',
  verdict: 'registrable',
  reason: '',
  contactId: 'contact-1',
  ...over,
})

// La fecha de venta es la del PAGO. Registrar un cobro de marzo como venta de hoy movería la
// facturación de mes y descuadraría el P&L y las comisiones de ese periodo.
test('la venta se fecha el día del pago, no el de la importación', () => {
  const r = buildSaleFromPayment(pago(), choice)
  assert.ok('sale' in r)
  assert.equal(r.sale.sale_date, '2026-03-10')
  assert.equal(r.sale.refund_deadline_at, addDaysIso('2026-03-10', REFUND_WINDOW_DAYS))
})

test('el importe comisionable sale del ratio del plan elegido', () => {
  const r = buildSaleFromPayment(pago({ amount: 1000 }), choice)
  assert.ok('sale' in r)
  assert.equal(r.sale.gross_amount, 1000)
  assert.equal(r.sale.expected_commissionable_amount, 900)
  // Y no arrastra decimales de coma flotante a una tabla de dinero.
  const raro = buildSaleFromPayment(pago({ amount: 33.33 }), { ...choice, cashCollectionRatio: 0.3 })
  assert.ok('sale' in raro)
  assert.equal(raro.sale.expected_commissionable_amount, 10)
})

// Sin la referencia del pago en el cobro, el informe volvería a proponer el mismo pago y se
// registraría dos veces: dos ventas, dos comisiones, facturación duplicada.
test('el cobro lleva la referencia de Stripe, que es lo que impide duplicar', () => {
  const c = buildCollection(pago(), 'sale-9', choice)
  assert.equal(c.payment_reference, 'pi_123')
  assert.equal(c.payment_provider, 'stripe')
  assert.equal(c.sale_id, 'sale-9')
  assert.equal(c.tenant_id, 'tenant-1')
  // El cobro se fecha cuando entró el dinero, no cuando se importó.
  assert.equal(c.collected_at, '2026-03-10T08:30:00.000Z')
})

// Última red antes de escribir: lo que no sea registrable no se convierte en venta ni por error de
// la pantalla ni por un id manipulado en la petición.
test('nada que no sea registrable se convierte en venta', () => {
  for (const verdict of ['ya_registrado', 'sin_contacto', 'no_es_venta', 'reembolsado']) {
    const r = buildSaleFromPayment(pago({ verdict }), choice)
    assert.ok('error' in r, `${verdict} no debería poder registrarse`)
  }
  assert.ok('error' in buildSaleFromPayment(pago({ contactId: null }), choice))
  assert.ok('error' in buildSaleFromPayment(pago({ amount: 0 }), choice))
})

test('el producto y el plan NO se adivinan: vienen elegidos', () => {
  const r = buildSaleFromPayment(pago(), choice)
  assert.ok('sale' in r)
  assert.equal(r.sale.product_id, 'prod-1')
  assert.equal(r.sale.payment_plan_id, 'plan-1')
  assert.equal(r.sale.status, 'active')
  assert.match(r.sale.notes, /pi_123/, 'la venta debe decir de dónde salió')
})
