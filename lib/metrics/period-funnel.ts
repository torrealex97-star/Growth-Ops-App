import { cuentaComoVenta, leadDate } from '@/lib/analytics'
import { isAttended } from '@/lib/appointments/status'
import { canonicalizeLeads, canonicalizeAppointments } from '@/lib/canonical/dedup'
import { inPeriod, type PeriodRange } from '@/lib/filters/period'
import { resolverOferta } from '@/lib/metrics/oferta'
import type { ContactRow, SaleRow } from '@/lib/unit-economics'

type Appointment = {
  id: string
  contact_id: string | null
  status: string
  appointment_datetime: string | null
  offered?: boolean | null
  result?: string | null
}

// Deduplicar antes de filtrar evita contar como nuevo un duplicado importado este mes.
// Son hechos del periodo, NO una cohorte enlazada: no permiten inferir conversiones.
export function buildPeriodFunnel(
  contacts: ContactRow[],
  appointments: Appointment[],
  sales: SaleRow[],
  hasPeriod: boolean,
  range: PeriodRange,
  now = new Date()
) {
  const visible = (date: string | null | undefined) => !hasPeriod || inPeriod(date, range)
  const { leads } = canonicalizeLeads(
    contacts.map((c) => ({
      ...c,
      email: c.email ?? null,
      phone: c.phone ?? null,
      created_at: leadDate(c) || null,
    }))
  )
  const { appointments: canonical } = canonicalizeAppointments(
    appointments.map((a) => ({
      id: a.id,
      contact_id: a.contact_id,
      status: a.status,
      calendly_event_id: null,
      calendar_event_id: null,
      scheduled_at: a.appointment_datetime,
    }))
  )
  const byId = new Map(appointments.map((a) => [a.id, a]))
  const booked = canonical.map((a) => byId.get(a.appointmentId)!).filter((a) => visible(a.appointment_datetime))
  const attended = booked.filter(
    (a) => isAttended(a.status) && (!a.appointment_datetime || Date.parse(a.appointment_datetime) <= now.getTime())
  )
  const offers = attended.map((a) => resolverOferta(a))
  const active = sales.filter((s) => cuentaComoVenta(s) && visible(s.sale_date))
  const attributed = new Set(contacts.filter((c) => c.campaign_id).map((c) => c.id))
  const attributedSales = active.filter((s) => s.contact_id && attributed.has(s.contact_id))
  return {
    leads: leads.filter((l) => visible(l.createdAt)).length,
    agendas: booked.length,
    asistencias: attended.length,
    cierres: active.length,
    facturacion: active.reduce((sum, s) => sum + Number(s.gross_amount ?? 0), 0),
    offers: offers.filter((o) => o.valor === true).length,
    offersDeclaradas: offers.filter((o) => o.valor === true && o.origen === 'declarado').length,
    atribuidos: {
      agendas: booked.filter((a) => a.contact_id && attributed.has(a.contact_id)).length,
      cierres: attributedSales.length,
      facturacion: attributedSales.reduce((sum, s) => sum + Number(s.gross_amount ?? 0), 0),
    },
  }
}
