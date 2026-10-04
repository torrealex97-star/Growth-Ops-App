import test from 'node:test'
import assert from 'node:assert/strict'
import { loadPaymentInbox, invalidatePaymentInbox } from '../lib/sales/payment-inbox-client.ts'

const scope = { tenant: 'test-tenant', userId: 'test-user', role: 'admin', isSuperAdmin: false }
const body = { rows: [], total: 0 }

test('header and page share concurrent reads; completed data is not cached', async (t) => {
  let finish
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    await new Promise((resolve) => {
      finish = resolve
    })
    return Response.json(body)
  })
  const a = loadPaymentInbox(scope)
  const b = loadPaymentInbox(scope)
  assert.equal(a, b)
  assert.equal(calls, 1)
  finish()
  assert.deepEqual(await a, body)
  const c = loadPaymentInbox(scope)
  assert.equal(calls, 2)
  finish()
  await c
})

test('concurrent reads are isolated by tenant, user and permissions', async (t) => {
  const finishes = []
  t.mock.method(globalThis, 'fetch', async () => {
    await new Promise((resolve) => finishes.push(resolve))
    return Response.json(body)
  })
  const requests = [
    scope,
    { ...scope, tenant: 'other' },
    { ...scope, userId: 'other' },
    { ...scope, role: 'closer' },
    { ...scope, isSuperAdmin: true },
  ].map(loadPaymentInbox)
  assert.equal(finishes.length, 5)
  finishes.forEach((finish) => finish())
  await Promise.all(requests)
})

test('read failures clear the shared request and allow retry', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Unavailable' }, { status: 503 }))
  await assert.rejects(loadPaymentInbox(scope), /Unavailable/)
  t.mock.method(globalThis, 'fetch', async () => Response.json(body))
  assert.deepEqual(await loadPaymentInbox(scope), body)
})

test('successful writes invalidate older in-flight reads without deleting the new read', async (t) => {
  const finishes = []
  t.mock.method(globalThis, 'fetch', async () => {
    await new Promise((resolve) => finishes.push(resolve))
    return Response.json(body)
  })
  const old = loadPaymentInbox(scope)
  invalidatePaymentInbox(scope)
  const fresh = loadPaymentInbox(scope)
  assert.notEqual(old, fresh)
  finishes[0]()
  await old
  assert.equal(loadPaymentInbox(scope), fresh)
  finishes[1]()
  await fresh
})

test('a stalled read times out and releases the slot for retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(
    globalThis,
    'fetch',
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
  )
  const request = loadPaymentInbox(scope)
  const rejection = assert.rejects(request, /tardado demasiado/)
  t.mock.timers.tick(15_000)
  await rejection
  t.mock.method(globalThis, 'fetch', async () => Response.json(body))
  assert.deepEqual(await loadPaymentInbox(scope), body)
})
