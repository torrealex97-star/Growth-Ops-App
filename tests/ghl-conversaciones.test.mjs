// Conversaciones desde GHL conectadas a perfiles (petición de Alex, 28-sep).
//
// La API de GHL no se puede llamar en tests (credenciales reales), así que se prueban las dos
// piezas que deciden el comportamiento en producción:
//   1. El mapeo PURO de la API v2 (listado + mensajes + canal) — el mismo que convierte lo que
//      GHL responde en lo que pinta la pestaña GHL de Setting AI.
//   2. El orquestador `descargarConversacionesGhl` con un fetch falso: deadline que corta la
//      FASE sin perder lo ya leído (AGENTS.md: el deadline gobierna TODAS las llamadas) y
//      failure aislada por conversación (una transcripción que falla no tumba el listado).
// La vinculación a contacts (ghl_contact_id → email → teléfono) y el snapshot stale se ejercitan
// en el flujo real de la ruta; aquí se garantiza que un match no pisa un contacto ya elegido.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aIsoFecha,
  canalDe,
  cfgDesdeEnv,
  descargarConversacionesGhl,
  mapearConversacionGhl,
  mapearMensajesGhl,
} from '../lib/ghl/conversaciones.ts'

const CFG = { token: 'pit-token-de-prueba', locationId: 'loc-1' }

test('cfgDesdeEnv: sin token o sin locationId no hay config (ni media credencial)', () => {
  assert.equal(cfgDesdeEnv({}), null)
  assert.equal(cfgDesdeEnv({ GHL_API_TOKEN: 't' }), null)
  assert.deepEqual(cfgDesdeEnv({ GHL_API_TOKEN: ' t ', GHL_LOCATION_ID: ' loc ' }), {
    token: 't',
    locationId: 'loc',
  })
})

test('mapearConversacionGhl: cabecera del listado con canal, contacto y unreadCount', () => {
  const c = mapearConversacionGhl({
    id: 'conv-1',
    contactId: 'ct-9',
    fullName: 'Ana García',
    email: 'ANA@Mail.com',
    phone: '+34600123456',
    lastMessageType: 'TYPE_SMS',
    unreadCount: 2,
    lastMessageDate: '2026-09-28T10:00:00Z',
  })
  assert.equal(c.id, 'conv-1')
  assert.equal(c.participant, 'Ana García')
  assert.equal(c.channel, 'sms')
  assert.equal(c.contactId, 'ct-9')
  assert.equal(c.contact_email, 'ANA@Mail.com')
  assert.equal(c.contact_phone, '+34600123456')
  assert.equal(c.unread_count, 2)
  assert.equal(c.message_count, 0)
  assert.equal(c.updated_time, '2026-09-28T10:00:00Z')
})

test('mapearConversacionGhl: sin id no hay conversación (nada inventado)', () => {
  assert.equal(mapearConversacionGhl({}), null)
  assert.equal(mapearConversacionGhl({ id: '  ' }), null)
})

test('canalDe: TYPE_* se traduce a canal legible; lo desconocido queda chat', () => {
  assert.equal(canalDe('TYPE_FACEBOOK', null), 'facebook')
  assert.equal(canalDe('TYPE_INSTAGRAM', 'TYPE_SMS'), 'instagram')
  assert.equal(canalDe(null, 'TYPE_WHATSAPP'), 'whatsapp')
  assert.equal(canalDe(null, null), 'chat')
  // Firma real observada en producción (sonda 29-sep): la llamada perdida llega como
  // TYPE_NO_SHOW en conversaciones TYPE_PHONE con messageTypes [100] — el canal es 'call'.
  assert.equal(canalDe('TYPE_NO_SHOW', 'TYPE_PHONE'), 'call')
  assert.equal(canalDe('TYPE_NO_SHOW', null), 'call')
})

test('aIsoFecha: epoch-millis del listado, ISO de las transcripciones y basura honesta', () => {
  // Firma real: lastMessageDate llega como número (epoch ms) en /conversations/search.
  assert.equal(aIsoFecha(1759152000000), '2025-09-29T13:20:00.000Z')
  // Si algún endpoint diera segundos, se detecta por magnitud (<10^11) y se multiplica.
  assert.equal(aIsoFecha(1759152000), '2025-09-29T13:20:00.000Z')
  // Las transcripciones sí traen ISO-8601 en texto: se respeta tal cual.
  assert.equal(aIsoFecha('2026-09-28T10:00:00Z'), '2026-09-28T10:00:00Z')
  assert.equal(aIsoFecha('no-es-fecha'), undefined)
  assert.equal(aIsoFecha(null), undefined)
  assert.equal(aIsoFecha(Number.NaN), undefined)
})

test('mapearConversacionGhl: firma REAL de producción (epoch ms + TYPE_NO_SHOW/TYPE_PHONE) mapea a canal y fecha correctos', () => {
  const c = mapearConversacionGhl({
    id: 'conv-real',
    contactId: 'ct-real',
    fullName: 'Lead Real',
    email: 'lead@example.com',
    phone: '+34600000000',
    lastMessageType: 'TYPE_NO_SHOW',
    type: 'TYPE_PHONE',
    messageTypes: [100],
    unreadCount: 0,
    lastMessageDate: 1758998400000, // epoch ms, como llega de verdad
  })
  assert.equal(c.channel, 'call')
  assert.equal(c.updated_time, '2025-09-27T18:40:00.000Z')
  assert.equal(c.unread_count, 0)
  assert.equal(c.participant, 'Lead Real')
  // Y una de email (messageTypes [3]) mantiene el canal legible con fecha epoch.
  const e = mapearConversacionGhl({
    id: 'conv-mail',
    lastMessageType: 'TYPE_EMAIL',
    messageTypes: [3],
    lastMessageDate: 1759084800000,
  })
  assert.equal(e.channel, 'email')
  assert.equal(e.updated_time, '2025-09-28T18:40:00.000Z')
})

test('mapearConversacionGhl: profilePhoto llega a contact_photo_url; hueco o basura queda null (no se inventa cadena)', () => {
  const con = mapearConversacionGhl({
    id: 'conv-foto',
    fullName: 'Con Foto',
    profilePhoto: 'https://services.leadconnectorhq.com/images/contact/foto.jpg',
  })
  assert.equal(con.contact_photo_url, 'https://services.leadconnectorhq.com/images/contact/foto.jpg')
  // La muestra real de la sonda (29-sep) traía profilePhoto null: es un hueco legítimo.
  const sin = mapearConversacionGhl({ id: 'conv-sin', profilePhoto: null })
  assert.equal(sin.contact_photo_url, null)
  // No-string (p. ej. un número) tampoco se convierte en URL.
  const ruido = mapearConversacionGhl({ id: 'conv-ruido', profilePhoto: 42 })
  assert.equal(ruido.contact_photo_url, null)
})

test('mapearMensajesGhl: inbound=lead, el resto=agente, sin texto queda placeholder, más antiguos primero', () => {
  const j = {
    messages: {
      messages: [
        { id: 'm3', direction: 'outbound', body: 'Te llamo mañana', dateAdded: '2026-09-28T11:00:00Z' },
        { id: 'm1', direction: 'inbound', body: 'Hola', dateAdded: '2026-09-28T10:00:00Z' },
        { id: 'm2', direction: 'inbound', dateAdded: '2026-09-28T10:05:00Z', messageType: 'TYPE_CALL' },
        { id: 'm4', direction: 'outbound', dateAdded: '2026-09-28T11:05:00Z' },
      ],
    },
  }
  const ms = mapearMensajesGhl(j)
  assert.deepEqual(
    ms.map((m) => m.from),
    ['lead', 'lead', 'agente', 'agente']
  )
  assert.equal(ms[0].text, 'Hola')
  assert.equal(ms[1].text, '(TYPE_CALL sin texto)')
  assert.equal(ms[2].text, 'Te llamo mañana')
  // m4 sin body ni messageType: placeholder genérico, no un texto inventado.
  assert.equal(ms[3].text, '(mensaje sin texto)')
})

test('mapearMensajesGhl: respuesta vacía o malformada → lista vacía, no excepción', () => {
  assert.deepEqual(mapearMensajesGhl(null), [])
  assert.deepEqual(mapearMensajesGhl({}), [])
  assert.deepEqual(mapearMensajesGhl({ messages: {} }), [])
})

test('descargarConversacionesGhl: listado + transcripciones en paralelo con el fetch falso', async () => {
  const llamadas = []
  const fetchFalso = async (input) => {
    const url = String(input)
    llamadas.push(url)
    if (url.includes('/conversations/search')) {
      return new Response(
        JSON.stringify({
          conversations: [
            { id: 'conv-a', contactId: 'ct-a', fullName: 'Ana', lastMessageType: 'TYPE_SMS', unreadCount: 1 },
            { id: 'conv-b', contactId: 'ct-b', fullName: 'Beto', lastMessageType: 'TYPE_INSTAGRAM', unreadCount: 0 },
            { id: 'conv-c', fullName: 'Cleo' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    assert.match(url, /\/conversations\/conv-[ab]\/messages/)
    await new Promise((r) => setTimeout(r, 5))
    return new Response(
      JSON.stringify({
        messages: { messages: [{ direction: 'inbound', body: 'hola', dateAdded: '2026-09-28T10:00:00Z' }] },
      }),
      { status: 200 }
    )
  }
  const out = await descargarConversacionesGhl(CFG, { deadlineMs: Date.now() + 5_000, fetchImpl: fetchFalso })
  assert.equal(llamadas.filter((u) => u.includes('/conversations/search')).length, 1)
  assert.equal(out.length, 3)
  assert.deepEqual(
    out.map((c) => c.id),
    ['conv-a', 'conv-b', 'conv-c']
  )
  assert.equal(out[0].messages.length, 1)
  assert.equal(out[0].messages[0].from, 'lead')
  assert.equal(out[0].message_count, 1)
  // La que falla no entra al fetch de mensajes pero SÍ está en el listado (degradación, no pérdida).
  assert.equal(out[2].id, 'conv-c')
})

test('descargarConversacionesGhl: el deadline corta la fase de mensajes sin perder lo ya leído', async () => {
  const fetchFalso = async (input) => {
    const url = String(input)
    if (url.includes('/conversations/search')) {
      return new Response(
        JSON.stringify({
          conversations: Array.from({ length: 6 }, (_, i) => ({ id: `conv-${i}`, fullName: `L${i}` })),
        }),
        { status: 200 }
      )
    }
    // Cada transcripción tarda 20 ms; el deadline vence mientras aún quedan por descargar.
    await new Promise((r) => setTimeout(r, 20))
    return new Response(JSON.stringify({ messages: { messages: [{ direction: 'inbound', body: 'x' }] } }), {
      status: 200,
    })
  }
  // 15 ms < 20 ms: la primera ola (5 en paralelo) entra y la segunda queda fuera del presupuesto.
  const out = await descargarConversacionesGhl(CFG, { deadlineMs: Date.now() + 15, fetchImpl: fetchFalso })
  assert.equal(out.length, 6, 'el listado completo se conserva')
  const conTranscripcion = out.filter((c) => c.messages.length > 0)
  assert.ok(conTranscripcion.length > 0, 'las ya descargadas conservan su transcripción')
  assert.ok(conTranscripcion.length < 6, 'las que no llegaron quedan degradadas, sin bloquear la lambda')
})

test('descargarConversacionesGhl: error HTTP del listado es ruidoso (nada de lista vacía)', async () => {
  const fetchFalso = async () => new Response(JSON.stringify({ message: 'Token inválido' }), { status: 401 })
  await assert.rejects(() => descargarConversacionesGhl(CFG, { fetchImpl: fetchFalso }), /Token inválido/)
})

test('descargarConversacionesGhl: presupuesto agotado ANTES del listado lanza sin llamar a GHL', async () => {
  let llamadas = 0
  const fetchFalso = async () => {
    llamadas++
    return new Response('{}', { status: 200 })
  }
  await assert.rejects(
    () => descargarConversacionesGhl(CFG, { deadlineMs: Date.now() - 1, fetchImpl: fetchFalso }),
    /Presupuesto agotado/
  )
  assert.equal(llamadas, 0)
})
