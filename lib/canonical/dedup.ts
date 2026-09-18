// ─────────────────────────────────────────────────────────────────────────────
// ENTIDADES CANÓNICAS (§17 de la spec del dashboard global)
// ─────────────────────────────────────────────────────────────────────────────
// Cada registro externo mapea a UNA entidad canónica. Una persona que entra por Typeform y luego
// Calendly es UN lead; un evento de Calendly que llega también a Google Calendar es UNA agenda;
// una venta presente en CRM y en la plataforma interna es UNA venta. Funciones PURAS: reciben
// registros ya traídos y devuelven el consolidado + el diagnóstico de calidad (testeables sin BD).

export type MatchKind = 'exact_id' | 'email' | 'phone' | 'external_id' | 'none'

// Normaliza teléfonos: dígitos, sin prefijo doble ni espacios. +34 600 100 100 y 600100100
// NO son el mismo número siempre (prefijo país), pero la variante con/sin '+' sí.
export const normPhone = (p: string | null | undefined): string | null => {
  if (!p) return null
  const digits = String(p).replace(/[^\d]/g, '')
  return digits.length >= 7 ? digits : null
}

export const normEmail = (e: string | null | undefined): string | null => {
  if (!e) return null
  const v = String(e).trim().toLowerCase()
  return v.includes('@') ? v : null
}

// ── LEAD CANÓNICO (§6): exact email > exact phone > external id ─────────────
export type LeadInput = {
  id: string
  email: string | null
  phone: string | null
  external_id?: string | null // ghl_contact_id, typeform lead ref, calendly uri…
  created_at: string | null
}

export type CanonicalLead<T extends LeadInput> = {
  leadId: string
  createdAt: string | null
  members: T[]
  match: MatchKind
  /** true si al menos dos fuentes distintas aportaron registros del mismo lead. */
  consolidated: boolean
}

/**
 * Consolida registros en leads canónicos. Orden (§6): email exacto → teléfono exacto → id externo.
 * Dos registros se unen SOLO con evidencia (§6: "no crear dos leads salvo evidencia de que son
 * la misma persona"); sin email/teléfono/id no se une nadie — mejor un duplicado honesto que una
 * fusión inventada.
 */
export function canonicalizeLeads<T extends LeadInput>(
  rows: T[]
): {
  leads: CanonicalLead<T>[]
  duplicates: number
} {
  const byEmail = new Map<string, CanonicalLead<T>>()
  const byPhone = new Map<string, CanonicalLead<T>>()
  const byExternal = new Map<string, CanonicalLead<T>>()
  const leads: CanonicalLead<T>[] = []

  // Orden de entrada = orden temporal (los tests pasan ordenado; si no, created_at manda).
  const ordered = [...rows].sort(
    (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
  )

  for (const r of ordered) {
    const email = normEmail(r.email)
    const phone = normPhone(r.phone)
    let existing: CanonicalLead<T> | undefined
    let match: MatchKind = 'none'

    if (email && byEmail.has(email)) {
      existing = byEmail.get(email)
      match = 'email'
    } else if (phone && byPhone.has(phone)) {
      existing = byPhone.get(phone)
      match = 'phone'
    } else if (r.external_id && byExternal.has(r.external_id)) {
      existing = byExternal.get(r.external_id)
      match = 'external_id'
    }

    if (existing) {
      existing.members.push(r)
      existing.match = match === 'none' ? existing.match : match
      // Enriquecer con el email/teléfono que llegue después (el canónico gana información).
      if (email && !existing.members.some((m) => normEmail(m.email) === email)) byEmail.set(email, existing)
      if (phone && !byPhone.has(phone)) byPhone.set(phone, existing)
      if (r.external_id && !byExternal.has(r.external_id)) byExternal.set(r.external_id, existing)
      continue
    }

    const lead: CanonicalLead<T> = {
      leadId: r.id,
      createdAt: r.created_at,
      members: [r],
      match: 'exact_id',
      consolidated: false,
    }
    leads.push(lead)
    if (email) byEmail.set(email, lead)
    if (phone) byPhone.set(phone, lead)
    if (r.external_id) byExternal.set(r.external_id, lead)
  }

  const duplicates = leads.reduce((n, l) => n + (l.members.length - 1), 0)
  return { leads, duplicates }
}

// ── AGENDAS CANÓNICAS (§8): Calendly ≡ Google Calendar ≡ CRM ────────────────
export type AppointmentInput = {
  id: string
  contact_id: string | null
  calendly_event_id: string | null
  calendar_event_id: string | null
  scheduled_at: string | null
  status: string
}

/**
 * Consolida agendas: (calendly_event_id | calendar_event_id | contacto+fecha) repetido = UNA cita.
 */
export function canonicalizeAppointments(rows: AppointmentInput[]): {
  appointments: { appointmentId: string; row: AppointmentInput; merged: number }[]
  duplicates: number
} {
  const byEvent = new Map<string, { appointmentId: string; row: AppointmentInput; merged: number }>()
  const byContactSlot = new Map<string, { appointmentId: string; row: AppointmentInput; merged: number }>()
  const out: { appointmentId: string; row: AppointmentInput; merged: number }[] = []

  for (const r of rows) {
    const evKey = r.calendly_event_id
      ? `ce:${r.calendly_event_id}`
      : r.calendar_event_id
        ? `gc:${r.calendar_event_id}`
        : null
    const slotKey =
      r.contact_id && r.scheduled_at
        ? `cs:${r.contact_id}:${new Date(r.scheduled_at).toISOString().slice(0, 16)}`
        : null

    const hit = (evKey && byEvent.get(evKey)) || (slotKey && byContactSlot.get(slotKey))
    if (hit) {
      hit.merged += 1
      continue
    }
    const item = { appointmentId: r.id, row: r, merged: 0 }
    out.push(item)
    if (evKey) byEvent.set(evKey, item)
    if (slotKey) byContactSlot.set(slotKey, item)
  }
  const duplicates = out.reduce((n, x) => n + x.merged, 0)
  return { appointments: out, duplicates }
}

// ── VENTAS/PAGOS: una venta ≠ N ventas por aparecer en dos sistemas (§10) ───
export type SaleInput = {
  id: string
  contact_id: string | null
  opportunity_id: string | null
  closed_at: string | null
  amount: number
}

/** Dos filas de venta son LA MISMA si comparten opportunity_id o (contacto+fecha+importe). */
export function dedupeSales(rows: SaleInput[]): { unique: SaleInput[]; duplicates: number } {
  const byOpp = new Map<string, SaleInput>()
  const byTriplet = new Map<string, SaleInput>()
  const unique: SaleInput[] = []
  let duplicates = 0

  for (const s of rows) {
    const oppKey = s.opportunity_id ? `op:${s.opportunity_id}` : null
    const triKey =
      s.contact_id && s.closed_at ? `t:${s.contact_id}:${s.closed_at.slice(0, 10)}:${Math.round(s.amount * 100)}` : null
    const hit = (oppKey && byOpp.get(oppKey)) || (triKey && byTriplet.get(triKey))
    if (hit) {
      duplicates++
      continue
    }
    unique.push(s)
    if (oppKey) byOpp.set(oppKey, s)
    if (triKey) byTriplet.set(triKey, s)
  }
  return { unique, duplicates }
}

// ── PAGOS: dedup por payment_id/transaction_id o (cliente+importe+timestamp) (§2) ──
export type PaymentInput = {
  id: string
  transaction_id: string | null
  customer_id: string | null
  amount: number
  paid_at: string | null
  status: string // collected | pending | failed | refunded…
}

/** Solo cuentan como cash los pagos liquidados; el mismo pago en dos sistemas cuenta UNA vez. */
export function canonicalizePayments(rows: PaymentInput[]): {
  cash: PaymentInput[]
  duplicates: number
} {
  const seen = new Map<string, PaymentInput>()
  const cash: PaymentInput[] = []
  let duplicates = 0

  for (const p of rows) {
    if (p.status !== 'collected') continue // failed/pending/void NO son cash (§2)
    const key = p.transaction_id ? `tx:${p.transaction_id}` : p.id ? `id:${p.id}` : null
    const softKey =
      !key && p.customer_id && p.paid_at
        ? `s:${p.customer_id}:${Math.round(p.amount * 100)}:${p.paid_at.slice(0, 12)}`
        : null
    const mapKey = key ?? softKey
    if (mapKey && seen.has(mapKey)) {
      duplicates++
      continue
    }
    if (mapKey) seen.set(mapKey, p)
    cash.push(p)
  }
  return { cash, duplicates }
}

// ── Cobertura de atribución (§21) ───────────────────────────────────────────
export type CoverageInput = { total: number; attributed: number }

export const coveragePct = ({ total, attributed }: CoverageInput): number | null =>
  total > 0 ? Math.round((attributed / total) * 100) : null
