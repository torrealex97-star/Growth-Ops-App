import { propiedadesSinPii, type PayloadGhl } from './ghl'

// F1 — DEL SOBRE AL HECHO.
//
// `raw_events` guarda lo que llegó, tal cual. `canonical_events` guarda lo que ESO SIGNIFICA, en el
// vocabulario de la app y sin datos personales. Son dos cosas distintas a propósito:
//
//   · El sobre es la prueba: no se toca nunca, y por eso se puede reprocesar.
//   · El hecho es la interpretación: si el normalizador mejora, se vuelve a derivar del sobre.
//
// LOS HECHOS SON INMUTABLES (`docs/plan/01-arquitectura-datos.md` §4). Una corrección no reescribe el
// hecho anterior: se añade uno nuevo que dice a cuál corrige. Reescribir haría imposible responder
// "¿qué sabíamos el martes?", que es justo lo que hace falta cuando una cifra cambia sola.
//
// Las proyecciones (contacts, appointments) sí se actualizan de forma idempotente: son el estado
// actual, no la historia.

/** Fila lista para insertar en `canonical_events`. */
export type HechoCanonico = {
  tenant_id: string
  source: string
  source_event_id: string
  raw_event_id: string | null
  event_id: string
  event_name: string
  occurred_at: string
  idempotency_key: string
  properties: Record<string, unknown>
  contact_id: string | null
  appointment_id: string | null
  processing_status: 'processed'
  processed_at: string
}

const fecha = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.trim() === '') return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/**
 * CUÁNDO OCURRIÓ el hecho, que no es cuándo nos llegó.
 *
 * Importa para las métricas: una cita de ayer que entra hoy por un reintento pertenece a ayer. Se
 * busca la fecha del hecho en el payload y solo se cae a la de recepción cuando no hay ninguna, que
 * es lo honesto: inventar una fecha movería la cita de mes.
 */
export function ocurridoEn(payload: PayloadGhl, recibidoEn: string): string {
  return (
    fecha(payload.startTime) ??
    fecha(payload.start_time) ??
    fecha(payload.appointmentDate) ??
    fecha(payload.appointment_date) ??
    fecha(payload.dateUpdated) ??
    fecha(payload.date_updated) ??
    recibidoEn
  )
}

export function hechoDesdeSobre(opciones: {
  tenantId: string
  source: string
  sourceEventId: string
  rawEventId: string | null
  tipo: string
  payload: PayloadGhl
  recibidoEn: string
  contactId?: string | null
  appointmentId?: string | null
}): HechoCanonico {
  const { tenantId, source, sourceEventId, rawEventId, tipo, payload, recibidoEn } = opciones
  return {
    tenant_id: tenantId,
    source,
    source_event_id: sourceEventId,
    raw_event_id: rawEventId,
    // El id del hecho ES el id del evento en el proveedor. Así, dos entregas del mismo evento chocan
    // contra la clave única (tenant, source, source_event_id) en vez de crear dos hechos.
    event_id: sourceEventId,
    event_name: tipo,
    occurred_at: ocurridoEn(payload, recibidoEn),
    idempotency_key: sourceEventId,
    properties: propiedadesSinPii(payload),
    // Los vínculos con la persona y la cita son el resultado de la proyección: se conocen DESPUÉS de
    // procesar, y por eso el hecho se escribe al final y no al recibir.
    contact_id: opciones.contactId ?? null,
    appointment_id: opciones.appointmentId ?? null,
    processing_status: 'processed',
    processed_at: new Date().toISOString(),
  }
}

/**
 * Un hecho que CORRIGE a otro, sin tocarlo.
 *
 * El plan lo pide así (§F1: "evento `*.corrected` que referencia al original"). Ejemplo real: una
 * cita que se guardó como "programada" porque el normalizador no entendía `no-show`. El hecho viejo
 * se queda —era lo que creíamos entonces— y este dice qué era en realidad.
 */
export function hechoDeCorreccion(
  original: Pick<HechoCanonico, 'tenant_id' | 'source' | 'event_id' | 'event_name' | 'occurred_at'>,
  correccion: { motivo: string; propiedades?: Record<string, unknown>; normalizador: string }
): HechoCanonico {
  const idCorreccion = `${original.event_id}#corregido:${correccion.normalizador}`
  return {
    tenant_id: original.tenant_id,
    source: original.source,
    source_event_id: idCorreccion,
    raw_event_id: null,
    event_id: idCorreccion,
    event_name: `${original.event_name}.corregido`,
    // La fecha del hecho ORIGINAL: corregir no mueve el hecho en el tiempo, solo lo reinterpreta.
    occurred_at: original.occurred_at,
    idempotency_key: idCorreccion,
    properties: {
      ...(correccion.propiedades ?? {}),
      corrige: original.event_id,
      motivo: correccion.motivo,
      normalizador: correccion.normalizador,
    },
    contact_id: null,
    appointment_id: null,
    processing_status: 'processed',
    processed_at: new Date().toISOString(),
  }
}

/**
 * Vocabulario de eventos que produce la app hoy. La tabla `event_types` que pide el plan se siembra
 * DESDE aquí (migración `20260923090000_event_types.sql`), para que no haya dos listas que se
 * separen: la del código manda.
 */
export const TIPOS_DE_EVENTO = [
  { nombre: 'ghl.cita.registrada', descripcion: 'GHL comunica una cita nueva o actualizada.' },
  { nombre: 'ghl.cita.cancelada', descripcion: 'GHL comunica que una cita se canceló.' },
  { nombre: 'ghl.cita.reprogramada', descripcion: 'GHL comunica que una cita cambió de fecha.' },
  { nombre: 'ghl.contacto.actualizado', descripcion: 'GHL comunica un alta o un cambio de contacto.' },
  { nombre: 'ghl.evento.recibido', descripcion: 'Evento de GHL recibido y guardado, sin clasificar todavía.' },
] as const
