import assert from 'node:assert/strict'
import test from 'node:test'

import { syncStripePayments } from '../lib/finance/stripePaymentsSync.ts'
import { fetchStripeFeesForChargeIds } from '../lib/finance/stripeFees.ts'

// -----------------------------------------------------------------------------
// P1 CRON STRIPE-PAYMENTS (auditoría FASE A): el deadline (30 s cron / 45 s manual)
// solo gobernaba la PAGINACIÓN dentro de stripeList. Después venían, sin presupuesto
// alguno: (1) el bucle de fees —una llamada a charges/:id?expand[]=balance_transaction
// POR PAGO, secuencial, cada una con timeout de hasta 20 s— y (2) el upsert al final.
// Con historial grande la función moría por maxDuration (60 s) SIN escribir la página
// leída: el reintento empezaba de cero. Y si una lectura de fee fallaba, se escribía
// stripe_fee=NULL ENCIMA del fee bueno que el espejo ya tenía (los fees son inmutables).
//
// WORST-CASE MEDIDO EN EL MOCK: 2.000 pagos = 20 páginas de listado + hasta 2.000
// llamadas de fee. A 200 ms por llamada son ~400 s solo de fees: más de 6× el
// maxDuration. Ningún deadline exterminaba ese bucle.
// -----------------------------------------------------------------------------

/** PaymentIntent succeeded con su charge expandido. */
const intent = (n) => ({
  id: `pi_${n}`,
  amount_received: 10_000,
  currency: 'eur',
  created: 1_700_000_000,
  status: 'succeeded',
  latest_charge: { id: `ch_${n}`, amount_refunded: 0, refunded: false, disputed: false },
})

/** Servidor Stripe de juguete sobre fetch global. */
function mockStripe({ paginas = 1, latenciaFeeMs = 0, feeRotoPara = new Set() } = {}) {
  const original = globalThis.fetch
  let feeCount = 0
  let listCount = 0
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (!u.startsWith('https://api.stripe.com/v1/')) throw new Error(`URL inesperada: ${u}`)
    if (u.includes('/payment_intents?')) {
      const page = listCount++
      const has_more = page < paginas - 1
      const starting_after = Number(u.match(/starting_after=(\d+)/)?.[1] ?? -1) + 1
      const data = Array.from({ length: 100 }, (_, k) => intent(starting_after + k))
      return { ok: true, json: async () => ({ object: 'list', data, has_more }) }
    }
    const m = u.match(/\/charges\/(ch_\d+)\?/)
    if (m) {
      feeCount++
      if (latenciaFeeMs > 0) await new Promise((r) => setTimeout(r, latenciaFeeMs))
      if (feeRotoPara.has(m[1])) return { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }
      return {
        ok: true,
        json: async () => ({ balance_transaction: { fee: 324, fee_details: [{ amount: 324, type: 'stripe_fee' }] } }),
      }
    }
    throw new Error(`Ruta Stripe no mockeada: ${u}`)
  }
  return {
    get feeCount() {
      return feeCount
    },
    get listCount() {
      return listCount
    },
    restore: () => {
      globalThis.fetch = original
    },
  }
}

/** Supabase de juguete: el SELECT de fees previos resuelve con lo configurado; el upsert registra. */
function fakeSb({ feesYaEnEspejo = new Set() } = {}) {
  const upserts = []
  const makeChain = () => {
    let esSelect = false
    const chain = {}
    chain.select = () => {
      esSelect = true
      return chain
    }
    chain.eq = () => chain
    chain.not = () => chain
    chain.in = () => chain
    chain.upsert = (rows) => {
      upserts.push(...rows)
      return Promise.resolve({ error: null })
    }
    chain.then = (res, rej) => {
      const data = esSelect ? [...feesYaEnEspejo].map((charge_id) => ({ charge_id })) : []
      return Promise.resolve({ data, error: null }).then(res, rej)
    }
    return chain
  }
  return { upserts, from: () => makeChain() }
}

const SYNC_OPTS = { maxPages: 20 }

// ── 1. El bucle de fees respeta el deadline ───────────────────────────────────

test('fees: el bucle consulta el reloj y se detiene al agotarse el presupuesto', async () => {
  const mock = mockStripe({ latenciaFeeMs: 30 })
  try {
    const t0 = Date.now()
    const { fees, deadlineReached } = await fetchStripeFeesForChargeIds(
      'sk',
      null,
      Array.from({ length: 500 }, (_, i) => `ch_${i}`),
      { deadline: Date.now() + 6_000, maxFees: 200 }
    )
    const transcurrido = Date.now() - t0
    assert.ok(deadlineReached, '500 pendientes > 200 de tope: queda trabajo para el siguiente turno')
    assert.ok(fees.size < 150, `el reloj cortó el bucle mucho antes del tope de 200 (trajo ${fees.size})`)
    assert.ok(transcurrido < 4_500, 'sin corte por reloj habrían sido ~6 s de llamadas')
  } finally {
    mock.restore()
  }
})

test('fees: sin deadline, el tope maxFees acota el trabajo por turno', async () => {
  const mock = mockStripe({})
  try {
    const { fees, deadlineReached } = await fetchStripeFeesForChargeIds(
      'sk',
      null,
      Array.from({ length: 350 }, (_, i) => `ch_${i}`),
      { maxFees: 100 }
    )
    assert.equal(fees.size, 100)
    assert.equal(deadlineReached, true)
  } finally {
    mock.restore()
  }
})

// ── 2. El corte no pierde el dinero leído ni pisa fees buenos ─────────────────

test('sync: con el bucle de fees cortado, el dinero de la página se escribe IGUAL y truncated se declara', async () => {
  const mock = mockStripe({ latenciaFeeMs: 40 })
  const sb = fakeSb()
  try {
    const r = await syncStripePayments(sb, 't1', 'sk_test', null, {
      ...SYNC_OPTS,
      deadline: Date.now() + 5_500,
    })
    assert.equal(r.written, 100, 'los 100 pagos de la página se persisten aunque el bucle de fees se cortara')
    assert.equal(r.truncated, true, 'el corte por presupuesto se declara, no se vende como completo')
    assert.ok(r.feesPendientes > 0, 'quedan fees pendientes declarados')
    assert.equal(sb.upserts.length, 100, 'el upsert ocurrió: el reintento no empieza de cero')
    const conFee = sb.upserts.filter((f) => f.stripe_fee === 3.24).length
    assert.ok(conFee > 0 && conFee < 100, `el corte fue PARCIAL: ${conFee} fees conseguidos antes del reloj`)
    const sinFee = sb.upserts.filter((f) => f.stripe_fee === undefined).length
    assert.ok(sinFee > 0, 'a las filas sin fee conocido se les OMITE la clave (PostgREST no toca la columna)')
  } finally {
    mock.restore()
  }
})

test('sync: un fee que falla NO pisa el fee bueno del espejo (la clave se omite)', async () => {
  const mock = mockStripe({ feeRotoPara: new Set(['ch_0']) })
  const sb = fakeSb({ feesYaEnEspejo: new Set(['ch_0']) })
  try {
    const r = await syncStripePayments(sb, 't1', 'sk_test', null, SYNC_OPTS)
    assert.equal(r.written, 100)
    assert.equal(r.truncated, false)
    const roto = sb.upserts.find((f) => f.payment_id === 'pi_0')
    assert.ok(!('stripe_fee' in roto), 'el espejo ya tenía ese fee: la clave no se incluye y la columna no se toca')
    const bueno = sb.upserts.find((f) => f.payment_id === 'pi_1')
    assert.equal(bueno.stripe_fee, 3.24, 'los demás fees se escriben con su valor real')
  } finally {
    mock.restore()
  }
})

test('sync: sin corte, un pago nuevo sin fee conocido se escribe con NULL honesto (fallback del motor)', async () => {
  const mock = mockStripe({ feeRotoPara: new Set(['ch_0']) })
  const sb = fakeSb()
  try {
    const r = await syncStripePayments(sb, 't1', 'sk_test', null, SYNC_OPTS)
    assert.equal(r.truncated, false)
    const roto = sb.upserts.find((f) => f.payment_id === 'pi_0')
    assert.equal(roto.stripe_fee, null, 'sin corte y sin fee previo: NULL explícito, el motor usa su fallback')
  } finally {
    mock.restore()
  }
})

// ── 3. Eficiencia: los fees ya en el espejo no se re-piden a Stripe ───────────

test('sync: los fees ya presentes en el espejo no generan llamadas a Stripe', async () => {
  const mock = mockStripe({})
  const sb = fakeSb({ feesYaEnEspejo: new Set(Array.from({ length: 100 }, (_, i) => `ch_${i}`)) })
  try {
    await syncStripePayments(sb, 't1', 'sk_test', null, SYNC_OPTS)
    assert.equal(mock.feeCount, 0, 'todos los fees estaban en el espejo: cero llamadas de fee')
    assert.equal(mock.listCount, 1, 'el listado de pagos sí se hace')
  } finally {
    mock.restore()
  }
})

// ── 4. Guarda estática: el presupuesto es real, no decorativo ──────────────────

test('guarda: el bucle de fees consulta el reloj y las rutas declaran fees_pendientes', async () => {
  const { readFileSync } = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const aqui = dirname(fileURLToPath(import.meta.url))
  const read = (p) => readFileSync(join(aqui, '..', p), 'utf8')

  const fees = read('lib/finance/stripeFees.ts')
  assert.match(fees, /Date\.now\(\) >= opts\.deadline/, 'el bucle de fees consulta el deadline antes de cada llamada')
  assert.match(fees, /SAFETY_MARGIN_MS/, 'deja margen para responder antes del corte del runtime')

  const sync = read('lib/finance/stripePaymentsSync.ts')
  assert.match(sync, /fetchStripeFeesForChargeIds/, 'el sync usa el bucle deadline-aware')
  assert.match(
    sync,
    /truncated: truncated \|\| deadlineReached/,
    'el corte del bucle de fees se declara como truncated'
  )
  assert.match(sync, /feesPendientes/, 'el sync reporta los fees que quedaron pendientes')

  const cron = read('app/api/[tenant]/evergreen/cron/stripe-payments/route.ts')
  assert.match(cron, /fees_pendientes/, 'el cron declara fees_pendientes en el detail del run')
  const manual = read('app/api/[tenant]/evergreen/stripe-payments-sync/route.ts')
  assert.match(manual, /fees_pendientes/, 'la ruta manual declara fees_pendientes en el detail del run')
})
