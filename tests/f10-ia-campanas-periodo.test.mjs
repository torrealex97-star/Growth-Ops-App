import assert from 'node:assert/strict'
import test from 'node:test'
import { AVISO_ACUMULADOS, campanasDelPeriodo } from '../lib/ads/campanas-periodo.ts'

const camp = (id, extra = {}) => ({
  id,
  name: id,
  adspend: 9999,
  impressions: 9999,
  clicks: 9999,
  meta_leads: 999,
  reach: 999,
  link_clicks: 999,
  landing_views: 999,
  ...extra,
})
const dia = (campaign_id, date, spend, extra = {}) => ({
  campaign_id,
  date,
  spend,
  impressions: 100,
  clicks: 10,
  leads: 2,
  reach: 80,
  link_clicks: 8,
  landing_views: 5,
  ...extra,
})

test('con periodo, el gasto es la suma diaria del periodo y no el acumulado de la campaña', () => {
  const r = campanasDelPeriodo(
    [camp('a'), camp('b')],
    [
      dia('a', '2026-09-01', 10),
      dia('a', '2026-09-02', '15.5'),
      dia('a', '2026-08-31', 100),
      dia('b', '2026-10-01', 7),
    ],
    { from: '2026-09-01', to: '2026-09-30' }
  )
  assert.equal(r.campaigns.length, 1)
  assert.equal(r.campaigns[0].id, 'a')
  assert.equal(r.campaigns[0].adspend, 25.5)
  assert.equal(r.campaigns[0].impressions, 200)
  assert.equal(r.campaigns[0].meta_leads, 4)
  assert.equal(r.aviso, AVISO_ACUMULADOS)
})

test('sin periodo se mantiene el acumulado y no hay aviso', () => {
  const r = campanasDelPeriodo([camp('a')], [], {})
  assert.equal(r.campaigns[0].adspend, 9999)
  assert.equal(r.aviso, null)
})

test('una campaña sin actividad diaria en el periodo no aparece (no se inventa gasto)', () => {
  const r = campanasDelPeriodo([camp('a')], [dia('a', '2026-01-01', 5)], { from: '2026-09-01', to: '2026-09-30' })
  assert.deepEqual(r.campaigns, [])
})
