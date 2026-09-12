import assert from 'node:assert/strict'
import test from 'node:test'
import { buildContactTimeline } from '../../lib/contact-timeline.ts'

// Dataset dorado: atribución → agenda → transcripción → venta → nota, con fechas que fuerzan un
// reordenamiento (las filas no llegan ya ordenadas cronológicamente desde cada tabla).
const attributions = [
  {
    id: 'attr1',
    first_touch_at: '2026-02-03T10:14:00Z',
    created_at: '2026-02-03T10:14:00Z',
    source: 'meta',
    utm_source: 'facebook',
    utm_campaign: 'camp1',
  },
]
const appointments = [
  {
    id: 'appt1',
    appointment_datetime: '2026-02-06T16:00:00Z',
    status: 'show',
    external_source: 'calendly',
    transcript: 'hola...',
    ai_summary: 'Resumen de la llamada',
    updated_at: '2026-02-06T17:12:00Z',
  },
]
const sales = [{ id: 'sale1', sale_date: '2026-02-10T09:20:00Z', status: 'active', gross_amount: 1997 }]
const notes = [
  { id: 'note1', note: 'Cliente muy interesado', created_at: '2026-02-07T12:30:00Z', author: { full_name: 'Ana' } },
]

test('buildContactTimeline ordena cronológicamente eventos de fuentes distintas', () => {
  const timeline = buildContactTimeline(attributions, appointments, sales, notes)
  assert.deepEqual(
    timeline.map((e) => e.type),
    ['attribution', 'appointment', 'transcript', 'note', 'sale']
  )
  assert.equal(timeline[0].occurredAt, '2026-02-03T10:14:00Z')
  assert.equal(timeline.at(-1).occurredAt, '2026-02-10T09:20:00Z')
})

test('buildContactTimeline separa occurred_at (la llamada) de la ingesta de la transcripción', () => {
  const timeline = buildContactTimeline([], appointments, [], [])
  const call = timeline.find((e) => e.type === 'appointment')
  const transcript = timeline.find((e) => e.type === 'transcript')
  assert.equal(call.occurredAt, '2026-02-06T16:00:00Z')
  assert.equal(transcript.occurredAt, '2026-02-06T17:12:00Z') // updated_at, no la fecha de la reunión
  assert.equal(transcript.transcriptRef, 'appt1')
})

test('buildContactTimeline no genera evento de transcripción si no hay transcript', () => {
  const noTranscript = [{ ...appointments[0], transcript: null }]
  const timeline = buildContactTimeline([], noTranscript, [], [])
  assert.equal(
    timeline.some((e) => e.type === 'transcript'),
    false
  )
})
