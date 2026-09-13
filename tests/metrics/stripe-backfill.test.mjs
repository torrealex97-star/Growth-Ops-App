import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyForBackfill, summarizeBackfill } from '../../lib/finance/stripeBackfill.ts'

const ctx = (over = {}) => ({
  knownReferences: new Set(),
  contactsByEmail: new Map([['cliente@example.com', 'contact-1']]),
  ...over,
})

const intent = (over = {}) => ({
  id: 'pi_1',
  amount_received: 99700,
  currency: 'eur',
  created: 1789000000,
  status: 'succeeded',
  receipt_email: 'cliente@example.com',
  latest_charge: { id: 'ch_1', amount_refunded: 0, refunded: false },
  ...over,
})

// LA REGLA ACORDADA: sin pago exitoso no hay venta.
test('un pago que no se completó no es una venta', () => {
  for (const status of ['requires_payment_method', 'processing', 'canceled', 'requires_action']) {
    const r = classifyForBackfill(intent({ status }), ctx())
    assert.equal(r.verdict, 'no_es_venta', status)
    assert.match(r.reason, new RegExp(status))
  }
})

test('un pago devuelto por completo no es ingreso', () => {
  const porFlag = classifyForBackfill(
    intent({ latest_charge: { id: 'ch_1', refunded: true, amount_refunded: 99700 } }),
    ctx()
  )
  assert.equal(porFlag.verdict, 'reembolsado')
  // También si el importe devuelto iguala el cobrado, aunque el flag no venga.
  const porImporte = classifyForBackfill(
    intent({ latest_charge: { id: 'ch_1', refunded: false, amount_refunded: 99700 } }),
    ctx()
  )
  assert.equal(porImporte.verdict, 'reembolsado')
})

test('un reembolso PARCIAL sigue siendo registrable: hay dinero que se quedó', () => {
  const r = classifyForBackfill(
    intent({ latest_charge: { id: 'ch_1', refunded: false, amount_refunded: 10000 } }),
    ctx()
  )
  assert.equal(r.verdict, 'registrable')
})

test('lo ya registrado se detecta por el id del intento o del cargo', () => {
  assert.equal(classifyForBackfill(intent(), ctx({ knownReferences: new Set(['pi_1']) })).verdict, 'ya_registrado')
  assert.equal(classifyForBackfill(intent(), ctx({ knownReferences: new Set(['ch_1']) })).verdict, 'ya_registrado')
})

test('lo ya registrado manda sobre todo lo demás', () => {
  // Si hay cobro interno, no hay ninguna decisión que tomar, aunque el pago esté raro.
  const r = classifyForBackfill(intent({ status: 'canceled' }), ctx({ knownReferences: new Set(['pi_1']) }))
  assert.equal(r.verdict, 'ya_registrado')
})

test('un pago bueno sin contacto interno no crea contactos a la ligera', () => {
  const r = classifyForBackfill(intent({ receipt_email: 'desconocido@example.com' }), ctx())
  assert.equal(r.verdict, 'sin_contacto')
  assert.match(r.reason, /desconocido@example\.com/)
  assert.equal(r.contactId, null)
})

test('un pago sin email dice que no se puede identificar al cliente', () => {
  const r = classifyForBackfill(
    intent({ receipt_email: null, latest_charge: { id: 'ch_1', billing_details: {} } }),
    ctx()
  )
  assert.equal(r.verdict, 'sin_contacto')
  assert.match(r.reason, /no trae email/)
})

test('el email se normaliza antes de buscar el contacto', () => {
  const r = classifyForBackfill(intent({ receipt_email: '  CLIENTE@Example.COM ' }), ctx())
  assert.equal(r.verdict, 'registrable')
  assert.equal(r.contactId, 'contact-1')
})

test('un pago registrable dice QUÉ decisión falta, no promete un registro automático', () => {
  const r = classifyForBackfill(intent(), ctx())
  assert.equal(r.verdict, 'registrable')
  assert.match(r.reason, /producto y plan de pago/)
  assert.equal(r.amount, 997)
  assert.equal(r.currency, 'EUR')
})

test('el resumen solo suma el importe de lo realmente registrable', () => {
  const rows = [
    classifyForBackfill(intent({ id: 'a' }), ctx()),
    classifyForBackfill(intent({ id: 'b' }), ctx()),
    classifyForBackfill(intent({ id: 'c', status: 'canceled' }), ctx()),
    classifyForBackfill(intent({ id: 'd' }), ctx({ knownReferences: new Set(['d']) })),
    classifyForBackfill(intent({ id: 'e', latest_charge: { id: 'x', refunded: true, amount_refunded: 99700 } }), ctx()),
  ]
  const s = summarizeBackfill(rows)
  assert.equal(s.total, 5)
  assert.equal(s.registrable, 2)
  assert.equal(s.no_es_venta, 1)
  assert.equal(s.ya_registrado, 1)
  assert.equal(s.reembolsado, 1)
  // 997 × 2, y NO los cancelados, devueltos o ya registrados: prometer esa suma sería inventar
  // facturación.
  assert.equal(s.importe_registrable, 1994)
})

test('el importe no arrastra error de coma flotante', () => {
  const rows = Array.from({ length: 3 }, (_, i) =>
    classifyForBackfill(intent({ id: `p${i}`, amount_received: 1010 }), ctx())
  )
  assert.equal(summarizeBackfill(rows).importe_registrable, 30.3)
})
