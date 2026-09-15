// Timeline unificada de un contacto (Contacto → Atribución → Agendas → Transcripciones → Ventas →
// Notas) construida a partir de las tablas normalizadas que YA existen (contacts,
// contact_attributions, appointments, sales, contact_notes) — sin escribir a canonical_events ni
// tocar el pipeline de ingesta. Es una vista de lectura, no una nueva fuente de verdad.
import { formatCurrency } from '@/lib/utils'

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Cita agendada',
  confirmed: 'Cita confirmada',
  show: 'Asistió a la reunión',
  no_show: 'No se presentó',
  cancelled: 'Cita cancelada',
  rescheduled: 'Cita reagendada',
  completed: 'Reunión completada',
  cancelled_admin: 'Cita cancelada (equipo)',
  cancelled_lead: 'Cita cancelada (lead)',
}

const SALE_STATUS_LABELS: Record<string, string> = {
  active: 'Venta cerrada',
  refunded: 'Venta reembolsada',
  partial_refund: 'Venta con reembolso parcial',
  chargeback: 'Contracargo',
  cancelled: 'Venta cancelada',
}

export type TimelineEventType = 'attribution' | 'appointment' | 'transcript' | 'sale' | 'note'

export type TimelineEvent = {
  id: string
  occurredAt: string
  type: TimelineEventType
  title: string
  detail: string | null
  source: string | null
  // Solo para type: 'transcript' — la transcripción no se muestra inline (punto 25), se referencia.
  transcriptRef?: string | null
}

type AttributionInput = {
  id: string
  first_touch_at: string | null
  created_at: string
  source: string | null
  utm_source: string | null
  utm_campaign: string | null
}
type AppointmentInput = {
  id: string
  appointment_datetime: string
  status: string
  external_source: string | null
  transcript: string | null
  ai_summary: string | null
  updated_at: string
}
type SaleInput = {
  id: string
  sale_date: string
  status: string
  gross_amount: number | string
}
type NoteInput = {
  id: string
  note: string
  created_at: string
  author?: { full_name: string } | null
}

export function buildContactTimeline(
  attributions: AttributionInput[],
  appointments: AppointmentInput[],
  sales: SaleInput[],
  notes: NoteInput[]
): TimelineEvent[] {
  const events: TimelineEvent[] = []

  for (const a of attributions) {
    const occurredAt = a.first_touch_at || a.created_at
    if (!occurredAt) continue
    const label = a.source || a.utm_source || 'Directo/Sin UTM'
    events.push({
      id: `attribution_${a.id}`,
      occurredAt,
      type: 'attribution',
      title: 'Atribución capturada',
      detail: a.utm_campaign ? `${label} · ${a.utm_campaign}` : label,
      source: label,
    })
  }

  for (const ap of appointments) {
    events.push({
      id: `appointment_${ap.id}`,
      occurredAt: ap.appointment_datetime,
      type: 'appointment',
      title: APPOINTMENT_STATUS_LABELS[ap.status] || 'Cita',
      detail: ap.external_source ? `vía ${ap.external_source}` : null,
      source: ap.external_source,
    })
    // La transcripción se ancla a la fecha de actualización de la cita (cuando se recibió/procesó),
    // no a la fecha de la reunión — son eventos distintos (occurred_at de la llamada vs ingested_at
    // de la transcripción).
    if (ap.transcript) {
      events.push({
        id: `transcript_${ap.id}`,
        occurredAt: ap.updated_at,
        type: 'transcript',
        title: 'Transcripción recibida',
        detail: ap.ai_summary ? ap.ai_summary.slice(0, 140) : null,
        source: 'Fathom',
        transcriptRef: ap.id,
      })
    }
  }

  for (const s of sales) {
    events.push({
      id: `sale_${s.id}`,
      occurredAt: s.sale_date,
      type: 'sale',
      title: SALE_STATUS_LABELS[s.status] || 'Venta',
      detail: formatCurrency(Number(s.gross_amount)),
      source: null,
    })
  }

  for (const n of notes) {
    events.push({
      id: `note_${n.id}`,
      occurredAt: n.created_at,
      type: 'note',
      title: 'Nota añadida',
      detail: n.note.length > 140 ? `${n.note.slice(0, 140)}…` : n.note,
      source: n.author?.full_name || null,
    })
  }

  return events.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
}
