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
  cursorMasProfundo,
  descargarConversacionesGhl,
  descargarPaginaConversacionesGhl,
  enviarMensajeGhl,
  fusionarConversaciones,
  GhlConversacionesError,
  mapearConversacionGhl,
  mapearMensajesGhl,
  typeDe,
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

// ── Paginación incremental (cursor startAfterDate, doc oficial 2021-07-28) ─────────
// Bandejas con >100 conversaciones: el listado se pide por páginas hasta cubrir el objetivo o
// agotar presupuesto; lo leído se devuelve SIEMPRE con el cursor a la siguiente página para
// que "Cargar más" continúe donde quedó en vez de empezar de cero.

const TOTAL = 60
const fechaDe = (i) => 1_750_000_000_000 - i * 1_000
const filaDe = (i) => ({
  id: `conv-${i}`,
  fullName: `Lead ${i}`,
  lastMessageType: 'TYPE_SMS',
  lastMessageDate: fechaDe(i),
  unreadCount: i,
})
// Simulacro del listado GHL: filas estrictamente por debajo del cursor (exclusive), páginas de 25.
const fetchListado = async (input) => {
  const url = new URL(String(input))
  const start = Number(url.searchParams.get('startAfterDate') || 0)
  const desde = start ? Math.round((fechaDe(0) - start) / 1_000) + 1 : 0
  const filas = Array.from({ length: Math.min(25, TOTAL - desde) }, (_, k) => filaDe(desde + k))
  return new Response(JSON.stringify({ conversations: filas, total: TOTAL }), { status: 200 })
}

const fetchSoloListado = (registrador) => async (input) => {
  if (String(input).includes('/conversations/search')) {
    registrador?.(String(input))
    return fetchListado(input)
  }
  throw new Error('no deberían pedirse transcripciones')
}

test('descargarPaginaConversacionesGhl: varias páginas hasta el objetivo y cierre por fin real', async () => {
  let llamadasSearch = 0
  const out = await descargarPaginaConversacionesGhl(CFG, {
    objetivo: 60,
    transcripciones: false,
    fetchImpl: fetchSoloListado(() => llamadasSearch++),
  })
  // 60 filas = 3 páginas (25/25/10); la página corta es el fin real del listado.
  assert.equal(out.conversaciones.length, 60)
  assert.deepEqual(out.conversaciones.map((c) => c.id).slice(0, 3), ['conv-0', 'conv-1', 'conv-2'])
  assert.equal(out.total, TOTAL)
  // Fin real: sin cursor — no un "Cargar más" que devolvería una página vacía.
  assert.equal(out.cursor, undefined)
  assert.equal(llamadasSearch, 3)
})

test('descargarPaginaConversacionesGhl: continuación con cursor e idempotencia al repetirlo', async () => {
  const urls = []
  const pag1 = await descargarPaginaConversacionesGhl(CFG, {
    transcripciones: false,
    fetchImpl: fetchSoloListado((u) => urls.push(u)),
  })
  assert.equal(pag1.conversaciones.length, 25)
  assert.equal(pag1.cursor, fechaDe(24), 'el cursor es la fecha de la última fila')

  // "Cargar más": la siguiente tanda empieza DESPUÉS del cursor, sin repetir filas.
  const pag2 = await descargarPaginaConversacionesGhl(CFG, {
    cursor: pag1.cursor,
    transcripciones: false,
    fetchImpl: fetchSoloListado((u) => urls.push(u)),
  })
  assert.ok(urls[1].includes(`startAfterDate=${fechaDe(24)}`))
  assert.deepEqual(
    pag2.conversaciones.map((c) => c.id),
    Array.from({ length: 25 }, (_, i) => `conv-${25 + i}`)
  )

  // Doble clic / reintento con el MISMO cursor: mismas filas — la fusión no duplica.
  const pag2bis = await descargarPaginaConversacionesGhl(CFG, {
    cursor: pag1.cursor,
    transcripciones: false,
    fetchImpl: fetchSoloListado(),
  })
  const fusion = fusionarConversaciones(pag1.conversaciones, pag2.conversaciones)
  const fusionTrasReintento = fusionarConversaciones(fusion, pag2bis.conversaciones)
  assert.equal(fusion.length, 50)
  assert.equal(fusionTrasReintento.length, 50, 'el solape del cursor no duplica filas')
  // Orden desc por updated_time: lo más nuevo primero.
  assert.equal(fusionTrasReintento[0].id, 'conv-0')
  assert.equal(fusionTrasReintento[49].id, 'conv-49')
})

test('descargarPaginaConversacionesGhl: presupuesto agotado a mitad devuelve lo leído CON cursor (nunca lista vacía)', async () => {
  const fetchFalso = async (input) => {
    if (String(input).includes('/conversations/search')) {
      await new Promise((r) => setTimeout(r, 40))
      return fetchListado(input)
    }
    throw new Error('no deberían pedirse transcripciones')
  }
  // La página 1 tarda 40 ms; con deadline 20 ms el presupuesto vence antes de la segunda
  // petición: lo leído se devuelve con su cursor de continuación, sin error.
  const out = await descargarPaginaConversacionesGhl(CFG, {
    objetivo: 50,
    deadlineMs: Date.now() + 20,
    transcripciones: false,
    fetchImpl: fetchFalso,
  })
  assert.equal(out.conversaciones.length, 25, 'lo ya leído se conserva')
  assert.equal(out.cursor, fechaDe(24), 'el cursor permite continuar en el siguiente intento')
})

test('descargarPaginaConversacionesGhl: página repetida (cursor sin avance) corta sin cursor', async () => {
  // GHL devolviendo siempre las mismas 25 filas no debe colgar el bucle ni ofrecer un
  // "Cargar más" infinito que vuelva a dar lo mismo.
  const fijas = Array.from({ length: 25 }, (_, i) => filaDe(i))
  let llamadas = 0
  const fetchFalso = async (input) => {
    if (String(input).includes('/conversations/search')) {
      llamadas++
      return new Response(JSON.stringify({ conversations: fijas, total: 99 }), { status: 200 })
    }
    throw new Error('no deberían pedirse transcripciones')
  }
  const out = await descargarPaginaConversacionesGhl(CFG, {
    objetivo: 100,
    transcripciones: false,
    fetchImpl: fetchFalso,
  })
  assert.equal(llamadas, 2)
  assert.equal(out.conversaciones.length, 25)
  assert.equal(out.cursor, undefined)
})

test('fusionarConversaciones: acumula sin duplicados, lo fresco gana y el tope recorta lo más antiguo', () => {
  const iso = (i) => new Date(fechaDe(i)).toISOString()
  const vieja = { ...filaDe(0), unread_count: 7, updated_time: iso(0) }
  const fresca = { ...filaDe(0), unread_count: 0, updated_time: iso(0) }
  const resto = Array.from({ length: 5 }, (_, i) => ({ ...filaDe(i + 1), updated_time: iso(i + 1) }))
  const fusion = fusionarConversaciones([vieja, ...resto], [fresca])
  assert.equal(fusion.length, 6, 'la fila repetida (conv-0) no se duplica')
  assert.equal(fusion.find((c) => c.id === 'conv-0').unread_count, 0, 'la fila fresca gana')
  assert.equal(fusion[0].id, 'conv-0', 'orden desc por updated_time')

  const muchas = Array.from({ length: 10 }, (_, i) => ({ ...filaDe(i), updated_time: iso(i) }))
  assert.deepEqual(
    fusionarConversaciones([], muchas, 4).map((c) => c.id),
    ['conv-0', 'conv-1', 'conv-2', 'conv-3'],
    'el tope recorta las más antiguas'
  )
})

test('typeDe: canal de la conversación → tipo de POST /conversations/messages', () => {
  // Los canales de DM que pasan por GHL salen por su tipo propio.
  assert.equal(typeDe('instagram'), 'IG')
  assert.equal(typeDe('facebook'), 'FB')
  assert.equal(typeDe('whatsapp'), 'WhatsApp')
  assert.equal(typeDe('email'), 'Email')
  // SMS y la llamada perdida (respuesta escrita tras ella) salen por SMS.
  assert.equal(typeDe('sms'), 'SMS')
  assert.equal(typeDe('call'), 'SMS')
  // Lo desconocido no revienta: SMS es el tipo por defecto.
  assert.equal(typeDe(''), 'SMS')
  assert.equal(typeDe('tiktok'), 'SMS')
})

test('enviarMensajeGhl: POST al canal del contacto con el texto exacto; error HTTP ruidoso', async () => {
  const llamadas = []
  const fetchFalso = async (input, init) => {
    llamadas.push({ url: String(input), init: init || {} })
    return new Response(JSON.stringify({ messageId: 'msg-1' }), { status: 201 })
  }
  const out = await enviarMensajeGhl(
    CFG,
    { conversacionId: 'conv-1', contactId: 'ct-9', canal: 'instagram', texto: '  ¡Hola! Te escribo de IA Winners  ' },
    fetchFalso
  )
  assert.equal(out.messageId, 'msg-1')
  assert.equal(llamadas.length, 1)
  assert.equal(llamadas[0].url, 'https://services.leadconnectorhq.com/conversations/messages')
  assert.equal(llamadas[0].init.method, 'POST')
  // Content-Type JSON obligatorio: sin él GHL no parsea el body (404 "Contact id not given",
  // visto en producción el 1-oct).
  assert.equal(llamadas[0].init.headers['Content-Type'], 'application/json')
  const body = JSON.parse(llamadas[0].init.body)
  assert.equal(body.type, 'IG')
  assert.equal(body.contactId, 'ct-9')
  assert.equal(body.message, '¡Hola! Te escribo de IA Winners') // recortado, sin texto inventado
  assert.equal(body.status, 'delivered')

  // Error de GHL se propaga con su mensaje real (para la UI y el reintento del usuario).
  const fetchError = async () => new Response(JSON.stringify({ message: 'Provider not connected' }), { status: 400 })
  await assert.rejects(
    () => enviarMensajeGhl(CFG, { conversacionId: 'c', contactId: 'ct', canal: 'sms', texto: 'x' }, fetchError),
    (e) => e instanceof GhlConversacionesError && /Provider not connected/.test(e.message)
  )
  // Sin texto no se llama a GHL (nada de enviar vacío).
  await assert.rejects(
    () =>
      enviarMensajeGhl(
        CFG,
        { conversacionId: 'c', contactId: 'ct', canal: 'sms', texto: '   ' },
        async () => new Response('{}')
      ),
    /vacío/
  )
})

test('cursorMasProfundo: el cursor de la bandeja nunca retrocede con un refresco más reciente', () => {
  assert.equal(cursorMasProfundo(undefined, 500), 500)
  assert.equal(cursorMasProfundo(500, undefined), 500)
  assert.equal(cursorMasProfundo(undefined, undefined), undefined)
  // Con sort desc, "más profundo" es el número MENOR: la fecha más antigua alcanzada.
  assert.equal(cursorMasProfundo(500, 900), 500)
  assert.equal(cursorMasProfundo(900, 500), 500)
})
