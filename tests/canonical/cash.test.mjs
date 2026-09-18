import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalCash } from '../../lib/canonical/cash.ts'

const col = (id, amount, status = 'collected', ref = null, collected_at = '2026-09-10T10:00:00Z') => ({
  id,
  payment_reference: ref,
  gross_amount: amount,
  status,
  collected_at,
})

// ── PRIMARIA STRIPE ──────────────────────────────────────────────────────────

test('un pago de Stripe sin contraparte interna entra por la primaria', () => {
  const r = canonicalCash(
    [
      {
        payment_id: 'pi_1',
        charge_id: 'ch_1',
        amount: 499,
        refunded_amount: 0,
        status: 'succeeded',
        paid_at: '2026-09-01T10:00:00Z',
        customer_email: null,
      },
    ],
    []
  )
  assert.equal(r.net, 499)
  assert.equal(r.gross, 499)
  assert.equal(r.refunds, 0)
  assert.deepEqual(r.bySource, { stripe: 499, internal: 0 })
})

test('la devolución de Stripe resta dentro del propio pago (§2: neto del refunded_amount)', () => {
  const r = canonicalCash(
    [
      {
        payment_id: 'pi_1',
        charge_id: null,
        amount: 499,
        refunded_amount: 499,
        status: 'refunded',
        paid_at: null,
        customer_email: null,
      },
      {
        payment_id: 'pi_2',
        charge_id: null,
        amount: 1000,
        refunded_amount: 200,
        status: 'partially_refunded',
        paid_at: null,
        customer_email: null,
      },
    ],
    []
  )
  assert.equal(r.gross, 1499)
  assert.equal(r.refunds, 699)
  assert.equal(r.net, 800)
})

test('el refunded_amount nunca puede superar el bruto del pago', () => {
  const r = canonicalCash(
    [
      {
        payment_id: 'pi_1',
        charge_id: null,
        amount: 100,
        refunded_amount: 500,
        status: 'refunded',
        paid_at: null,
        customer_email: null,
      },
    ],
    []
  )
  assert.equal(r.net, 0)
  assert.equal(r.refunds, 100)
})

// ── DEDUP: EL MISMO DINERO EN DOS FUENTES ────────────────────────────────────

test('collections con payment_reference de Stripe NO se suma: mismo dinero cuenta UNA vez', () => {
  const r = canonicalCash(
    [
      {
        payment_id: 'pi_1',
        charge_id: null,
        amount: 499,
        refunded_amount: 0,
        status: 'succeeded',
        paid_at: null,
        customer_email: null,
      },
    ],
    [col('c1', 499, 'collected', 'pi_1')]
  )
  assert.equal(r.net, 499, 'ni 998 ni 0: la primaria gana y el duplicado se descarta')
  assert.equal(r.duplicatedPayments, 1)
  assert.deepEqual(r.bySource, { stripe: 499, internal: 0 })
})

test('el charge_id también casa la referencia (backfill histórico guardó cargos)', () => {
  const r = canonicalCash(
    [
      {
        payment_id: 'pi_1',
        charge_id: 'ch_abc',
        amount: 300,
        refunded_amount: 0,
        status: 'succeeded',
        paid_at: null,
        customer_email: null,
      },
    ],
    [col('c1', 300, 'collected', 'ch_abc')]
  )
  assert.equal(r.net, 300)
  assert.equal(r.duplicatedPayments, 1)
})

test('cobros internos SIN contraparte en Stripe entran como fallback (transferencia, SeQura)', () => {
  const r = canonicalCash(
    [
      {
        payment_id: 'pi_1',
        charge_id: null,
        amount: 500,
        refunded_amount: 0,
        status: 'succeeded',
        paid_at: null,
        customer_email: null,
      },
    ],
    [col('c1', 1200, 'collected', null)]
  )
  assert.equal(r.net, 1700)
  assert.deepEqual(r.bySource, { stripe: 500, internal: 1200 })
})

test('conflicto de importe: gana la primaria pero el conflicto QUEDA REGISTRADO (§19)', () => {
  const r = canonicalCash(
    [
      {
        payment_id: 'pi_1',
        charge_id: null,
        amount: 800,
        refunded_amount: 0,
        status: 'succeeded',
        paid_at: null,
        customer_email: null,
      },
    ],
    [col('c1', 750, 'collected', 'pi_1')]
  )
  assert.equal(r.net, 800)
  assert.equal(r.duplicatedPayments, 1)
  assert.deepEqual(r.amountConflicts, [{ paymentId: 'pi_1', stripe: 800, internal: 750 }])
})

test('diferencias menores de 1 céntimo no son conflicto (redondeo NUMERIC/cent)', () => {
  const r = canonicalCash(
    [
      {
        payment_id: 'pi_1',
        charge_id: null,
        amount: 100.005,
        refunded_amount: 0,
        status: 'succeeded',
        paid_at: null,
        customer_email: null,
      },
    ],
    [col('c1', 100.01, 'collected', 'pi_1')]
  )
  assert.equal(r.amountConflicts.length, 0)
})

// ── DEVOLUCIONES INTERNAS ────────────────────────────────────────────────────

test("una collection 'reversed' ya no suma ni resta: es la MISMA fila que sumó como collected", () => {
  const r = canonicalCash([], [col('c1', 900, 'collected', null), col('c2', 900, 'reversed', null)])
  // El reverso actualiza el status de la fila que en su día sumó: restarlo otra vez devolvería
  // dinero dos veces. La devolución real entra por refunded_amount (Stripe) o la tabla refunds.
  assert.equal(r.net, 900)
  assert.equal(r.gross, 900)
  assert.equal(r.bySource.internal, 900)
})

test("una collection 'reversed' CON contraparte en Stripe NO resta dos veces", () => {
  const r = canonicalCash(
    [
      {
        payment_id: 'pi_1',
        charge_id: null,
        amount: 900,
        refunded_amount: 900,
        status: 'refunded',
        paid_at: null,
        customer_email: null,
      },
    ],
    [col('c1', 900, 'reversed', 'pi_1')]
  )
  assert.equal(r.net, 0)
  assert.equal(r.refunds, 900, 'la devolución ya vive en el refunded_amount del pago')
})

test('disputas no suman ni restan: cash pendiente de resolverse (§2)', () => {
  const r = canonicalCash([], [col('c1', 400, 'disputed', null)])
  assert.equal(r.net, 0)
})

test('la tabla refunds resta SOLO sobre cobros internos que siguen en el cash', () => {
  const r = canonicalCash(
    [],
    [col('c1', 1000, 'collected', null)],
    [{ collection_id: 'c1', refund_date: '2026-09-15', gross_refund_amount: 250, status: 'processed' }]
  )
  assert.equal(r.net, 750)
  assert.equal(r.refunds, 250)
})

test('un refund pending no mueve cash aún; un refund sobre cobro ya salido no resta dos veces', () => {
  const r = canonicalCash(
    [],
    [col('c1', 1000, 'reversed', null)],
    [
      { collection_id: 'c1', refund_date: null, gross_refund_amount: 300, status: 'pending' },
      { collection_id: 'c1', refund_date: null, gross_refund_amount: 300, status: 'processed' },
    ]
  )
  assert.equal(r.net, 0)
  assert.equal(r.refunds, 0)
})

// ── LÍMITES Y SEMÁNTICA 0 ≠ "—" (§39) ────────────────────────────────────────

test('sin datos en ninguna fuente el neto es 0 y el desglose por fuente también', () => {
  const r = canonicalCash([], [])
  assert.deepEqual(r, {
    net: 0,
    gross: 0,
    refunds: 0,
    bySource: { stripe: 0, internal: 0 },
    duplicatedPayments: 0,
    amountConflicts: [],
  })
})

test('el desglose por fuente suma EXACTAMENTE el neto (partida al completo, §19)', () => {
  const r = canonicalCash(
    [
      {
        payment_id: 'pi_1',
        charge_id: null,
        amount: 500,
        refunded_amount: 100,
        status: 'partially_refunded',
        paid_at: null,
        customer_email: null,
      },
      {
        payment_id: 'pi_2',
        charge_id: null,
        amount: 200,
        refunded_amount: 0,
        status: 'succeeded',
        paid_at: null,
        customer_email: null,
      },
    ],
    [
      col('c1', 700, 'collected', 'pi_1'), // duplicado de Stripe
      col('c2', 350, 'collected', null), // fallback interno
      col('c3', 350, 'reversed', null), // reverso interno sin Stripe: no suma ni resta
    ],
    [{ collection_id: 'c2', refund_date: null, gross_refund_amount: 50, status: 'processed' }]
  )
  assert.equal(r.bySource.stripe + r.bySource.internal, r.net)
  assert.equal(r.net, 900) // (600 + 200) + (350 − 50)
})

test('doble fila del mismo pago en el espejo se come una vez (defensa del merge)', () => {
  const fila = {
    payment_id: 'pi_1',
    charge_id: null,
    amount: 99,
    refunded_amount: 0,
    status: 'succeeded',
    paid_at: null,
    customer_email: null,
  }
  const r = canonicalCash([fila, fila], [])
  assert.equal(r.net, 99)
})
