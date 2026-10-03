import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pendingPayments, readPaymentInbox } from '../lib/sales/payment-inbox.ts'
const payment = {
  payment_id: 'pi_test',
  charge_id: 'ch_test',
  customer_email: 'client@example.test',
  amount: 100,
  refunded_amount: 0,
  currency: 'eur',
  status: 'succeeded',
  paid_at: '2026-09-01T00:00:00Z',
}
const contact = { id: 'contact', email: 'CLIENT@example.test', full_name: 'Test contact' }

test('a Stripe receipt creates a pending task, not a sale; both canonical references resolve it', () => {
  assert.equal(pendingPayments([payment], [contact], new Set(), null)[0].contactId, 'contact')
  for (const ref of ['pi_test', 'ch_test'])
    assert.deepEqual(pendingPayments([payment], [contact], new Set([ref]), null), [])
})
test('closers only see uniquely identified assigned contacts, administrators retain ambiguous tasks', () => {
  assert.equal(pendingPayments([payment], [contact], new Set(), new Set(['contact'])).length, 1)
  assert.equal(pendingPayments([payment], [contact], new Set(), new Set(['other'])).length, 0)
  const duplicate = { ...contact, id: 'another' }
  assert.equal(pendingPayments([payment], [contact, duplicate], new Set(), new Set(['contact'])).length, 0)
  assert.equal(pendingPayments([payment], [contact, duplicate], new Set(), null)[0].contactId, null)
})
test('failed, disputed and fully refunded payments are not sales tasks', () => {
  for (const status of ['failed', 'disputed', 'refunded', 'processing'])
    assert.equal(pendingPayments([{ ...payment, status }], [contact], new Set(), null).length, 0)
  assert.equal(pendingPayments([{ ...payment, refunded_amount: 100 }], [contact], new Set(), null).length, 0)
})
test('all sources are tenant-scoped and a read error is never an empty inbox', async () => {
  const scopes = []
  const sb = {
    from(table) {
      return {
        select() {
          return this
        },
        eq(key, value) {
          scopes.push([table, key, value])
          return this
        },
        order() {
          return this
        },
        range() {
          return Promise.resolve({ data: null, error: { message: 'offline' } })
        },
      }
    },
  }
  await assert.rejects(readPaymentInbox(sb, 'tenant-test', 'closer-test'), /bandeja completa/)
  assert.equal(scopes.length, 5)
  assert.ok(scopes.every(([, key, value]) => key === 'tenant_id' && value === 'tenant-test'))
})
test('payment registration is atomic, serialized and not callable by browser roles', () => {
  const sql = readFileSync(
    new URL('../supabase/migrations/20260928191947_resolve_payment_inbox.sql', import.meta.url),
    'utf8'
  )
  assert.match(sql, /SECURITY INVOKER/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.ok(sql.indexOf('SELECT sale_id, id') < sql.indexOf('INSERT INTO sales'))
  assert.match(sql, /FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /TO service_role/)
  assert.match(sql, /INSERT INTO audit_logs/)
  assert.doesNotMatch(sql, /EXCEPTION WHEN|COMMIT/)
})
