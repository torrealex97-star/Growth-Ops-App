import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { sanitizeWatchIntervals, secondsFromIntervals } from '../lib/vsl/tracking.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('intervalos: conserva reproducción real y no rellena un salto', () => {
  const intervals = sanitizeWatchIntervals([
    { start: 10, end: 10.8, rate: 1 },
    { start: 600, end: 600.7, rate: 1 },
  ])
  assert.deepEqual(intervals, [
    { start: 10, end: 10.8, rate: 1 },
    { start: 600, end: 600.7, rate: 1 },
  ])
  assert.deepEqual(secondsFromIntervals(intervals), [10, 600])
})

test('intervalos: rechaza rangos imposibles o demasiado largos', () => {
  assert.deepEqual(
    sanitizeWatchIntervals([
      { start: -1, end: 1, rate: 1 },
      { start: 1, end: 9, rate: 1 },
      { start: 4, end: 3, rate: 1 },
      { start: 2, end: 3, rate: 9 },
    ]),
    []
  )
})

test('player manda playback, eventos idempotentes e intervalos por lotes', () => {
  const player = read('components/vsl/VslPlayer.tsx')
  assert.match(player, /playbackId: playbackRef\.current/)
  assert.match(player, /pendingIntervalsRef/)
  assert.match(player, /document\.visibilityState === 'visible'/)
  assert.match(player, /mediaDelta <= plausibleDelta/)
  assert.match(player, /sendBeat\('seek'\)/)
})

test('API valida playback contra la sesión legacy antes del dual-write', () => {
  const route = read('app/api/vsl/track/route.ts')
  assert.match(route, /playback_id = \$\{playbackId\} AND legacy_session_id = \$\{sessionId\}/)
  assert.match(route, /ON CONFLICT \(tenant_id, event_id\) DO NOTHING/)
  assert.match(route, /ON CONFLICT \(tenant_id, playback_id, batch_id, sequence_number\) DO NOTHING/)
})

test('métricas prefieren intervalos precisos y declaran el fallback histórico', () => {
  const route = read('app/api/[tenant]/evergreen/vsl/metrics/[slug]/route.ts')
  const dashboard = read('components/vsl/VslDashboard.tsx')
  assert.match(route, /precisionPlaybacks > 0 \? precisionRows : legacyRows/)
  assert.match(route, /Histórico aproximado anterior al tracking por intervalos/)
  assert.match(route, /generate_series/)
  assert.match(dashboard, /Heatmaps recientes/)
  assert.match(dashboard, /los huecos son segundos no vistos/)
})

test('identify enlaza con CRM solo por email exacto dentro del tenant', () => {
  const route = read('app/api/vsl/identify/route.ts')
  assert.match(route, /tenant_id = \$\{sess\.tenant_id\} AND lower\(email\) = \$\{cleanEmail\}/)
  assert.match(route, /verified_form_email/)
  assert.match(route, /video_viewer_identified/)
  assert.match(route, /ON CONFLICT \(tenant_id, viewer_id, contact_id\)/)
})
