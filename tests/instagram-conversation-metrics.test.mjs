import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizarUsuarioIg,
  detectarEnlaceAgendaEnTexto,
  emparejarConConTactos,
  calcularMetricas,
} from '../lib/instagram/conversation-metrics.ts'

function conv(id, participant, messages = [], message_count = messages.length) {
  return { id, participant, messages, message_count, unread_count: 0 }
}

test('normalizarUsuarioIg: quita @, espacios y normaliza a minúsculas', () => {
  assert.equal(normalizarUsuarioIg('@Maria_Winner'), 'maria_winner')
  assert.equal(normalizarUsuarioIg('  Pedro  '), 'pedro')
  assert.equal(normalizarUsuarioIg(''), null)
  assert.equal(normalizarUsuarioIg(null), null)
  assert.equal(normalizarUsuarioIg(undefined), null)
})

test('detectarEnlaceAgendaEnTexto: detecta enlaces típicos de Calendly/Cal.com/GHL, no falsos positivos con texto normal', () => {
  assert.equal(
    detectarEnlaceAgendaEnTexto(conv('1', 'x', [{ from: 'agente', text: 'Aquí tienes: calendly.com/winners/intro' }])),
    true
  )
  assert.equal(
    detectarEnlaceAgendaEnTexto(conv('2', 'x', [{ from: 'agente', text: 'Resérvalo en cal.com/ia-winners' }])),
    true
  )
  assert.equal(
    detectarEnlaceAgendaEnTexto(conv('3', 'x', [{ from: 'lead', text: 'Hola, quiero más info sobre la IA' }])),
    false
  )
  assert.equal(detectarEnlaceAgendaEnTexto(conv('4', 'x', [])), false)
})

test('emparejarConConTactos: encaja por username normalizado, ignora may/min y @', () => {
  const conversations = [conv('c1', '@Maria_Winner'), conv('c2', 'pedro'), conv('c3', 'sin_contacto')]
  const contactos = [
    { id: 'contact-1', instagram: 'maria_winner' },
    { id: 'contact-2', instagram: '@Pedro' },
  ]
  const m = emparejarConConTactos(conversations, contactos)
  assert.equal(m.get('c1'), 'contact-1')
  assert.equal(m.get('c2'), 'contact-2')
  assert.equal(m.get('c3'), null)
})

test('emparejarConConTactos: dos contactos con el mismo username no se pisan (el primero gana, no null)', () => {
  const conversations = [conv('c1', 'duplicado')]
  const contactos = [
    { id: 'primero', instagram: 'duplicado' },
    { id: 'segundo', instagram: 'duplicado' },
  ]
  const m = emparejarConConTactos(conversations, contactos)
  assert.equal(m.get('c1'), 'primero')
})

test('calcularMetricas: solo cuenta agenda/venta cuando hay contacto vinculado con evidencia real en BD', () => {
  const conversations = [
    conv('c1', 'maria_winner', [{ from: 'agente', text: 'te paso mi calendly.com/link' }]),
    conv('c2', 'pedro'),
    conv('c3', 'sin_match', [{ from: 'agente', text: 'aquí tu enlace: calendly.com/otro' }]),
  ]
  const contactos = [
    { id: 'contact-1', instagram: 'maria_winner' },
    { id: 'contact-2', instagram: 'pedro' },
  ]
  const contactIdsConAgenda = new Set(['contact-1']) // maria SÍ tiene cita real
  const contactIdsConVenta = new Set([]) // nadie compró todavía

  const { resumen, porConversacion } = calcularMetricas(
    conversations,
    contactos,
    contactIdsConAgenda,
    contactIdsConVenta
  )

  assert.equal(resumen.totalConversaciones, 3)
  assert.equal(resumen.conContactoVinculado, 2)
  assert.equal(resumen.conAgendaVerificada, 1)
  assert.equal(resumen.conVentaVerificada, 0)
  assert.equal(resumen.sinContactoVinculado, 1)
  // c3 no tiene contacto vinculado PERO sí envió un enlace de agenda — señal débil, nunca "agenda real".
  assert.equal(resumen.sinContactoConEnlaceAgenda, 1)
  assert.equal(resumen.tasaVinculacion, 2 / 3)
  assert.equal(resumen.tasaAgendaSobreVinculados, 1 / 2)

  const c2 = porConversacion.find((m) => m.conversationId === 'c2')
  // pedro está vinculado pero NO tiene cita: false (verificado, no null) — muy distinto de "sin evidencia".
  assert.equal(c2.tieneAgenda, false)

  const c3 = porConversacion.find((m) => m.conversationId === 'c3')
  // sin contacto vinculado: null, nunca false/true — no hay forma de saberlo, y decir "false" mentiría.
  assert.equal(c3.tieneAgenda, null)
  assert.equal(c3.enlaceAgendaEnTexto, true)
})

test('calcularMetricas: sin conversaciones no revienta y devuelve ceros, no NaN', () => {
  const { resumen } = calcularMetricas([], [], new Set(), new Set())
  assert.equal(resumen.totalConversaciones, 0)
  assert.equal(resumen.tasaVinculacion, 0)
  assert.equal(resumen.tasaAgendaSobreVinculados, 0)
})
