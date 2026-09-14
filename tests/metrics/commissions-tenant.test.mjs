import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateCommissionsForCollection,
  calculateNegativeCommissionsForRefund,
} from '../../lib/commissions/calculator.ts'
import { generateCommissionsForCollection } from '../../lib/commissions/generate.ts'

// Este módulo se quedó FUERA de la migración multi-tenant: no aparecía `tenant_id` ni una vez.
// Con service-role (que salta RLS) eso significaba insertar comisiones sin tenant_id — columna
// NOT NULL, así que el insert fallaba SIEMPRE — con el error descartado y devolviendo el nº de
// comisiones calculadas. La pantalla decía "3 comisiones generadas" con cero filas escritas.

const TENANT = '11111111-1111-1111-1111-111111111111'

const collection = (over = {}) => ({
  id: 'col-1',
  sale_id: 'sale-1',
  collected_at: '2026-09-01T10:00:00Z',
  gross_amount: 1000,
  commissionable_amount: 1000,
  ...over,
})

const sale = (over = {}) => ({
  id: 'sale-1',
  setter_id: 'user-setter',
  closer_id: 'user-closer',
  affiliate_id: null,
  affiliate_commission_percent: null,
  ...over,
})

test('cada comisión calculada lleva la subcuenta estampada', () => {
  const rows = calculateCommissionsForCollection(TENANT, collection(), sale(), [])
  assert.equal(rows.length, 2)
  for (const r of rows) assert.equal(r.tenant_id, TENANT, `${r.participant_type} sin tenant_id`)
})

test('también la del afiliado, que es otra rama del cálculo', () => {
  const rows = calculateCommissionsForCollection(
    TENANT,
    collection(),
    sale({ setter_id: null, closer_id: null, affiliate_id: 'user-afiliado', affiliate_commission_percent: 20 }),
    []
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].participant_type, 'affiliate')
  assert.equal(rows[0].tenant_id, TENANT)
})

test('la comisión negativa de una devolución hereda la subcuenta de la que espeja', () => {
  const existing = [
    {
      id: 'com-1',
      tenant_id: TENANT,
      sale_id: 'sale-1',
      collection_id: 'col-1',
      user_id: 'user-closer',
      participant_type: 'closer',
      percent: 10,
      base_amount: 1000,
      commission_amount: 100,
      direction: 'positive',
      status: 'pending',
    },
  ]
  const refund = { id: 'ref-1', sale_id: 'sale-1', commissionable_refund_amount: 500 }
  const negativas = calculateNegativeCommissionsForRefund(refund, existing)
  assert.equal(negativas.length, 1)
  assert.equal(negativas[0].tenant_id, TENANT)
  assert.equal(negativas[0].direction, 'negative')
})

// ── Supabase de mentira: registra los filtros aplicados y lo insertado ──────────────────────────
function fakeSb({ insertError = null, insertReturns } = {}) {
  const log = { filters: [], inserted: [], tablas: [] }
  const builder = (table) => {
    const chain = {
      select: () => chain,
      eq: (col, val) => {
        log.filters.push(`${table}.${col}=${val}`)
        return chain
      },
      neq: () => chain,
      in: () => chain,
      or: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      insert: (rows) => {
        log.inserted.push(...(Array.isArray(rows) ? rows : [rows]))
        return {
          select: async () => ({
            data: insertError
              ? null
              : (insertReturns ?? (Array.isArray(rows) ? rows : [rows])).map((_, i) => ({ id: `new-${i}` })),
            error: insertError,
          }),
        }
      },
      upsert: async () => ({ error: null }),
      delete: () => chain,
      then: (res) => Promise.resolve({ data: [], error: null }).then(res),
    }
    return chain
  }
  return {
    log,
    from(table) {
      log.tablas.push(table)
      return builder(table)
    },
  }
}

test('devuelve las comisiones ESCRITAS, no las calculadas', async () => {
  const sb = fakeSb()
  const n = await generateCommissionsForCollection(sb, TENANT, collection(), sale())
  assert.equal(n, 2)
  // Y todo lo insertado lleva la subcuenta.
  assert.ok(sb.log.inserted.length > 0)
  for (const row of sb.log.inserted) assert.equal(row.tenant_id, TENANT)
})

test('un insert que falla se propaga: nunca más "3 comisiones generadas" con 0 filas', async () => {
  const sb = fakeSb({ insertError: { message: 'null value in column "tenant_id"' } })
  await assert.rejects(
    () => generateCommissionsForCollection(sb, TENANT, collection(), sale()),
    /No se pudieron generar las comisiones/
  )
})

test('cada lectura de comisiones y cobros va acotada a la subcuenta', async () => {
  const sb = fakeSb()
  await generateCommissionsForCollection(sb, TENANT, collection(), sale())
  const filtros = sb.log.filters.join('\n')
  assert.match(filtros, new RegExp(`commission_rules\\.tenant_id=${TENANT}`))
  assert.match(filtros, new RegExp(`collections\\.tenant_id=${TENANT}`))
  assert.match(filtros, new RegExp(`refunds\\.tenant_id=${TENANT}`))
  assert.match(filtros, new RegExp(`commissions\\.tenant_id=${TENANT}`))
})

test('sin nadie a quien comisionar no se escribe nada', async () => {
  const sb = fakeSb()
  const n = await generateCommissionsForCollection(sb, TENANT, collection(), sale({ setter_id: null, closer_id: null }))
  assert.equal(n, 0)
  assert.equal(sb.log.inserted.length, 0)
})
