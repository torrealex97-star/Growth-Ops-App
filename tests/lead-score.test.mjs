import assert from 'node:assert/strict'
import test from 'node:test'
import { appointmentLeadScore, leadScoreBand, qualificationLeadScore } from '../lib/appointments/lead-score.ts'

test('prioriza el score de IA cuando existe', () => {
  assert.equal(appointmentLeadScore({ ai_lead_score: 8, qualification: { compromiso: '1' } }), 80)
})

test('calcula un score explicable con compromiso, ingresos e inversión', () => {
  const high = qualificationLeadScore({
    compromiso: '9',
    ingresos: '3.500 €',
    inversion: '2.000 €',
    confirma_asistencia: 'Sí, confirmado',
    vio_vsl: 'Sí, completo',
  })
  const low = qualificationLeadScore({
    compromiso: '2',
    ingresos: '500 €',
    inversion: '0 €',
    confirma_asistencia: 'No estoy seguro',
  })
  assert.ok(high !== null && low !== null && high > low)
  assert.equal(leadScoreBand(high), 'hot')
  assert.equal(leadScoreBand(low), 'cold')
})

test('sin señales no inventa una puntuación', () => {
  assert.equal(qualificationLeadScore({ respuestas: [] }), null)
})
