import assert from 'node:assert/strict'
import test from 'node:test'
import {
  REFUND_WINDOW_DAYS,
  addDaysIso,
  buildCollection,
  buildSaleFromPayment,
  buildSaleFromPayments,
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

// ---------------------------------------------------------------------------
// UNA VENTA POR CLIENTE, NO POR PAGO.
//
// El importador escribía una venta por cada pago. En la base real eso dejó 48 ventas para 27
// clientas: una que pagó 1497€ en tres plazos de 499€ figuraba como tres ventas de 499€. El número
// de ventas quedó inflado un 78% y el ticket medio hundido de ~1497€ a 458€, arrastrando el CAC, el
// LTV, la tasa de cierre por llamada y las comisiones.
// ---------------------------------------------------------------------------

test('los plazos de un mismo cliente son UNA venta con la suma, no una venta por plazo', () => {
  const plazos = [
    pago({ paymentId: 'pi_1', createdAt: '2026-05-11T10:00:00.000Z', amount: 499 }),
    pago({ paymentId: 'pi_2', createdAt: '2026-06-11T10:00:00.000Z', amount: 499 }),
    pago({ paymentId: 'pi_3', createdAt: '2026-07-11T10:00:00.000Z', amount: 499 }),
  ]
  const r = buildSaleFromPayments(plazos, choice)
  assert.ok('sale' in r)
  assert.equal(r.sale.gross_amount, 1497)
  assert.equal(r.references.length, 3)
})

// La venta se cierra cuando entra el PRIMER pago. Fecharla con el último la movería de mes cada vez
// que entra un plazo, y con ella la facturación del periodo.
test('la venta agrupada se fecha el día del primer pago', () => {
  const r = buildSaleFromPayments(
    [
      pago({ paymentId: 'pi_b', createdAt: '2026-07-11T10:00:00.000Z', amount: 499 }),
      pago({ paymentId: 'pi_a', createdAt: '2026-05-11T10:00:00.000Z', amount: 499 }),
    ],
    choice
  )
  assert.ok('sale' in r)
  assert.equal(r.sale.sale_date, '2026-05-11')
  assert.equal(r.sale.refund_deadline_at, addDaysIso('2026-05-11', REFUND_WINDOW_DAYS))
})

test('el comisionable de la venta agrupada sale del total, no de un plazo suelto', () => {
  const r = buildSaleFromPayments(
    [
      pago({ paymentId: 'pi_1', amount: 500, createdAt: '2026-05-01T00:00:00.000Z' }),
      pago({ paymentId: 'pi_2', amount: 500, createdAt: '2026-06-01T00:00:00.000Z' }),
    ],
    choice
  )
  assert.ok('sale' in r)
  assert.equal(r.sale.gross_amount, 1000)
  assert.equal(r.sale.expected_commissionable_amount, 900)
})

// Sumar céntimos en coma flotante arrastra error, y esto es dinero.
test('la suma de plazos no arrastra decimales de coma flotante', () => {
  const r = buildSaleFromPayments(
    Array.from({ length: 6 }, (_, i) =>
      pago({ paymentId: `pi_${i}`, amount: 166.33, createdAt: `2026-0${i + 1}-10T00:00:00.000Z` })
    ),
    choice
  )
  assert.ok('sale' in r)
  assert.equal(r.sale.gross_amount, 997.98)
})

// Un pago que ya no es registrable no puede colarse dentro de un grupo: la venta entera se rechaza
// en vez de escribirse con un importe que incluye dinero devuelto.
test('un solo pago no registrable tumba el grupo entero', () => {
  const r = buildSaleFromPayments(
    [pago({ paymentId: 'pi_1' }), pago({ paymentId: 'pi_2', verdict: 'reembolsado' })],
    choice
  )
  assert.ok('error' in r)
  assert.match(r.error, /pi_2/)
})

test('no se agrupan pagos de contactos distintos', () => {
  const r = buildSaleFromPayments(
    [pago({ paymentId: 'pi_1' }), pago({ paymentId: 'pi_2', contactId: 'contact-2' })],
    choice
  )
  assert.ok('error' in r)
})

// Un único pago sigue dando una única venta con el mismo importe de siempre: agrupar no cambia el
// caso de pago único (full pay), que es la mayoría.
test('un pago suelto sigue dando la misma venta que antes', () => {
  const uno = buildSaleFromPayment(pago({ amount: 1997 }), choice)
  const grupo = buildSaleFromPayments([pago({ amount: 1997 })], choice)
  assert.ok('sale' in uno && 'sale' in grupo)
  assert.equal(grupo.sale.gross_amount, uno.sale.gross_amount)
  assert.equal(grupo.sale.sale_date, uno.sale.sale_date)
  // La nota del camino agrupado añade lo cobrado hasta la fecha, que el camino de un solo pago no
  // tenía. Lo que tiene que coincidir es la referencia del pago: es lo que ata la venta a Stripe.
  assert.match(grupo.sale.notes, /pi_123/)
  assert.match(uno.sale.notes, /pi_123/)
})

// ---------------------------------------------------------------------------
// FACTURACIÓN NO ES CASH COLLECTED.
//
// `sales.gross_amount` es el PRECIO PACTADO (revenue = SUM(sales.gross_amount)) y el dinero que ha
// entrado vive en `collections` (cash_collected). Una clienta a mitad de un plan de 10 plazos ya
// compró el producto entero: su venta vale 1997€, aunque en la cuenta haya 399,40€. Sumar los pagos
// para el importe de la venta mezclaba las dos métricas y hundía la facturación a la mitad.
// ---------------------------------------------------------------------------

const conPrecio = (precio) => ({ ...choice, planGrossPrice: precio, cashCollectionRatio: 1 })

test('la venta vale el precio pactado del plan, no lo cobrado hasta hoy', () => {
  const r = buildSaleFromPayments(
    [
      pago({ paymentId: 'pi_1', amount: 199.7, createdAt: '2026-08-13T00:00:00.000Z' }),
      pago({ paymentId: 'pi_2', amount: 199.7, createdAt: '2026-09-13T00:00:00.000Z' }),
    ],
    conPrecio(1997)
  )
  assert.ok('sale' in r)
  assert.equal(r.sale.gross_amount, 1997)
  assert.equal(r.sale.expected_commissionable_amount, 1997)
})

// El plan completo y el plan a medias valen lo MISMO: es el mismo producto comprado.
test('una venta a medio plan factura igual que una pagada entera', () => {
  const medias = buildSaleFromPayments([pago({ paymentId: 'pi_1', amount: 499 })], conPrecio(1497))
  const entera = buildSaleFromPayments(
    [
      pago({ paymentId: 'pi_1', amount: 499, createdAt: '2026-05-01T00:00:00.000Z' }),
      pago({ paymentId: 'pi_2', amount: 499, createdAt: '2026-06-01T00:00:00.000Z' }),
      pago({ paymentId: 'pi_3', amount: 499, createdAt: '2026-07-01T00:00:00.000Z' }),
    ],
    conPrecio(1497)
  )
  assert.ok('sale' in medias && 'sale' in entera)
  assert.equal(medias.sale.gross_amount, entera.sale.gross_amount)
  assert.equal(medias.sale.gross_amount, 1497)
})

// Lo cobrado no se pierde: queda anotado en la venta y, sobre todo, en sus cobros.
test('lo cobrado hasta la fecha queda anotado en la venta', () => {
  const r = buildSaleFromPayments([pago({ paymentId: 'pi_1', amount: 499 })], conPrecio(1497))
  assert.ok('sale' in r)
  assert.match(r.sale.notes, /Cobrado hasta la fecha: 499/)
})

// Un plan personalizado no declara precio. Ahí lo cobrado es lo único que se sabe, y es mejor que
// escribir un cero: una venta a 0€ desaparece de la facturación como si no existiera.
test('sin precio en el plan se cae a lo cobrado, no a cero', () => {
  for (const sinPrecio of [null, 0]) {
    const r = buildSaleFromPayments(
      [
        pago({ paymentId: 'pi_1', amount: 300, createdAt: '2026-05-01T00:00:00.000Z' }),
        pago({ paymentId: 'pi_2', amount: 200, createdAt: '2026-06-01T00:00:00.000Z' }),
      ],
      { ...choice, planGrossPrice: sinPrecio, cashCollectionRatio: 1 }
    )
    assert.ok('sale' in r)
    assert.equal(r.sale.gross_amount, 500)
  }
})

// El cobro SIEMPRE lleva el importe real del pago. Es la otra mitad de la distinción: si el cobro
// arrastrara el precio pactado, el cash collected diría que entró dinero que no entró.
test('el cobro lleva el importe real del pago, nunca el precio del plan', () => {
  const c = buildCollection(pago({ amount: 199.7 }), 'sale-1', conPrecio(1997))
  assert.equal(c.gross_amount, 199.7)
  assert.equal(c.commissionable_amount, 199.7)
})
