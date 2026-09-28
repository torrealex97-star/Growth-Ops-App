import assert from 'node:assert/strict'
import test from 'node:test'
import { suggestForDraft, gateForDraft } from '../lib/finance/stripeSaleDrafts.ts'

// VENTAS BORRADOR — lógica pura de sugerencia (nunca escribe sales/collections, ver
// app/api/[tenant]/evergreen/webhooks/stripe/route.ts y la migración 20260928120000_sale_drafts.sql).

test('venta activa del contacto manda sobre cualquier otra señal', () => {
  const r = suggestForDraft({
    amount: 499,
    stripePriceId: 'price_otro',
    activeSale: { id: 'sale-1', productId: 'prod-1', paymentPlanId: 'plan-1' },
    priceMap: [{ stripePriceId: 'price_otro', productId: 'prod-2', paymentPlanId: 'plan-2' }],
    plans: [],
  })
  assert.equal(r.existingSaleId, 'sale-1')
  assert.equal(r.suggestedProductId, 'prod-1')
  assert.equal(r.suggestedPaymentPlanId, 'plan-1')
})

test('sin venta previa, el Price ID mapeado manda sobre el importe', () => {
  const r = suggestForDraft({
    amount: 12345, // no coincide con ningún plan a propósito
    stripePriceId: 'price_abc',
    activeSale: null,
    priceMap: [{ stripePriceId: 'price_abc', productId: 'prod-9', paymentPlanId: 'plan-9' }],
    plans: [{ id: 'plan-x', productId: 'prod-x', grossPrice: 12345, numberOfPayments: 1 }],
  })
  assert.equal(r.existingSaleId, null)
  assert.equal(r.suggestedProductId, 'prod-9')
  assert.equal(r.suggestedPaymentPlanId, 'plan-9')
  assert.match(r.reason, /Price ID/)
})

test('sin venta previa ni mapeo, un único plan con el importe exacto se sugiere', () => {
  const r = suggestForDraft({
    amount: 499,
    stripePriceId: null,
    activeSale: null,
    priceMap: [],
    plans: [{ id: 'plan-1', productId: 'prod-1', grossPrice: 499, numberOfPayments: 1 }],
  })
  assert.equal(r.suggestedProductId, 'prod-1')
  assert.equal(r.suggestedPaymentPlanId, 'plan-1')
})

test('el importe también matchea por cuota (gross_price / numberOfPayments)', () => {
  const r = suggestForDraft({
    amount: 499,
    stripePriceId: null,
    activeSale: null,
    priceMap: [],
    plans: [{ id: 'plan-1', productId: 'prod-1', grossPrice: 1497, numberOfPayments: 3 }],
  })
  assert.equal(r.suggestedPaymentPlanId, 'plan-1')
})

test('dos planes coinciden con el mismo importe: no se sugiere nada (ambigüedad nunca se resuelve por adivinanza)', () => {
  const r = suggestForDraft({
    amount: 499,
    stripePriceId: null,
    activeSale: null,
    priceMap: [],
    plans: [
      { id: 'plan-1', productId: 'prod-1', grossPrice: 499, numberOfPayments: 1 },
      { id: 'plan-2', productId: 'prod-2', grossPrice: 499, numberOfPayments: 1 },
    ],
  })
  assert.equal(r.suggestedProductId, null)
  assert.equal(r.suggestedPaymentPlanId, null)
  assert.match(r.reason, /2 planes/)
})

test('sin ninguna señal, no se sugiere nada y el motivo lo explica', () => {
  const r = suggestForDraft({ amount: 777, stripePriceId: null, activeSale: null, priceMap: [], plans: [] })
  assert.equal(r.suggestedProductId, null)
  assert.equal(r.suggestedPaymentPlanId, null)
})

test('gateForDraft: ya registrado o ya con borrador no vuelve a crear nada', () => {
  const base = { contactId: 'c1', paymentReference: 'pi_1' }
  assert.equal(
    gateForDraft({ ...base, knownCollectionReferences: new Set(['pi_1']), existingDraftReferences: new Set() }),
    'ya_registrado'
  )
  assert.equal(
    gateForDraft({ ...base, knownCollectionReferences: new Set(), existingDraftReferences: new Set(['pi_1']) }),
    'ya_borrador'
  )
})

test('gateForDraft: sin contacto identificado no crea borrador (lo cubre el informe de backfill)', () => {
  const r = gateForDraft({
    contactId: null,
    paymentReference: 'pi_2',
    knownCollectionReferences: new Set(),
    existingDraftReferences: new Set(),
  })
  assert.equal(r, 'sin_contacto')
})

test('gateForDraft: con contacto y sin registros previos, sí crea', () => {
  const r = gateForDraft({
    contactId: 'c1',
    paymentReference: 'pi_3',
    knownCollectionReferences: new Set(),
    existingDraftReferences: new Set(),
  })
  assert.equal(r, 'crear')
})
