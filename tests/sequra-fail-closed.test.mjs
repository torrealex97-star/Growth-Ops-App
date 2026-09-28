import assert from 'node:assert/strict'
import test from 'node:test'

import { searchAllOrders } from '../lib/sequra/client.ts'
import { marcarRecuperados, syncSequraDelinquents } from '../lib/sequra/syncDelinquents.ts'

// -----------------------------------------------------------------------------
// BUG P2 (auditoría FASE A, 28-sep): searchAllOrders asignaba total=0 cuando el
// listado no traía un "of N total" legible, devolvía [] (o lo que llevara) y
// syncDelinquents marcaba 'recuperado' a TODOS los morosos ausentes — un hueco
// convertido en cero. Ahora el listado ilegible o truncado falla ruidoso y el
// cron reintenta la sincronización entera (idempotente por upsert).
//
// El MCP de SeQura es JSON-RPC sobre HTTP: cada tools/call devuelve
// { result: { content: [{ text }] } }. Los mocks de fetch devuelven ese sobre.
// -----------------------------------------------------------------------------

const SEQURA_MCP_URL = 'https://simba.sequra.com/mcp'
const ENV = { SEQURA_MCP_TOKEN: 'tok', SEQURA_MERCHANT_REFERENCE: 'MREF-1' }

const linea = (i, status = 'confirmed') => `${i}. REF${i} - 99.00 EUR (0-1) [${status}] - EUR`
const pagina = (desde, hasta, total) =>
  [
    `Showing ${desde + 1}-${hasta} of ${total} total.`,
    ...Array.from({ length: hasta - desde }, (_, k) => linea(desde + k + 1)),
  ].join('\n')

/** Sustituye fetch y devuelve la cola de respuestas text por llamada. */
function mockFetchSequra(textos) {
  const original = globalThis.fetch
  let llamada = 0
  globalThis.fetch = async (url) => {
    if (url !== SEQURA_MCP_URL) throw new Error(`URL inesperada: ${url}`)
    const text = textos[Math.min(llamada, textos.length - 1)]
    llamada++
    return {
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } }),
    }
  }
  return {
    llamadas: () => llamada,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

// ── searchAllOrders: el listado debe ser legible o no hay sincronización ─────

test('searchAllOrders: respuesta ilegible (sin "of N total") LANZA en vez de devolver vacío', async () => {
  const mock = mockFetchSequra(['ERROR: pagination unavailable'])
  try {
    await assert.rejects(() => searchAllOrders(ENV, 'MREF-1'), /No se pudo leer el total del listado/)
  } finally {
    mock.restore()
  }
})

test('searchAllOrders: segunda página corrupta lanza (no se cierra con la primera a medias)', async () => {
  const mock = mockFetchSequra([pagina(0, 100, 205), 'página corrupta sin total'])
  try {
    // Con el total ya leído (205), una página que no aporta líneas es un listado truncado:
    // distinto mensaje, mismo fail-closed.
    await assert.rejects(() => searchAllOrders(ENV, 'MREF-1'), /truncado: 100 pedidos leídos de 205/)
  } finally {
    mock.restore()
  }
})

test('searchAllOrders: página corta con más pedidos anunciados = listado truncado, LANZA', async () => {
  const mock = mockFetchSequra([pagina(0, 3, 250)])
  try {
    await assert.rejects(() => searchAllOrders(ENV, 'MREF-1'), /truncado: 3 pedidos leídos de 250/)
  } finally {
    mock.restore()
  }
})

test('searchAllOrders: salida vacía VÁLIDA (total 0 legible) pasa sin lanzar', async () => {
  const mock = mockFetchSequra(['No orders found. Showing 0 of 0 total.'])
  try {
    const orders = await searchAllOrders(ENV, 'MREF-1')
    assert.deepEqual(orders, [])
  } finally {
    mock.restore()
  }
})

test('searchAllOrders: más de 100 pedidos pagina completo y no lanza (205 = 100+100+5)', async () => {
  const mock = mockFetchSequra([pagina(0, 100, 205), pagina(100, 200, 205), pagina(200, 205, 205)])
  try {
    const orders = await searchAllOrders(ENV, 'MREF-1')
    assert.equal(orders.length, 205)
    assert.equal(mock.llamadas(), 3)
    assert.equal(orders[204].reference, 'REF205')
  } finally {
    mock.restore()
  }
})

// ── marcarRecuperados: solo se cierra a quien estuvo EN un listado legible ────

/** Cadena encadenable de supabase-js que devuelve `resultado` al await. */
function chainDe(resultado) {
  const chain = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return Promise.resolve(resultado).then.bind(Promise.resolve(resultado))
        return () => chain
      },
    }
  )
  return chain
}

function fakeSb(lectura, resultadosUpdate = []) {
  const ops = []
  let updateIdx = 0
  return {
    ops,
    from() {
      const tabla = 'sequra_delinquent_customers'
      const base = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') {
              const esUpdate = ops.some(([op]) => op === 'update')
              const res = esUpdate ? (resultadosUpdate[updateIdx++] ?? { data: null, error: null }) : lectura
              return Promise.resolve(res).then.bind(Promise.resolve(res))
            }
            return (...args) => {
              ops.push([prop, ...args])
              return base
            }
          },
        }
      )
      void tabla
      return base
    },
  }
}

test('marcarRecuperados: si la lectura de morosos en seguimiento falla, LANZA y no marca a nadie', async () => {
  const sb = fakeSb({ data: null, error: { message: 'db caída' } })
  await assert.rejects(
    () => marcarRecuperados(sb, 't1', ['REF1']),
    /No se pudo leer la lista de morosos en seguimiento/
  )
  assert.ok(!sb.ops.some(([op]) => op === 'update'), 'ningún update puede ejecutarse a ciegas')
})

test('marcarRecuperados: marca SOLO a los ausentes del listado y con scope de tenant', async () => {
  const sb = fakeSb({
    data: [
      { id: 'r1', order_reference: 'REF1' },
      { id: 'r2', order_reference: 'REF2' },
      { id: 'r3', order_reference: 'REF3' },
    ],
    error: null,
  })
  const recovered = await marcarRecuperados(sb, 'tenant-qa', ['REF1'])
  assert.equal(recovered, 2)
  const opsStr = sb.ops.map((c) => c.join('|'))
  assert.ok(opsStr.includes('eq|id|r2'), 'REF2 deja de estar en mora: se marca')
  assert.ok(opsStr.includes('eq|id|r3'), 'REF3 deja de estar en mora: se marca')
  assert.ok(!opsStr.includes('eq|id|r1'), 'REF1 sigue en mora: NO se marca')
  assert.ok(opsStr.includes('not|status|in|(recuperado,incobrable)'), 'no se pisan recuperados/incobrables')
  assert.ok(opsStr.includes('eq|tenant_id|tenant-qa'), 'scope de tenant en la escritura')
})

test('marcarRecuperados: un update fallido LANZA (antes se tragaba y el run mentía)', async () => {
  const sb = fakeSb({ data: [{ id: 'r9', order_reference: 'REF9' }], error: null }, [
    { data: null, error: { message: 'write conflict' } },
  ])
  await assert.rejects(() => marcarRecuperados(sb, 't1', []), /Error marcando recuperado REF9/)
})

// ── Integración: el invariante end-to-end del cron ───────────────────────────

test('syncSequraDelinquents: con el listado ilegible, el run falla y NINGÚN moroso se toca', async () => {
  // La sincronización crea su propio cliente: se parchea el prototipo para registrar
  // las escrituras sin tocar la BD real.
  const { SupabaseClient } = await import('@supabase/supabase-js')
  const ops = []
  const fromOriginal = SupabaseClient.prototype.from
  SupabaseClient.prototype.from = () => {
    const base = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then')
            return Promise.resolve({ data: [], error: null }).then.bind(Promise.resolve({ data: [], error: null }))
          return (...args) => {
            ops.push([prop, ...args])
            return base
          }
        },
      }
    )
    return base
  }

  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://placeholder.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder-key'
  const mock = mockFetchSequra(['ERROR: pagination unavailable'])
  try {
    await assert.rejects(() => syncSequraDelinquents('tenant-qa', ENV), /No se pudo leer el total del listado/)
    assert.ok(!ops.some(([op]) => op === 'update'), 'nadie se marca recuperado con el listado ilegible')
    assert.ok(!ops.some(([op]) => op === 'upsert'), 'nadie se marca moroso con el listado ilegible')
  } finally {
    mock.restore()
    SupabaseClient.prototype.from = fromOriginal
  }
})
