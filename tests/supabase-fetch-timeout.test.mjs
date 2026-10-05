import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchSupabaseWithTimeout,
  SUPABASE_REQUEST_TIMEOUT_MS,
  SUPABASE_STORAGE_TIMEOUT_MS,
} from '../lib/supabase/fetch-with-timeout.ts'

const withFetch = async (implementation, run) => {
  const original = globalThis.fetch
  globalThis.fetch = implementation
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

test('las peticiones de datos y storage tienen techos finitos y distintos', () => {
  assert.equal(SUPABASE_REQUEST_TIMEOUT_MS, 15_000)
  assert.equal(SUPABASE_STORAGE_TIMEOUT_MS, 60_000)
  assert.ok(SUPABASE_STORAGE_TIMEOUT_MS > SUPABASE_REQUEST_TIMEOUT_MS)
})

test('propaga la respuesta y conserva las opciones de fetch', async () => {
  const expected = new Response('{"ok":true}', { status: 200 })
  const received = await withFetch(
    async (_input, init) => {
      assert.equal(init.method, 'POST')
      assert.ok(init.signal instanceof AbortSignal)
      return expected
    },
    () => fetchSupabaseWithTimeout('https://example.supabase.co/rest/v1/items', { method: 'POST' })
  )
  assert.equal(received, expected)
})

test('la cancelación del componente aborta también la petición Supabase', async () => {
  const external = new AbortController()
  const pending = withFetch(
    async (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          { once: true }
        )
      }),
    () => fetchSupabaseWithTimeout('https://example.supabase.co/rest/v1/items', { signal: external.signal })
  )
  external.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})
