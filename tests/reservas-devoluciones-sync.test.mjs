import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncReservationRefunds } from '../lib/finance/reservationRefundSync.ts'

// REGRESIÓN — devoluciones de reserva hechas directamente en Stripe (4-oct).
//
// Síntoma medido: la reserva del 14-sep estaba devuelta en Stripe (refunded_amount = 50) y en la
// app seguía 20 días después como venta 'active' con cobro 'collected': la bandeja de reservas
// la contaba como dinero en cuenta. El flujo propio de la app concilia; el dinero devuelto FUERA
// de la app nunca entraba.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const src = read('lib/finance/reservationRefundSync.ts')

// Stub thenable de supabase-js: cada método no terminal registra la llamada y devuelve el mismo
// builder; `await` resuelve con handlers[table](chain). Los handlers distinguen la operación por
// la cadena (select/insert/update/…), igual que PostgRESTBuilder resuelve al esperarse.
function stubSB(handlers, calls = []) {
  function builderFor(table) {
    const chain = []
    const registrar = () => calls.push({ table, ops: chain.map((c) => c[0]) })
    const proxy = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (onOk, onErr) => {
              registrar()
              const h = handlers[table]
              if (!h) return Promise.reject(new Error(`sin handler para ${table}`)).then(onOk, onErr)
              return Promise.resolve(h(chain)).then(onOk, onErr)
            }
          }
          if (typeof prop === 'symbol') return undefined
          return (...args) => {
            chain.push([prop, args])
            return proxy
          }
        },
      }
    )
    return proxy
  }
  return { from: (table) => builderFor(table) }
}

// PostgREST entrega `collections!inner` como ARRAY de una fila (1:1 por el inner join).
const cobroCollected = { id: 'c1', payment_reference: 'pi_1', status: 'collected', gross_amount: 50 }
const reservaCola = { id: 's1', gross_amount: 50, refund_deadline_at: '2026-09-29', collections: [cobroCollected] }

function sbBase(sobrescribe = {}) {
  const calls = []
  const inserts = []
  const updates = []
  const audits = []
  const handlers = {
    sales: (chain) => {
      if (chain[0][0] === 'select') return { data: [reservaCola], error: null }
      if (chain[0][0] === 'update') {
        updates.push({ patch: chain[0][1][0] })
        return { data: null, error: null }
      }
      throw new Error('op inesperada en sales')
    },
    stripe_payments: () => ({
      data: [
        {
          payment_id: 'pi_1',
          charge_id: 'ch_1',
          refunded_amount: 50,
          status: 'refunded',
          paid_at: '2026-09-20T10:00:00Z',
        },
      ],
      error: null,
    }),
    commissions: (chain) => {
      const opts = chain[0][1]?.[0]
      return { data: [], error: null, count: opts?.count === 'exact' ? 0 : null }
    },
    refunds: (chain) => {
      inserts.push(chain[0][1][0])
      return { data: { id: 'r1' }, error: null }
    },
    audit_logs: (chain) => {
      audits.push(chain[0][1][0])
      return { data: null, error: null }
    },
    collections: (chain) => {
      if (chain[0][0] === 'update') {
        updates.push({ table: 'collections', patch: chain[0][1][0] })
        return { data: null, error: null }
      }
      throw new Error('op inesperada en collections')
    },
    ...sobrescribe,
  }
  return { sb: stubSB(handlers, calls), calls, inserts, updates, audits }
}

test('solo toca reservas abiertas con su cobro collected (el universo de la bandeja)', () => {
  assert.ok(src.includes(".eq('payment_plans.method', 'reserva')"))
  assert.ok(src.includes(".is('reservation_completed_at', null)"))
  assert.ok(src.includes(".eq('status', 'active')"))
  assert.ok(src.includes(".eq('collections.status', 'collected')"))
})

test('la fila en refunds nace sin actor humano y con la verdad de Stripe', () => {
  assert.ok(src.includes('created_by: null'), 'una devolución de Stripe no se atribuye a nadie')
  assert.ok(src.includes("reason: 'Reserva reembolsada en Stripe'"))
  assert.ok(src.includes('commissionable_refund_amount: 0'), 'no se inventa base comisionable')
})

test('con comisiones o devolución parcial: señala para revisión, no absorbe', async () => {
  // Parcial: 20 de 50 devueltos
  const parcial = sbBase({
    stripe_payments: () => ({
      data: [
        {
          payment_id: 'pi_1',
          charge_id: 'ch_1',
          refunded_amount: 20,
          status: 'partially_refunded',
          paid_at: '2026-09-20T10:00:00Z',
        },
      ],
      error: null,
    }),
  })
  const r1 = await syncReservationRefunds(parcial.sb, 't1')
  assert.equal(r1.absorbed, 0)
  assert.equal(r1.flagged, 1)
  assert.equal(parcial.inserts.length, 0, 'lo parcial NO inserta refund')

  // Con comisiones existentes
  const conComisiones = sbBase({
    commissions: (chain) => {
      const opts = chain[0][1]?.[1]
      return { data: [], error: null, count: opts?.count === 'exact' ? 2 : null }
    },
  })
  const r2 = await syncReservationRefunds(conComisiones.sb, 't1')
  assert.equal(r2.absorbed, 0)
  assert.equal(r2.flagged, 1)
  assert.equal(conComisiones.inserts.length, 0, 'con comisiones NO absorbe: requiere revisión')
  const flag = conComisiones.updates.find((u) => u.table === 'collections')
  assert.ok(flag && flag.patch.needs_commission_review === true, 'el cobro queda señalado')
})

test('absorción end-to-end: refund con fecha de Stripe, venta fuera de la bandeja, auditoría sin actor', async () => {
  const t = sbBase()
  const res = await syncReservationRefunds(t.sb, 't1')
  assert.equal(res.absorbed, 1)
  assert.equal(res.flagged, 0)
  assert.equal(t.inserts.length, 1)
  assert.equal(t.inserts[0].created_by, null)
  assert.equal(t.inserts[0].gross_refund_amount, 50)
  assert.equal(t.inserts[0].refund_date, '2026-09-20', 'fecha de Stripe, no la de hoy')
  assert.ok(t.audits.length === 1 && t.audits[0].actor_user_id === null, 'auditoría sin actor atribuido')
  const saleUpdate = t.updates.find((u) => !u.table && u.patch.status === 'refunded')
  assert.ok(saleUpdate, 'la venta queda marcada refunded → fuera de la bandeja de reservas')
})

test('un espejo caído no absorbe nada (un hueco no es una devolución)', async () => {
  const calls = []
  const sb = stubSB(
    {
      sales: (chain) => (chain[0][0] === 'select' ? { data: [reservaCola], error: null } : { data: null, error: null }),
      stripe_payments: () => ({ data: null, error: { message: 'boom' } }),
    },
    calls
  )
  await assert.rejects(() => syncReservationRefunds(sb, 't1'), /No se pudo leer el espejo/)
  assert.ok(!calls.some((c) => c.table === 'refunds'), 'sin espejo no hay insert en refunds')
})

test('cobro sin devolución en Stripe: no toca nada', async () => {
  const t = sbBase({
    stripe_payments: () => ({
      data: [
        {
          payment_id: 'pi_1',
          charge_id: 'ch_1',
          refunded_amount: 0,
          status: 'succeeded',
          paid_at: '2026-09-01T10:00:00Z',
        },
      ],
      error: null,
    }),
  })
  const res = await syncReservationRefunds(t.sb, 't1')
  assert.equal(res.absorbed, 0)
  assert.equal(res.flagged, 0)
  assert.equal(t.inserts.length, 0)
  assert.equal(t.updates.length, 0)
})
