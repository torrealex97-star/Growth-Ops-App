import assert from 'node:assert/strict'
import test from 'node:test'
import { decideMatch, MATCH_WINDOW_MINUTES, TIE_MARGIN_MINUTES } from '../../lib/fathom/match.ts'

const T = (iso) => new Date(iso).toISOString()
const base = '2026-09-10T10:00:00.000Z'
const shift = (minutes) => T(new Date(new Date(base).getTime() + minutes * 60000).toISOString())

const meeting = (over = {}) => ({
  fathomMeetingId: 'https://fathom.video/share/abc',
  startedAt: base,
  email: 'lead@example.com',
  ...over,
})

// ── El caso que causaba la corrupción de datos ──────────────────────────────
// Antes, dos citas candidatas => la transcripción se escribía en LAS DOS, el mismo
// fathom_meeting_id quedaba en las dos, y el re-sync siguiente parecía idempotente habiendo
// dejado una fila con una llamada que no ocurrió ahí.
test('dos citas igual de cerca NO se emparejan: van a revisión', () => {
  const d = decideMatch(meeting(), [
    { id: 'a', appointmentDatetime: shift(-10) },
    { id: 'b', appointmentDatetime: shift(+10) },
  ])
  assert.equal(d.kind, 'ambigua')
  assert.deepEqual(d.candidateIds.sort(), ['a', 'b'])
  assert.match(d.reason, /adivinar/)
})

test('un candidato claramente más cercano sí se empareja', () => {
  const d = decideMatch(meeting(), [
    { id: 'cerca', appointmentDatetime: shift(+2) },
    { id: 'lejos', appointmentDatetime: shift(+80) },
  ])
  assert.equal(d.kind, 'match')
  assert.equal(d.appointmentId, 'cerca')
  assert.equal(d.via, 'email_y_hora')
})

test('el identificador de Fathom manda sobre la proximidad', () => {
  // Aunque otra cita esté más cerca en el tiempo, si la reunión ya está estampada en una, es esa.
  const d = decideMatch(meeting(), [
    { id: 'estampada', appointmentDatetime: shift(+60), fathomMeetingId: 'https://fathom.video/share/abc' },
    { id: 'mas_cerca', appointmentDatetime: shift(+1) },
  ])
  assert.equal(d.kind, 'ya_importada')
  assert.equal(d.appointmentId, 'estampada')
})

test('fuera de la ventana no hay emparejamiento, ni el más cercano vale', () => {
  const d = decideMatch(meeting(), [{ id: 'a', appointmentDatetime: shift(MATCH_WINDOW_MINUTES + 1) }])
  assert.equal(d.kind, 'sin_candidatos')
  assert.match(d.reason, new RegExp(String(MATCH_WINDOW_MINUTES)))
})

test('el borde de la ventana entra', () => {
  const d = decideMatch(meeting(), [{ id: 'a', appointmentDatetime: shift(MATCH_WINDOW_MINUTES) }])
  assert.equal(d.kind, 'match')
})

test('el margen de empate se respeta justo por encima y por debajo', () => {
  // Diferencia entre candidatos justo por debajo del margen => empate.
  const empate = decideMatch(meeting(), [
    { id: 'a', appointmentDatetime: shift(1) },
    { id: 'b', appointmentDatetime: shift(1 + TIE_MARGIN_MINUTES - 1) },
  ])
  assert.equal(empate.kind, 'ambigua')
  // Justo por encima => hay un ganador claro.
  const claro = decideMatch(meeting(), [
    { id: 'a', appointmentDatetime: shift(1) },
    { id: 'b', appointmentDatetime: shift(1 + TIE_MARGIN_MINUTES + 1) },
  ])
  assert.equal(claro.kind, 'match')
  assert.equal(claro.appointmentId, 'a')
})

test('tres candidatos empatados se listan todos para revisión, no se elige el primero', () => {
  const d = decideMatch(meeting(), [
    { id: 'a', appointmentDatetime: shift(-5) },
    { id: 'b', appointmentDatetime: shift(0) },
    { id: 'c', appointmentDatetime: shift(+5) },
  ])
  assert.equal(d.kind, 'ambigua')
  assert.equal(d.candidateIds.length, 3)
})

test('sin hora, sin email o sin candidatos no se inventa nada', () => {
  assert.equal(
    decideMatch(meeting({ startedAt: null }), [{ id: 'a', appointmentDatetime: base }]).kind,
    'sin_candidatos'
  )
  assert.equal(decideMatch(meeting({ email: null }), [{ id: 'a', appointmentDatetime: base }]).kind, 'sin_candidatos')
  assert.equal(decideMatch(meeting(), []).kind, 'sin_candidatos')
})

test('sin identificador de Fathom todavía se puede emparejar por hora', () => {
  const d = decideMatch(meeting({ fathomMeetingId: null }), [{ id: 'a', appointmentDatetime: shift(3) }])
  assert.equal(d.kind, 'match')
  assert.equal(d.via, 'email_y_hora')
})

test('la decisión nunca devuelve más de un appointmentId para escribir', () => {
  // Invariante central: si hay duda, no hay escritura. Nunca "escribe en todas".
  const casos = [
    [
      { id: 'a', appointmentDatetime: shift(-10) },
      { id: 'b', appointmentDatetime: shift(+10) },
    ],
    [{ id: 'a', appointmentDatetime: shift(2) }],
    [],
  ]
  for (const candidatos of casos) {
    const d = decideMatch(meeting({ fathomMeetingId: null }), candidatos)
    if (d.kind === 'match' || d.kind === 'ya_importada') {
      assert.equal(typeof d.appointmentId, 'string')
      assert.ok(!Array.isArray(d.appointmentId))
    } else {
      assert.ok(d.kind === 'ambigua' || d.kind === 'sin_candidatos')
    }
  }
})
