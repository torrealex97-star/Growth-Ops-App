import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pendingPayments, readPaymentInbox } from '../lib/sales/payment-inbox.ts'
import { canViewPaymentInbox } from '../lib/sales/payment-inbox-access.ts'

test('the whole tenant inbox is visible to admins, directors, closers and setters only', () => {
  for (const role of ['admin', 'director', 'closer', 'setter']) assert.equal(canViewPaymentInbox(role), true)
  for (const role of [null, undefined, '', 'affiliate', 'marketing', 'csm', 'gestoria'])
    assert.equal(canViewPaymentInbox(role), false)
  assert.equal(canViewPaymentInbox(null, true), true)
})

test('shared inbox reads stay tenant scoped; registration retains assignment restrictions', () => {
  const list = readFileSync(
    new URL('../app/api/[tenant]/evergreen/sales/payment-inbox/route.ts', import.meta.url),
    'utf8'
  )
  const resolve = readFileSync(
    new URL('../app/api/[tenant]/evergreen/sales/payment-inbox/resolve/route.ts', import.meta.url),
    'utf8'
  )
  assert.match(list, /canViewPaymentInbox\(session.role, session.isSuperAdmin\)/)
  assert.match(list, /readPaymentInbox\(sb, session.tenantId, null\)/)
  assert.match(resolve, /readPaymentInbox\(sb, session.tenantId, closer\)/)
  assert.match(resolve, /\['admin', 'director', 'closer'\]/)
})

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
test('assignment-scoped registration only accepts uniquely identified assigned contacts', () => {
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
  assert.equal(scopes.length, 6)
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

test('customer identity survives changed receipt email but rejects contradictory contacts', () => {
  const links = [{ stripe_customer_id: 'cus_test', contact_id: 'contact' }]
  const receipt = { ...payment, customer_id: 'cus_test', customer_email: 'new@example.test' }
  const resolved = pendingPayments([receipt], [contact], new Set(), null, links)[0]
  assert.equal(resolved.contactId, 'contact')
  assert.equal(resolved.identitySource, 'customer')
  const conflict = pendingPayments(
    [receipt],
    [contact, { id: 'other', email: 'new@example.test', full_name: 'Other' }],
    new Set(),
    null,
    links
  )[0]
  assert.equal(conflict.contactId, null)
})
