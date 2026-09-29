// Búsqueda y filtro por canal en la bandeja de Conversaciones (Setting AI).
//
// La lógica vive en el módulo canónico `lib/setting-ai/filtrar-conversaciones.ts` (puro, sin
// React): el patrón del repo manda la lógica testeable a lib/, no a un .tsx que node no carga. Se garantiza el contrato del
// SearchBox canónico del panel: normalización sin acentos (Ana García == ana garcia) y
// teléfonos por dígitos (phoneMatches: "+34 600 123 456" encuentra "6001"), y el select de
// canal derivado de los datos (solo se filtra por canales que existen).
import assert from 'node:assert/strict'
import test from 'node:test'
import { canalesDisponibles, filtrarConversaciones } from '../lib/setting-ai/filtrar-conversaciones.ts'

const conv = (o = {}) => ({
  id: o.id || 'c',
  participant: o.participant,
  channel: o.channel,
  unread_count: 0,
  message_count: o.messages?.length || 0,
  messages: o.messages || [],
  contactId: o.contactId,
  contact_name: o.contact_name,
  contact_email: o.contact_email,
  contact_phone: o.contact_phone,
  contactoVinculado: o.contactoVinculado,
})

const BANDEJA = [
  conv({ id: '1', participant: 'Ana García', channel: 'sms', contact_phone: '+34 600 123 456' }),
  conv({
    id: '2',
    participant: 'Beto',
    channel: 'facebook',
    contact_email: 'Beto@Mail.com',
    contactoVinculado: { id: 'cb', full_name: 'Beto Pérez' },
  }),
  conv({ id: '3', participant: 'Caro', channel: 'call' }),
  conv({ id: '4', participant: 'Dani', contactId: 'gd', contact_name: 'Dani Importado' }),
]

test('sin búsqueda ni canal devuelve la bandeja entera', () => {
  assert.equal(filtrarConversaciones(BANDEJA, '', 'todos').length, 4)
})

test('busca por nombre con y sin acentos', () => {
  const r = filtrarConversaciones(BANDEJA, 'ana garcia', 'todos')
  assert.deepEqual(
    r.map((c) => c.id),
    ['1']
  )
  assert.equal(filtrarConversaciones(BANDEJA, 'ána gárcía', 'todos').length, 1, 'sin acentos también matchea')
})

test('busca por nombre del perfil vinculado, no solo el participante de GHL', () => {
  const r = filtrarConversaciones(BANDEJA, 'beto pérez', 'todos')
  assert.deepEqual(
    r.map((c) => c.id),
    ['2']
  )
})

test('busca por email (sin distinguir mayúsculas) y por teléfono por dígitos', () => {
  assert.deepEqual(
    filtrarConversaciones(BANDEJA, 'beto@mail.com', 'todos').map((c) => c.id),
    ['2']
  )
  assert.deepEqual(
    filtrarConversaciones(BANDEJA, '6001', 'todos').map((c) => c.id),
    ['1'],
    'phoneMatches por dígitos'
  )
})

test('filtra por canal exacto y combina canal + búsqueda', () => {
  assert.deepEqual(
    filtrarConversaciones(BANDEJA, '', 'sms').map((c) => c.id),
    ['1']
  )
  assert.equal(filtrarConversaciones(BANDEJA, 'ana', 'facebook').length, 0)
  assert.deepEqual(
    filtrarConversaciones(BANDEJA, 'ana', 'sms').map((c) => c.id),
    ['1']
  )
  // Sin channel (conversación IG o fila antigua del snapshot) solo pasa con 'todos'.
  assert.equal(
    filtrarConversaciones(BANDEJA, '', 'sms').some((c) => c.id === '4'),
    false
  )
})

test('canalesDisponibles deriva del dato, sin duplicados y ordenado', () => {
  // La de '4' no tiene channel → 'chat' (el filtro por canal solo ofrece lo que existe).
  assert.deepEqual(canalesDisponibles(BANDEJA), ['call', 'chat', 'facebook', 'sms'])
  assert.deepEqual(canalesDisponibles([conv({ channel: 'sms' }), conv({ channel: 'sms' })]), ['sms'])
  // Sin channel en ninguna: el select no se muestra (un solo canal 'chat').
  assert.deepEqual(canalesDisponibles([conv(), conv()]), ['chat'])
})
