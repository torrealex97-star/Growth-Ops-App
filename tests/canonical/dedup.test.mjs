import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalizeLeads,
  canonicalizeAppointments,
  dedupeSales,
  canonicalizePayments,
  coveragePct,
} from '../../lib/canonical/dedup.ts'
import { resolveByPriority, SOURCE_REGISTRY, confidenceForMatch } from '../../lib/sources/registry.ts'

// ── LEADS CANÓNICOS (§6) ─────────────────────────────────────────────────────

test('misma persona por Typeform y Calendly (mismo email) = UN lead', () => {
  const { leads, duplicates } = canonicalizeLeads([
    { id: 'a', email: 'ana@x.com', phone: null, created_at: '2026-09-01' },
    { id: 'b', email: 'ana@x.com', phone: null, created_at: '2026-09-05' },
  ])
  assert.equal(leads.length, 1)
  assert.equal(leads[0].members.length, 2)
  assert.equal(duplicates, 1)
})

test('match por teléfono cuando no hay email (mismo número, formato distinto)', () => {
  const { leads } = canonicalizeLeads([
    { id: 'a', email: null, phone: '+34 600 100 100', created_at: '2026-09-01' },
    { id: 'b', email: null, phone: '+34600100100', created_at: '2026-09-02' },
  ])
  assert.equal(leads.length, 1)
})

test('variantes con prefijo país distinto NO casan (sin evidencia no se fusiona)', () => {
  // +34 600 100 100 vs 600 100 100 sin prefijo: no son un match EXACTO (§6). Fusionarlos sería
  // inferencia — el duplicado honesto se ve en el panel de Calidad de datos.
  const { leads } = canonicalizeLeads([
    { id: 'a', email: null, phone: '+34 600 100 100', created_at: '2026-09-01' },
    { id: 'b', email: null, phone: '600100100', created_at: '2026-09-02' },
  ])
  assert.equal(leads.length, 2)
})

test('sin evidencia NO se fusiona nadie (mejor duplicado honesto)', () => {
  const { leads } = canonicalizeLeads([
    { id: 'a', email: null, phone: null, created_at: '2026-09-01' },
    { id: 'b', email: null, phone: null, created_at: '2026-09-02' },
  ])
  assert.equal(leads.length, 2)
})

test('emails distintos = personas distintas aunque coincida otra cosa', () => {
  const { leads } = canonicalizeLeads([
    { id: 'a', email: 'ana@x.com', phone: '600', created_at: '2026-09-01' },
    { id: 'b', email: 'juan@x.com', phone: '600', created_at: '2026-09-02' },
  ])
  assert.equal(leads.length, 2)
})

// ── AGENDAS (§8) ─────────────────────────────────────────────────────────────

test('Calendly + Google Calendar = UNA agenda (mismo calendly_event_id)', () => {
  const { appointments, duplicates } = canonicalizeAppointments([
    {
      id: 'a1',
      contact_id: 'c1',
      calendly_event_id: 'EV1',
      calendar_event_id: 'G1',
      scheduled_at: '2026-09-02T10:00:00Z',
      status: 'show',
    },
    {
      id: 'a2',
      contact_id: 'c1',
      calendly_event_id: 'EV1',
      calendar_event_id: 'G1',
      scheduled_at: '2026-09-02T10:00:00Z',
      status: 'show',
    },
  ])
  assert.equal(appointments.length, 1)
  assert.equal(duplicates, 1)
})

test('citas distintas del mismo contacto NO se consolidan', () => {
  const { appointments } = canonicalizeAppointments([
    {
      id: 'a1',
      contact_id: 'c1',
      calendly_event_id: 'EV1',
      calendar_event_id: null,
      scheduled_at: '2026-09-02T10:00:00Z',
      status: 'show',
    },
    {
      id: 'a2',
      contact_id: 'c1',
      calendly_event_id: 'EV2',
      calendar_event_id: null,
      scheduled_at: '2026-09-09T10:00:00Z',
      status: 'no_show',
    },
  ])
  assert.equal(appointments.length, 2)
})

// ── VENTAS (§10) ─────────────────────────────────────────────────────────────

test('misma venta en CRM e interna = UNA (opportunity_id compartida)', () => {
  const { unique, duplicates } = dedupeSales([
    { id: 's1', contact_id: 'c1', opportunity_id: 'OP1', closed_at: '2026-09-03', amount: 7500 },
    { id: 's2', contact_id: 'c1', opportunity_id: 'OP1', closed_at: '2026-09-03', amount: 7500 },
  ])
  assert.equal(unique.length, 1)
  assert.equal(duplicates, 1)
})

test('dos ventas reales distintas no se deduplican', () => {
  const { unique } = dedupeSales([
    { id: 's1', contact_id: 'c1', opportunity_id: null, closed_at: '2026-09-03', amount: 7500 },
    { id: 's2', contact_id: 'c1', opportunity_id: null, closed_at: '2026-09-03', amount: 1500 },
  ])
  assert.equal(unique.length, 2)
})

// ── PAGOS/CASH (§2) ──────────────────────────────────────────────────────────

test('mismo pago en Stripe y banco = UNA vez (transaction_id)', () => {
  const { cash, duplicates } = canonicalizePayments([
    {
      id: 'p1',
      transaction_id: 'TX9',
      customer_id: 'c1',
      amount: 1000,
      paid_at: '2026-09-04T10:00:00Z',
      status: 'collected',
    },
    {
      id: 'p2',
      transaction_id: 'TX9',
      customer_id: 'c1',
      amount: 1000,
      paid_at: '2026-09-04T10:00:00Z',
      status: 'collected',
    },
  ])
  assert.equal(cash.length, 1)
  assert.equal(duplicates, 1)
})

test('failed/pending NO son cash', () => {
  const { cash } = canonicalizePayments([
    { id: 'p1', transaction_id: 'TX1', customer_id: 'c', amount: 100, paid_at: '2026-09-04', status: 'failed' },
    { id: 'p2', transaction_id: 'TX2', customer_id: 'c', amount: 100, paid_at: '2026-09-04', status: 'pending' },
    { id: 'p3', transaction_id: 'TX3', customer_id: 'c', amount: 100, paid_at: '2026-09-04', status: 'collected' },
  ])
  assert.equal(cash.length, 1)
})

// ── RESOLUCIÓN DE CONFLICTOS (§19) ──────────────────────────────────────────

test('gana la fuente de mayor prioridad y el conflicto se registra', () => {
  const res = resolveByPriority(SOURCE_REGISTRY.revenue_closed, {
    crm: 8000,
    internal_sales: 7500,
  })
  assert.equal(res.selected.value, 7500) // internal_sales > crm (§18)
  assert.equal(res.selected.source, 'internal_sales')
  assert.equal(res.conflicted, true)
  assert.equal(res.candidates.length, 2)
})

test('fallback en orden cuando la primaria no tiene dato', () => {
  const res = resolveByPriority(SOURCE_REGISTRY.cash_collected, {
    stripe: null,
    bank: 500,
  })
  assert.equal(res.selected.source, 'bank')
  assert.equal(res.selected.value, 500)
  assert.equal(res.conflicted, false)
})

test('sin ninguna fuente con dato → null (nunca 0, §39)', () => {
  const res = resolveByPriority(SOURCE_REGISTRY.cash_collected, {})
  assert.equal(res.selected.value, null)
})

test('valores iguales en dos fuentes NO es conflicto', () => {
  const res = resolveByPriority(SOURCE_REGISTRY.cash_collected, { stripe: 100, bank: 100 })
  assert.equal(res.conflicted, false)
})

// ── CONFIANZA Y COBERTURA (§20/§21) ─────────────────────────────────────────

test('confianza: email=high, phone=medium, inferred=low', () => {
  assert.equal(confidenceForMatch('email').level, 'high')
  assert.equal(confidenceForMatch('phone').level, 'medium')
  assert.equal(confidenceForMatch('inferred').level, 'low')
})

test('cobertura de atribución', () => {
  assert.equal(coveragePct({ total: 100, attributed: 91 }), 91)
  assert.equal(coveragePct({ total: 0, attributed: 0 }), null)
})
