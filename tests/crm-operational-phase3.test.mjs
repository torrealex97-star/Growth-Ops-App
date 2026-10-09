import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { appointmentLeadScore } from '../lib/appointments/lead-score.ts'

test('el score usa el raw_payload histórico cuando qualification está vacío', () => {
  const score = appointmentLeadScore({
    qualification: null,
    external_source: 'calendly',
    raw_payload: {
      invitee: {
        questions_and_answers: [
          { question: 'Compromiso del 1 al 10', answer: '9' },
          { question: 'Ingresos mensuales', answer: 'Más de 3.000€' },
          { question: '¿Puedes invertir?', answer: 'Sí, estoy dispuesta' },
        ],
      },
    },
  })

  assert.equal(score.puntuacion, 90)
  assert.equal(score.nivel, 'alto')
})

test('la columna normalizada tiene prioridad sobre el payload legado', () => {
  const score = appointmentLeadScore({
    qualification: {
      respuestas: [
        { q: 'Compromiso del 1 al 10', a: '3' },
        { q: 'Ingresos mensuales', a: 'Menos de 600€' },
        { q: '¿Puedes invertir?', a: 'No puedo invertir ahora' },
      ],
    },
    external_source: 'calendly',
    raw_payload: {
      invitee: {
        questions_and_answers: [
          { question: 'Compromiso del 1 al 10', answer: '10' },
          { question: 'Ingresos mensuales', answer: 'Más de 3.000€' },
        ],
      },
    },
  })

  assert.equal(score.puntuacion, 12)
  assert.equal(score.nivel, 'bajo')
})

test('calendario y kanban muestran el score y el móvil abre el día actual', () => {
  const calendar = readFileSync('app/[tenant]/crm/agendas/page.tsx', 'utf8')
  const kanban = readFileSync('app/[tenant]/crm/seguimiento/page.tsx', 'utf8')

  assert.match(calendar, /window\.matchMedia\('\(max-width: 767px\)'\)/)
  assert.match(calendar, /setWeekStart\(startOfDay\(new Date\(\)\)\)/)
  assert.match(calendar, /appointmentLeadScore\(appt\)/)
  assert.match(kanban, /appointmentLeadScore\(a\)/)
  assert.match(kanban, /Score \{leadScore\.puntuacion === null/)
})
