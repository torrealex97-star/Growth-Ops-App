// Timeline unificada de un contacto (Contacto → Atribución → Agendas → Transcripciones → Ventas →
// Notas → Pagos → Impagos → CSM → Feedback) construida a partir de las tablas normalizadas que YA
// existen (contacts, contact_attributions, appointments, sales, contact_notes, collections,
// sale_expected_installments, csm_events) — sin escribir a canonical_events ni tocar el pipeline
// de ingesta. Es una vista de lectura, no una nueva fuente de verdad.
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

export type TimelineEventType =
  | 'attribution'
  | 'created'
  | 'appointment'
  | 'transcript'
  | 'recording'
  | 'activity'
  | 'contract'
  | 'sale'
  | 'payment'
  | 'delinquency'
  | 'csm'
  | 'feedback'
  | 'note' // prettier: mantiene la unión en multilínea para que el contrato del tipo quede legible

export type TimelineEvent = {
  id: string
  occurredAt: string
  type: TimelineEventType
  title: string
  detail: string | null
  source: string | null
  href?: string | null
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
  recording_url?: string | null
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
type ActivityInput = {
  id: string
  type: string
  direction: string | null
  result: string | null
  notes: string | null
  created_at: string
}
type ContractInput = {
  id: string
  title: string | null
  status: string
  url: string | null
  signed_at: string | null
  created_at: string
}
type PaymentInput = {
  id: string
  collected_at: string
  gross_amount: number | string
  status: string
  payment_provider: string | null
}
type DelinquencyInput = {
  id: string
  due_date: string | null
  expected_gross_amount: number | string
  status: string
  installment_number: number
}
type CsmEventInput = {
  id: string
  type: string
  event_datetime: string
  status: string | null
  grade: number | null
  success: string | null
  recording_url: string | null
  notes: string | null
}
type FeedbackInput = {
  answers: { q: string; a: string }[]
  updatedAt: string | null
}

export function buildContactTimeline(
  attributions: AttributionInput[],
  appointments: AppointmentInput[],
  sales: SaleInput[],
  notes: NoteInput[],
  activities: ActivityInput[] = [],
  contracts: ContractInput[] = [],
  extras: {
    contact?: { createdAt: string | null; fullName: string | null } | null
    payments?: PaymentInput[]
    delinquencies?: DelinquencyInput[]
    csmEvents?: CsmEventInput[]
    feedback?: FeedbackInput | null
    saleRecordings?: {
      saleId: string
      appointmentId: string | null
      recordingUrl: string | null
      occurredAt: string | null
    }[]
  } = {}
): TimelineEvent[] {
  const events: TimelineEvent[] = []

  // CREACIÓN DEL CONTACTO — el origen de toda la trazabilidad (de dónde vino, cuándo entró).
  if (extras.contact?.createdAt) {
    events.push({
      id: 'created_contact',
      occurredAt: extras.contact.createdAt,
      type: 'created',
      title: 'Contacto creado',
      detail: extras.contact.fullName
        ? `Ficha de ${extras.contact.fullName} dada de alta en la app`
        : 'Ficha dada de alta en la app',
      source: null,
    })
  }

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
      href: `/crm/agendas?appointmentId=${encodeURIComponent(ap.id)}`,
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
        href: `/crm/agendas?appointmentId=${encodeURIComponent(ap.id)}`,
      })
    }
    // GRABACIÓN DE LLAMADA (Fathom/GHL): enlazada a la cita que la originó.
    if (ap.recording_url) {
      events.push({
        id: `recording_${ap.id}`,
        occurredAt: ap.appointment_datetime,
        type: 'recording',
        title: 'Grabación de llamada',
        detail: ap.ai_summary ? ap.ai_summary.slice(0, 140) : null,
        source: 'Grabación',
        href: ap.recording_url,
      })
    }
  }

  for (const activity of activities) {
    events.push({
      id: `activity_${activity.id}`,
      occurredAt: activity.created_at,
      type: 'activity',
      title: activity.type === 'llamada' ? 'Llamada registrada' : `Interacción: ${activity.type}`,
      detail: activity.notes || activity.result || activity.direction,
      source: activity.direction,
    })
  }

  for (const s of sales) {
    events.push({
      id: `sale_${s.id}`,
      occurredAt: s.sale_date,
      type: 'sale',
      title: SALE_STATUS_LABELS[s.status] || 'Venta',
      detail: formatCurrency(Number(s.gross_amount)),
      source: null,
      href: `/ventas/registro/${encodeURIComponent(s.id)}`,
    })
  }

  // PAGOS RECIBIDOS — cada cobro real de sus ventas (Stripe, manual, transferencia…).
  for (const p of extras.payments ?? []) {
    const proveedor = p.payment_provider ? ` · ${p.payment_provider}` : ''
    events.push({
      id: `payment_${p.id}`,
      occurredAt: p.collected_at,
      type: 'payment',
      title: p.status === 'reversed' ? 'Cobro revertido' : 'Pago recibido',
      detail: `${formatCurrency(Number(p.gross_amount))}${proveedor}`,
      source: p.payment_provider,
      href: null,
    })
  }

  // IMPAGOS — cuotas vencidas sin cobrar (por recolectar → rojo hasta que se soluciona).
  for (const d of extras.delinquencies ?? []) {
    const vencida = !d.due_date || d.due_date <= new Date().toISOString().split('T')[0]
    if (!vencida) continue
    events.push({
      id: `delinquency_${d.id}`,
      occurredAt: `${d.due_date}T12:00:00Z`,
      type: 'delinquency',
      title: 'Impago de cuota',
      detail: `Cuota #${d.installment_number} de ${formatCurrency(Number(d.expected_gross_amount))} vencida sin cobrar`,
      source: 'Cobros',
      href: null,
    })
  }

  // EVENTOS CSM — onboarding, sesiones de coaching, feedback de clases (con nota y grabación).
  for (const e of extras.csmEvents ?? []) {
    const detalle = [e.notes?.slice(0, 140), e.grade != null ? `Nota: ${e.grade}/10` : null, e.success]
      .filter(Boolean)
      .join(' · ')
    events.push({
      id: `csm_${e.id}`,
      occurredAt: e.event_datetime,
      type: 'csm',
      title: `CSM: ${e.type}` + (e.status ? ` (${e.status})` : ''),
      detail: detalle || null,
      source: e.recording_url ? 'Con grabación' : 'CSM',
      href: e.recording_url,
    })
  }

  // FEEDBACK DEL FORMULARIO — lo que el contacto respondió al registrarse (contacts.qualification).
  if (extras.feedback?.answers?.length && extras.feedback.updatedAt) {
    const respuestas = extras.feedback.answers
      .slice(0, 3)
      .map((r) => `${r.q}: ${r.a}`)
      .join(' | ')
    events.push({
      id: 'feedback_contact',
      occurredAt: extras.feedback.updatedAt,
      type: 'feedback',
      title: `Feedback del formulario (${extras.feedback.answers.length} respuestas)`,
      detail: respuestas.length > 200 ? `${respuestas.slice(0, 200)}…` : respuestas,
      source: 'Formulario',
      href: null,
    })
  }

  for (const contract of contracts) {
    events.push({
      id: `contract_${contract.id}`,
      occurredAt: contract.signed_at || contract.created_at,
      type: 'contract',
      title: contract.title || 'Contrato',
      detail: contract.status,
      source: 'Contratos',
      href: contract.url,
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
