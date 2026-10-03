import test from 'node:test'
import assert from 'node:assert/strict'
import { executeReservationRefund } from '../lib/stripe/reservation-refund.ts'

const request = () => ({
  id: 'request-fixture',
  tenant_id: 'tenant-fixture',
  sale_id: 'sale-fixture',
  charge_id: 'ch_fixture',
  stripe_account_id: 'acct_fixture',
  amount_cents: 5000,
  status: 'requested',
  stripe_refund_id: null,
  created_at: new Date().toISOString(),
})
const auth = { secretKey: 'sk_test_fixture', accountId: 'acct_fixture' }
const refund = (status = 'succeeded') => ({
  id: 're_fixture',
  charge: 'ch_fixture',
  amount: 5000,
  currency: 'eur',
  created: 1,
  status,
  metadata: { reservation_refund_request: 'request-fixture' },
})
async function mockedFetch(handler, run) {
  const old = globalThis.fetch
  globalThis.fetch = handler
  try {
    await run()
  } finally {
    globalThis.fetch = old
  }
}
const json = (x) => Response.json(x)
test('creates with original charge, exact cents, connected account and stable idempotency', async () => {
  const keys = []
  await mockedFetch(
    async (url, init) => {
      if (init.method !== 'POST') return json({ data: [], has_more: false })
      keys.push(init.headers['Idempotency-Key'])
      assert.equal(init.headers['Stripe-Account'], 'acct_fixture')
      const body = new URLSearchParams(init.body)
      assert.equal(body.get('charge'), 'ch_fixture')
      assert.equal(body.get('amount'), '5000')
      return json(refund())
    },
    async () => {
      await executeReservationRefund(request(), auth)
      await executeReservationRefund(request(), auth)
    }
  )
  assert.deepEqual(keys, ['reservation-refund-request-fixture', 'reservation-refund-request-fixture'])
})
test('recovers successful provider result after local timeout without a second POST', async () => {
  await mockedFetch(
    async (url, init) => {
      assert.notEqual(init.method, 'POST')
      return json({ data: [refund()], has_more: false })
    },
    async () => {
      const result = await executeReservationRefund({ ...request(), created_at: '2020-01-01' }, auth)
      assert.equal(result.status, 'succeeded')
    }
  )
})
test('expired idempotency cannot resend money', async () => {
  await mockedFetch(
    async (url, init) => {
      assert.notEqual(init.method, 'POST')
      return json({ data: [], has_more: false })
    },
    async () => {
      await assert.rejects(
        executeReservationRefund({ ...request(), created_at: '2020-01-01' }, auth),
        /sin resultado confirmado/
      )
    }
  )
})
test('pending and failed provider results are not represented as succeeded', async () => {
  for (const status of ['pending', 'failed', 'canceled']) {
    await mockedFetch(
      async (url, init) => {
        assert.notEqual(init.method, 'POST')
        return json(refund(status))
      },
      async () => {
        assert.equal(
          (await executeReservationRefund({ ...request(), stripe_refund_id: 're_fixture' }, auth)).status,
          status
        )
      }
    )
  }
})
test('prior external refund blocks a new request', async () => {
  await mockedFetch(
    async (url, init) => {
      assert.notEqual(init.method, 'POST')
      return json({ data: [{ ...refund(), metadata: {} }], has_more: false })
    },
    async () => {
      await assert.rejects(executeReservationRefund(request(), auth), /otras devoluciones/)
    }
  )
})
test('provider charge, amount and currency must match the durable claim', async () => {
  for (const patch of [{ charge: 'ch_other' }, { amount: 6000 }, { currency: 'usd' }]) {
    await mockedFetch(
      async () => json({ ...refund(), ...patch }),
      async () => {
        await assert.rejects(
          executeReservationRefund({ ...request(), stripe_refund_id: 're_fixture' }, auth),
          /no coincide/
        )
      }
    )
  }
})
