import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extraerCodigoRef,
  attributionDateBeforeCutoff,
  COLLABORATOR_ATTRIBUTION_CUTOFF_ISO,
} from '../lib/collaborators/ref-signal.ts'

// -----------------------------------------------------------------------------
// SEÑAL DE REFERIDO (?ref=) — reglas en un módulo compartido (hallazgo 21-sep):
// el código del colaborador debe poder llegar por CAMPO PERSONALIZADO de GHL
// (cuentas con varias colaboradoras) y NADA puede atribuir contactos
// ANTERIORES A AGOSTO 2026 (cutoff del propietario: de agosto para atrás, no).
// -----------------------------------------------------------------------------

test('extrae el código del parámetro ?ref= plano', () => {
  assert.equal(extraerCodigoRef({ ref: 'nu8bprex' }), 'NU8BPREX')
  assert.equal(extraerCodigoRef({ referral: 'Z7HQGPKJ' }), 'Z7HQGPKJ')
  assert.equal(extraerCodigoRef({ colaborador: 'EPAXUBU4' }), 'EPAXUBU4')
})

test('extrae el código de un campo personalizado de GHL (objeto, array y Q&A)', () => {
  // customData como objeto {nombre: valor} — la forma del overwrite() del webhook
  assert.equal(extraerCodigoRef({ customData: { colaborador: 'nu8bprex' } }), 'NU8BPREX')
  assert.equal(extraerCodigoRef({ customData: { Codigo: 'Z7HQGPKJ' } }), 'Z7HQGPKJ')
  // customFields como array [{name, value}]
  assert.equal(extraerCodigoRef({ customFields: [{ name: 'Ref', value: 'EPAXUBU4' }] }), 'EPAXUBU4')
  assert.equal(extraerCodigoRef({ custom_fields: [{ label: 'colaboradora', value: 'Z7HQGPKJ' }] }), 'Z7HQGPKJ')
  // questions_and_answers [{question, answer}]
  assert.equal(extraerCodigoRef({ questions_and_answers: [{ question: 'ref', answer: 'NU8BPREX' }] }), 'NU8BPREX')
})

test('ignora campos que no son un referido o no tienen forma de código', () => {
  assert.equal(extraerCodigoRef({ customData: { nombre: 'NU8BPREX' } }), null)
  assert.equal(extraerCodigoRef({ customData: { ref: 'hola mundo' } }), null)
  assert.equal(extraerCodigoRef({ customData: { ref: '123' } }), null) // < 4 chars
  assert.equal(extraerCodigoRef({}), null)
  assert.equal(extraerCodigoRef(null), null)
})

test('cutoff: contactos anteriores a agosto 2026 quedan fuera, agosto y después entran', () => {
  assert.equal(COLLABORATOR_ATTRIBUTION_CUTOFF_ISO, '2026-08-01T00:00:00.000Z')
  // Julio (día antes del cutoff) → fuera. Primer minuto de agosto → dentro.
  assert.equal(attributionDateBeforeCutoff({ first_seen_at: '2026-07-31T23:59:59Z' }), true)
  assert.equal(attributionDateBeforeCutoff({ first_seen_at: '2026-08-01T00:00:00Z' }), false)
  assert.equal(attributionDateBeforeCutoff({ first_seen_at: '2026-09-12T10:00:00Z' }), false)
  // Sin fecha legible → NO se considera anterior (contactos nuevos siguen entrando).
  assert.equal(attributionDateBeforeCutoff({}), false)
  assert.equal(attributionDateBeforeCutoff({ first_seen_at: null }), false)
  // created_at como fallback y objetos Date (lo que devuelve postgres.js).
  assert.equal(attributionDateBeforeCutoff({ created_at: '2026-05-10T00:00:00Z' }), true)
  assert.equal(attributionDateBeforeCutoff({ first_seen_at: new Date('2026-06-01T00:00:00Z') }), true)
})
