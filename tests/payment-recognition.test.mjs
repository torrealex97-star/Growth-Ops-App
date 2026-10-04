import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestPayment } from '../lib/sales/payment-recognition.ts'
import { readPaymentEvidence } from '../lib/stripe/payment-evidence.ts'
const base = {
  priceId: 'price_test',
  subscriptionId: null,
  recurring: false,
  firstPayment: false,
  nextPaymentDate: null,
  warning: null,
}
const mapped = { productId: 'product', paymentPlanId: 'plan' }
const plans = [{ id: 'plan', product_id: 'product', gross_price: 1200, number_of_payments: 3, method: 'cuotas' }]
const sale = {
  id: 'sale',
  product_id: 'product',
  payment_plan_id: 'plan',
  gross_amount: 1200,
  sale_date: '2026-01-01',
  collected: 400,
  method: 'cuotas',
}
const suggest = (evidence = base, sales = [], amount = 400) =>
  suggestPayment(evidence, mapped, sales, plans, amount, '2026-02-01')
test('recurring receipt prefers a compatible outstanding sale, never a new sale', () => {
  assert.equal(suggest({ ...base, recurring: true }, [sale]).mode, 'existing')
  assert.equal(suggest({ ...base, recurring: true }, []).mode, '')
})
test('multiple purchases, paid sales and later sales do not create an automatic match', () => {
  for (const sales of [
    [sale, { ...sale, id: 'other' }],
    [{ ...sale, collected: 1200 }],
    [{ ...sale, sale_date: '2026-03-01' }],
  ])
    assert.equal(suggest(base, sales).mode, '')
})
test('first subscription invoice uses the agreed number, never an amount division', () => {
  assert.equal(suggest({ ...base, firstPayment: true }).remainingCount, 2)
  assert.equal(suggest().remainingCount, null)
  assert.equal(suggest(base, [], 1200).remainingCount, 0)
  assert.equal(suggest({ ...base, firstPayment: true }, [sale]).mode, '')
})
test('a reservation continues even when Stripe creates the first subscription invoice', () => {
  const result = suggest({ ...base, firstPayment: true }, [
    { ...sale, method: 'reserva', payment_plan_id: 'deposit', gross_amount: 50, collected: 50 },
  ])
  assert.equal(result.mode, 'reservation')
  assert.equal(result.saleId, 'sale')
})
test('source failure, unmapped price and overpayment require review', () => {
  assert.equal(suggest({ ...base, warning: 'unavailable' }).mode, '')
  assert.equal(suggest(base, [], 1300).mode, '')
  assert.equal(suggestPayment(base, null, [], plans, 400, '2026-01-01').mode, '')
})

// REGRESIÓN — cobros que son SOLO una reserva: el Price ID del plan de reserva debe proponer
// 'reservation' (reserva nueva o abierta), nunca quedarse en modo vacío ni proponer venta nueva.
test('a reservation-plan receipt proposes a reservation, new or attached to an open one', () => {
  const planReserva = [
    { id: 'plan_reserva', product_id: 'product', gross_price: 50, number_of_payments: 1, method: 'reserva' },
  ]
  const mappedReserva = { productId: 'product', paymentPlanId: 'plan_reserva' }
  const r = suggestPayment(base, mappedReserva, [], planReserva, 50, '2026-10-01')
  assert.equal(r.mode, 'reservation')
  assert.equal(r.saleId, null)
  assert.equal(r.productId, 'product')
  assert.equal(r.planId, 'plan_reserva')

  const abierta = {
    id: 'res1',
    product_id: 'product',
    payment_plan_id: 'plan_reserva',
    gross_amount: 50,
    sale_date: '2026-09-01',
    collected: 0,
    method: 'reserva',
  }
  const conAbierta = suggestPayment(base, mappedReserva, [abierta], planReserva, 50, '2026-10-01')
  assert.equal(conAbierta.mode, 'reservation')
  assert.equal(conAbierta.saleId, 'res1')

  // Ventas previas de otro plan no tapan la identificación de reserva (el guard de "ya tiene
  // ventas" va DESPUÉS de la rama reserva).
  const otras = [
    {
      id: 'v1',
      product_id: 'product',
      payment_plan_id: 'otro',
      gross_amount: 1497,
      sale_date: '2026-09-01',
      collected: 0,
      method: 'cuotas',
    },
  ]
  assert.equal(suggestPayment(base, mappedReserva, otras, planReserva, 50, '2026-10-01').mode, 'reservation')
})

// REGRESIÓN — con stripe_price_map vacío la bandeja no identificaba nada. Única sugerencia
// permitida sin Price ID: un ÚNICO plan de reserva activo con importe EXACTO. Nunca se registra
// solo: la UI exige confirmar producto y plan.
test('an exact-amount match against a single active reservation plan suggests it without a mapped price', () => {
  const soloReserva = [
    { id: 'pr', product_id: 'prod', gross_price: 50, number_of_payments: 1, method: 'reserva' },
  ]
  const r = suggestPayment(base, null, [], soloReserva, 50, '2026-10-01')
  assert.equal(r.mode, 'reservation')
  assert.equal(r.productId, 'prod')
  assert.equal(r.planId, 'pr')

  const duplicado = [
    ...soloReserva,
    { id: 'pr2', product_id: 'prod2', gross_price: 50, number_of_payments: 1, method: 'reserva' },
  ]
  assert.equal(suggestPayment(base, null, [], duplicado, 50, '2026-10-01').mode, '')
  assert.equal(
    suggestPayment(
      base,
      null,
      [],
      [{ id: 'x', product_id: 'p', gross_price: 50, number_of_payments: 1, method: 'cuotas' }],
      50,
      '2026-10-01'
    ).mode,
    ''
  )
  assert.equal(suggestPayment(base, null, [sale], soloReserva, 50, '2026-10-01').mode, '')
  assert.equal(suggestPayment({ ...base, recurring: true }, null, [], soloReserva, 50, '2026-10-01').mode, '')
})
async function withStripe(t, bodies, run) {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  const paths = []
  globalThis.fetch = async (url) => {
    paths.push(String(url))
    const body = bodies.shift()
    assert.ok(body, 'unexpected Stripe request')
    return new Response(JSON.stringify(body), { status: 200 })
  }
  await run(paths)
  assert.equal(bodies.length, 0)
}
test('modern invoice links and price schema identify recurring payments', async (t) => {
  await withStripe(
    t,
    [
      {},
      { data: [{ invoice: 'in_test' }] },
      {
        id: 'in_test',
        billing_reason: 'subscription_cycle',
        lines: { data: [{ pricing: { price_details: { price: 'price_test' } } }] },
      },
    ],
    async (paths) => {
      const e = await readPaymentEvidence('pi_test', { secretKey: 'test' })
      assert.equal(e.recurring, true)
      assert.equal(e.priceId, 'price_test')
      assert.match(paths[1], /payment%5Bpayment_intent%5D=pi_test/)
    }
  )
})
test('payment links without an invoice read Checkout line items', async (t) => {
  await withStripe(
    t,
    [
      {},
      { data: [] },
      { data: [{ id: 'cs_test', payment_status: 'paid', mode: 'payment' }] },
      { data: [{ price: { id: 'price_test' } }] },
    ],
    async () => {
      const e = await readPaymentEvidence('pi_test', { secretKey: 'test' })
      assert.equal(e.priceId, 'price_test')
      assert.equal(e.firstPayment, false)
    }
  )
})
test('multiple invoice lines are not silently reduced to one product', async (t) => {
  await withStripe(
    t,
    [{ invoice: 'in_test' }, { id: 'in_test', lines: { data: [{ price: 'price_a' }, { price: 'price_b' }] } }],
    async () => {
      const e = await readPaymentEvidence('pi_test', { secretKey: 'test' })
      assert.equal(e.priceId, null)
      assert.ok(e.warning)
    }
  )
})
