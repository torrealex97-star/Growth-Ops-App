import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeMetaActions, aggregateActions, calcMeta, divMeta } from '../../lib/meta/actions.ts'

// ── REGLA DE ORO (§7): 0 ≠ NULL ──────────────────────────────────────────────

test('actions[] vacío → objeto presente (0 confirmado por Meta)', () => {
  const r = normalizeMetaActions([])
  assert.deepEqual(r, {})
})

test('fila sin columna actions → null (Meta no devolvió la métrica)', () => {
  assert.equal(aggregateActions([{ metaActions: null }]), null)
  assert.equal(aggregateActions([]), null)
})

test('mezcla de días con y sin actions → los días sin actions NO introducen ceros', () => {
  // Día 1: Meta devolvió 5 leads. Día 2: Meta no devolvió actions[].
  const agg = aggregateActions([{ metaActions: { lead: 5 } }, { metaActions: null }])
  assert.deepEqual(agg, { lead: 5 })
})

test('dos días con leads se suman', () => {
  const agg = aggregateActions([{ metaActions: { lead: 3 } }, { metaActions: { lead: 4, purchase: 1 } }])
  assert.deepEqual(agg, { lead: 7, purchase: 1 })
})

test('action_types desconocidos se ignoran sin romper', () => {
  const r = normalizeMetaActions([
    { action_type: 'some_future_action', value: 99 },
    { action_type: 'lead', value: 2 },
  ])
  assert.deepEqual(r, { lead: 2 })
})

test('aliases de píxel y onsite se normalizan a la métrica interna', () => {
  const r = normalizeMetaActions([
    { action_type: 'offsite_conversion.fb_pixel_lead', value: 1 },
    { action_type: 'onsite_conversion.lead_grouped', value: 2 },
    { action_type: 'landing_page_view', value: 10 },
  ])
  assert.deepEqual(r, { lead: 3, landing_page_view: 10 })
})

// ── Métricas calculadas SOLO con datos Meta (§8) ────────────────────────────

test('divMeta: divisor 0 o ausente → null (nunca 0)', () => {
  assert.equal(divMeta(100, 0), null)
  assert.equal(divMeta(null, 5), null)
  assert.equal(divMeta(100, null), null)
  assert.equal(divMeta(100, 4), 25)
})

test('calcMeta con base completa: fórmulas canónicas', () => {
  const c = calcMeta({
    spend: 1000,
    impressions: 50000,
    reach: 30000,
    linkClicks: 500,
    actions: { landing_page_view: 450, lead: 30, schedule: 10, purchase: 2 },
    actionValues: { purchase: 4200 },
  })
  assert.equal(c.cpm, 20) // 1000/50000*1000
  assert.equal(c.cpc, 2) // 1000/500
  assert.equal(c.ctr, 1) // 500/50000*100
  assert.equal(c.costPerLpv, 1000 / 450)
  assert.equal(c.cpl, 1000 / 30)
  assert.equal(c.costPerSchedule, 100)
  assert.equal(c.costPerPurchase, 500)
  assert.equal(c.roas, 4.2)
  assert.equal(c.lpvRate, (450 / 500) * 100)
  assert.equal(c.leadRate, (30 / 450) * 100)
})

test('calcMeta: array presente sin esa acción → 0 confirmado; cpl indefinido → null', () => {
  const c = calcMeta({
    spend: 500,
    impressions: 10000,
    reach: 8000,
    linkClicks: 100,
    actions: {}, // array presente pero sin acciones de tipos conocidos: Meta midió y no hubo
    actionValues: null,
  })
  assert.equal(c.leads, 0) // 0 real, no "no disponible"
  assert.equal(c.cpl, null) // spend/0 es indefinido: no puede ser "€0 por lead"
})

test('calcMeta: actions null (Meta no lo devolvió) → métricas null', () => {
  const c = calcMeta({
    spend: 500,
    impressions: 10000,
    reach: 8000,
    linkClicks: 100,
    actions: null,
    actionValues: null,
  })
  assert.equal(c.leads, null)
  assert.equal(c.lpv, null)
  assert.equal(c.cpl, null)
  assert.equal(c.purchases, null)
  assert.equal(c.roas, null)
  // Tráfico sí está (columnas simples de la API):
  assert.equal(c.cpm, 50)
  assert.equal(c.cpc, 5)
})

test('ROAS sin purchase value → null, no 0', () => {
  const c = calcMeta({
    spend: 500,
    impressions: 1,
    reach: 1,
    linkClicks: 1,
    actions: { purchase: 3 },
    actionValues: null,
  })
  assert.equal(c.purchases, 3)
  assert.equal(c.roas, null) // sin action_values no hay ROAS (§8/§35)
})
