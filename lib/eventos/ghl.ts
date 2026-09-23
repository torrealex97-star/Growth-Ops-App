import { createHash } from 'node:crypto'

// F1 — CAPA EN BRUTO DEL WEBHOOK DE GHL.
//
// EL PROBLEMA QUE RESUELVE. Hoy el webhook lee el payload, escribe contactos y citas, y tira el
// sobre. Si el normalizador tenía un fallo —un estado mal traducido, un campo que se empezó a mandar
// distinto— no hay nada que reprocesar: el dato original ya no existe. Eso es lo que el plan llama
// "sin replay" (`docs/plan/08-fases-s0-f4.md` §F1), y es la diferencia entre arreglar un fallo y
// arreglar un fallo Y recuperar lo que se perdió mientras estuvo roto.
//
// EL ORDEN IMPORTA: se guarda el sobre ANTES de procesar nada. Si el procesado falla a mitad, el
// evento sigue ahí; al revés, se pierde.
//
// Este módulo es puro: identidad del evento, tipo y propiedades. Nada de red ni de base de datos,
// para poder probarlo con payloads reales sin tocar producción.

/** Payload de GHL ya aplanado por el webhook (contact, appointment y customData fusionados). */
export type PayloadGhl = Record<string, unknown>

const texto = (v: unknown): string | null => {
  if (typeof v === 'string') {
    const t = v.trim()
    return t === '' ? null : t
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

const primero = (...vs: unknown[]): string | null => {
  for (const v of vs) {
    const t = texto(v)
    if (t) return t
  }
  return null
}

/**
 * HUELLA DETERMINISTA para los eventos que no traen id propio.
 *
 * El plan la exige documentada (§F1): "fingerprint determinista si el proveedor no da ID fiable".
 * Se calcula sobre el CONTENIDO que identifica al hecho, no sobre el sobre entero: si se incluyera
 * todo, cualquier campo volátil que GHL añada —la marca de entrega, un id de reintento— haría que el
 * mismo hecho tuviera dos huellas y el duplicado entraría igual.
 *
 * Claves ordenadas: dos entregas con el mismo contenido en distinto orden dan la MISMA huella.
 */
export function huellaEvento(partes: Record<string, string | null | undefined>): string {
  const canonico = Object.keys(partes)
    .sort()
    .map((k) => `${k}=${partes[k] ?? ''}`)
    .join('|')
  return createHash('sha256').update(canonico).digest('hex').slice(0, 40)
}

/**
 * Identificador del evento EN GHL, que es la base de la idempotencia.
 *
 * GHL no manda un id de evento estable en todos sus webhooks: en los de cita viene el id de la cita,
 * en los de contacto el del contacto, y en algunos flujos de workflow no viene ninguno. Por eso:
 * primero se busca un id real; si no lo hay, se compone una huella con lo que identifica al hecho.
 *
 * `hf_` (huella) delante para que en la base se distinga de un id real de GHL: si mañana aparecen
 * duplicados, se puede saber si vinieron de eventos sin id o de un fallo de otra cosa.
 */
export function idEventoGhl(payload: PayloadGhl): string {
  const idReal = primero(payload.webhookId, payload.webhook_id, payload.eventId, payload.event_id)
  if (idReal) return idReal

  const cita = primero(payload.appointmentId, payload.appointment_id)
  const contacto = primero(payload.contactId, payload.contact_id, payload.ghlContactId, payload.ghl_id, payload.id)
  return `hf_${huellaEvento({
    tipo: tipoEventoGhl(payload),
    cita,
    contacto,
    // `dateUpdated` distingue dos cambios sobre la MISMA cita: sin él, mover una cita dos veces
    // parecería el mismo evento y el segundo cambio se descartaría como duplicado.
    actualizado: primero(payload.dateUpdated, payload.date_updated, payload.updatedAt, payload.updated_at),
    inicio: primero(payload.startTime, payload.start_time, payload.appointmentDate, payload.appointment_date),
    estado: primero(payload.status, payload.appointmentStatus, payload.appointment_status),
  })}`
}

/**
 * Tipo del hecho, en el vocabulario de la app. `event_types` (la tabla que pide el plan) llegará con
 * el resto de F1; hasta entonces estos son los nombres que se escriben, y están aquí en un solo sitio
 * para que la tabla se siembre desde ellos y no de una lista escrita a mano en otro lado.
 */
export function tipoEventoGhl(payload: PayloadGhl): string {
  const evento = (texto(payload.event) || texto(payload.type) || '').toLowerCase()
  const tieneCita = !!primero(payload.appointmentId, payload.appointment_id, payload.startTime, payload.start_time)

  if (evento.includes('cancel')) return 'ghl.cita.cancelada'
  if (evento.includes('reschedul') || evento.includes('reprogram')) return 'ghl.cita.reprogramada'
  if (tieneCita) return 'ghl.cita.registrada'
  if (evento.includes('contact')) return 'ghl.contacto.actualizado'
  return 'ghl.evento.recibido'
}

// Campos que NO entran en `properties`: son la persona, no el hecho. El plan lo pide explícitamente
// ("properties y context sin PII sensible ni cuerpos de mensaje") y además `raw_events` guarda el
// sobre completo aparte, así que duplicarlos aquí solo multiplica dónde hay que ir a borrarlos
// cuando alguien ejerce su derecho al olvido (ver docs/F6-MAPA-PII.md).
const CLAVES_PII = [
  'email',
  'phone',
  'firstname',
  'lastname',
  'name',
  'fullname',
  'address',
  'address1',
  'city',
  'postalcode',
  'state',
  'country',
  'body',
  'message',
  'text',
  'notes',
  'transcript',
  'ip',
  'useragent',
]

const esPii = (clave: string): boolean => {
  const k = clave.toLowerCase().replace(/[_\s-]/g, '')
  return CLAVES_PII.some((p) => k === p || k.endsWith(p) || k.startsWith(p))
}

/**
 * Las propiedades del hecho, sin la persona: ids, estado, fechas, UTMs y poco más.
 *
 * Se filtra por nombre de clave. Es una heurística, y por eso el sobre completo vive en `raw_events`
 * con su propio control de acceso: aquí se prefiere perder un campo a colar un dato personal en una
 * tabla pensada para analítica.
 */
export function propiedadesSinPii(payload: PayloadGhl): Record<string, unknown> {
  const fuera: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(payload)) {
    if (esPii(clave)) continue
    // Los objetos anidados (contact, appointment, customData) ya vienen aplanados por el webhook;
    // guardar el anidado otra vez reintroduciría por la puerta de atrás lo que acaba de filtrarse.
    if (valor && typeof valor === 'object') continue
    if (valor === undefined || valor === null || valor === '') continue
    fuera[clave] = valor
  }
  return fuera
}

/** Todo lo que el webhook necesita para escribir la fila en bruto. */
export function sobreCrudoGhl(payload: PayloadGhl, payloadBytes: number) {
  return {
    source: 'ghl',
    source_event_id: idEventoGhl(payload),
    normalizer_version: NORMALIZADOR_GHL,
    payload_bytes: payloadBytes,
    processing_status: 'received' as const,
  }
}

/**
 * Versión del normalizador. Se sube cuando cambia CÓMO se interpreta el payload, no cuando cambia
 * el código alrededor: es lo que permite distinguir un replay tras arreglar un parser del procesado
 * original, y saber qué filas hay que volver a pasar.
 */
export const NORMALIZADOR_GHL = 'ghl-1'
