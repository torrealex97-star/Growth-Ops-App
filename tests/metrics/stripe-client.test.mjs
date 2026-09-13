import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyStripeError, stripeGet, stripeList } from '../../lib/stripe/client.ts'

// Había cuatro llamadas a Stripe escritas a mano y solo una paginaba: las otras pedían limit=100 y se
// quedaban con las 100 filas más recientes. La base de clientes salía incompleta y la conciliación
// daba por cuadrado lo que nunca había mirado, las dos sin un solo error por medio.

const AUTH = { secretKey: 'sk_test_1234567890' }

function stubFetch(handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, opts) => {
    calls.push(String(url))
    return handler(String(url), opts, calls.length)
  }
  return { calls, restore: () => (globalThis.fetch = original) }
}

const page = (ids, hasMore) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: ids.map((id) => ({ id })), has_more: hasMore }),
})

test('recorre todas las páginas siguiendo starting_after', async () => {
  const f = stubFetch((_u, _o, n) => (n === 1 ? page(['a', 'b'], true) : page(['c'], false)))
  try {
    const r = await stripeList('payment_intents', new URLSearchParams({ limit: '2' }), AUTH)
    assert.deepEqual(
      r.items.map((i) => i.id),
      ['a', 'b', 'c']
    )
    assert.equal(r.truncated, false)
    assert.equal(r.pages, 2)
    assert.ok(f.calls[1].includes('starting_after=b'), f.calls[1])
  } finally {
    f.restore()
  }
})

test('al agotar el tope de páginas lo DICE en vez de presentar media lista como completa', async () => {
  const f = stubFetch(() => page(['x'], true))
  try {
    const r = await stripeList('charges', new URLSearchParams(), AUTH, { maxPages: 3 })
    assert.equal(r.pages, 3)
    assert.equal(r.truncated, true)
  } finally {
    f.restore()
  }
})

test('al agotar el presupuesto de tiempo también lo dice', async () => {
  const f = stubFetch(() => page(['x'], true))
  try {
    const r = await stripeList('charges', new URLSearchParams(), AUTH, { deadline: Date.now() - 1 })
    assert.equal(r.items.length, 0)
    assert.equal(r.truncated, true)
  } finally {
    f.restore()
  }
})

test('la cuenta conectada viaja en la cabecera Stripe-Account', async () => {
  let headers
  const f = stubFetch((_u, opts) => {
    headers = opts.headers
    return page([], false)
  })
  try {
    await stripeList('charges', new URLSearchParams(), { secretKey: 'sk_test_x', accountId: 'acct_9' })
    assert.equal(headers['Stripe-Account'], 'acct_9')
    assert.equal(headers.Authorization, 'Bearer sk_test_x')
  } finally {
    f.restore()
  }
})

test('cada fallo de Stripe tiene una causa con arreglo, no el texto en inglés', () => {
  assert.equal(classifyStripeError(401, { error: { message: 'Invalid API Key' } }).code, 'token_invalido')
  assert.equal(classifyStripeError(403, {}).code, 'sin_permisos')
  assert.equal(classifyStripeError(429, {}).code, 'limite_de_uso')
  assert.equal(classifyStripeError(503, {}).code, 'red')
  assert.equal(classifyStripeError(400, { error: { message: 'No such payment_intent' } }).code, 'respuesta_inesperada')
  assert.match(classifyStripeError(401, {}).message, /clave secreta/)
})

test('un error de Stripe se lanza con su código, y no se sigue paginando', async () => {
  const f = stubFetch(() => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API Key' } }) }))
  try {
    await assert.rejects(() => stripeList('charges', new URLSearchParams(), AUTH), { code: 'token_invalido' })
    assert.equal(f.calls.length, 1)
  } finally {
    f.restore()
  }
})

test('toda llamada lleva timeout: Stripe colgado no debe colgar la pantalla', async () => {
  const f = stubFetch(() => {
    const err = new Error('tardó demasiado')
    err.name = 'TimeoutError'
    throw err
  })
  try {
    await assert.rejects(() => stripeGet('charges', new URLSearchParams(), AUTH), { code: 'timeout' })
  } finally {
    f.restore()
  }
})
