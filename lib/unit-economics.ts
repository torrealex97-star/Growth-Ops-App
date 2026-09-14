import { ACTIVE_SALE_STATUSES } from '@/lib/analytics'

// Lógica pura de agregación por canal (CAC/LTV) de Unit Economics, extraída del
// componente de página para poder testearla sin un transform de JSX (ver
// tests/metrics/unit-economics.test.mjs y docs/METRICS.md sección 6).

export type CampaignRow = {
  id: string
  channel: string
  adspend: number | string | null
  leads_generated: number | string | null
  impressions?: number | string | null
  clicks?: number | string | null
  /** Cuenta publicitaria de origen (act_XXX). Es lo que permite mostrar SOLO las seleccionadas. */
  account_id?: string | null
}
export type SaleRow = {
  id: string
  gross_amount: number | string | null
  status: string
  contact_id: string | null
  sale_date?: string | null
}
export type ContactRow = {
  id: string
  campaign_id: string | null
}

export type ChannelRow = {
  channel: string
  adspend: number
  leads: number
  cpl: number | null
  customers: number
  cac: number | null
  revenue: number
  roas: number | null
}

const num = (x: number | string | null | undefined) => Number(x ?? 0)

export function buildChannelRows(campaigns: CampaignRow[], sales: SaleRow[], contacts: ContactRow[]): ChannelRow[] {
  // campaign id -> channel
  const campaignChannel = new Map<string, string>()
  for (const c of campaigns) campaignChannel.set(c.id, c.channel || 'Sin canal')

  // contact id -> channel (via contacts.campaign_id -> campaign.channel)
  const contactChannel = new Map<string, string>()
  for (const ct of contacts) {
    if (ct.campaign_id) {
      const ch = campaignChannel.get(ct.campaign_id)
      if (ch) contactChannel.set(ct.id, ch)
    }
  }

  const agg = new Map<string, ChannelRow>()
  const ensure = (channel: string) =>
    agg.get(channel) ??
    agg
      .set(channel, { channel, adspend: 0, leads: 0, cpl: null, customers: 0, cac: null, revenue: 0, roas: null })
      .get(channel)!

  for (const c of campaigns) {
    const row = ensure(c.channel || 'Sin canal')
    row.adspend += num(c.adspend)
    row.leads += num(c.leads_generated)
  }

  // "customers" = clientes ÚNICOS (contact_id distinto), no nº de ventas — un mismo cliente con
  // 2 ventas activas en el canal no debe contar como 2 clientes (infla artificialmente el CAC
  // hacia abajo y hace parecer el canal más eficiente de lo que es).
  const seenPerChannel = new Map<string, Set<string>>()
  for (const s of sales) {
    if (!ACTIVE_SALE_STATUSES.includes(s.status) || !s.contact_id) continue
    const channel = contactChannel.get(s.contact_id)
    if (!channel) continue
    const row = ensure(channel)
    const seen = seenPerChannel.get(channel) ?? seenPerChannel.set(channel, new Set()).get(channel)!
    if (!seen.has(s.contact_id)) {
      seen.add(s.contact_id)
      row.customers += 1
    }
    row.revenue += num(s.gross_amount)
  }

  agg.forEach((row) => {
    row.cpl = row.leads ? row.adspend / row.leads : null
    row.cac = row.customers ? row.adspend / row.customers : null
    row.roas = row.adspend ? row.revenue / row.adspend : null
  })

  return Array.from(agg.values()).sort((a, b) => b.adspend - a.adspend)
}

// ---------------------------------------------------------------------------------------------
// MÉTRICAS GLOBALES DE VENTAS — todas, vengan de donde vengan.
//
// La diferencia con el embudo de marketing de arriba es deliberada y hay que respetarla: ese mide
// lo ATRIBUIBLE a los anuncios (impresiones → clics → leads → citas de contactos con campaña), y
// tiene sentido que deje fuera lo orgánico. Pero las métricas globales del negocio no pueden
// heredar ese filtro: una agenda que entró por la web o por recomendación es una agenda igual, y
// dejarla fuera hacía que la pantalla dijera 0 citas con 559 en la base.
//
// El origen pasa a ser un FILTRO opcional, no una condición de entrada.

export type AttributionFilter = 'todos' | 'ads' | 'organico'

export type AppointmentLike = {
  contact_id: string | null
  status: string
  appointment_datetime?: string | null
  pipe_value?: number | string | null
}

/**
 * Estados que NO cuentan como cita viva. Están en inglés porque así los escribe Calendly, que es
 * quien las crea: buscar 'cancelada' devolvía cero canceladas y daba un show-up del 100 %.
 */
export const CANCELLED_APPOINTMENT_STATUSES = ['cancelled', 'canceled', 'cancelada', 'no_show_cancel']

export function isCancelled(status: string | null | undefined): boolean {
  return CANCELLED_APPOINTMENT_STATUSES.includes((status ?? '').trim().toLowerCase())
}

/**
 * Reunión grabada en Fathom que NO se pudo emparejar con ninguna cita del CRM (la cola de revisión).
 * Son llamadas que OCURRIERON —están grabadas y transcritas— de gente que no tenía cita en Calendly.
 */
export type FathomSinCita = { meeting_started_at: string | null; invitee_email?: string | null }

export type SalesOverview = {
  agendas: number
  canceladas: number
  shows: number
  /** Llamadas de Fathom sin cita asociada, contadas dentro de `shows` pero visibles aparte. */
  llamadasSinCita: number
  ventas: number
  facturacion: number
  pipeValue: number
  /** % de citas no canceladas sobre el total agendado. */
  tasaAsistencia: number | null
  /** % de ventas sobre citas con asistencia. */
  tasaCierre: number | null
}

/**
 * `ahora` se inyecta para poder fijarlo en el test. Una cita FUTURA no cuenta como show todavía:
 * contarla daría una asistencia que aún no ha ocurrido, y esa cifra se usa para decidir.
 */
export function buildSalesOverview(
  appointments: AppointmentLike[],
  sales: SaleRow[],
  contacts: ContactRow[],
  filtro: AttributionFilter = 'todos',
  ahora: Date = new Date(),
  fathomSinCita: FathomSinCita[] = []
): SalesOverview {
  const conCampana = new Set(contacts.filter((c) => c.campaign_id).map((c) => c.id))
  const pasaFiltro = (contactId: string | null) => {
    if (filtro === 'todos') return true
    const atribuido = !!contactId && conCampana.has(contactId)
    return filtro === 'ads' ? atribuido : !atribuido
  }

  const citas = appointments.filter((a) => pasaFiltro(a.contact_id))
  const canceladas = citas.filter((a) => isCancelled(a.status))
  const vivas = citas.filter((a) => !isCancelled(a.status))
  const yaPasadas = vivas.filter((a) => {
    if (!a.appointment_datetime) return true
    const t = Date.parse(a.appointment_datetime)
    return Number.isNaN(t) || t <= ahora.getTime()
  })

  // Las reuniones de Fathom sin cita son llamadas que ocurrieron: están grabadas. NO se pueden
  // atribuir a un origen (no hay contacto con el que mirar la campaña), así que solo cuentan cuando
  // se está mirando el total. Sumarlas en "solo anuncios" sería inventarles una procedencia.
  const llamadasSinCita = filtro === 'todos' ? fathomSinCita.length : 0
  const showsTotales = yaPasadas.length + llamadasSinCita

  const ventasActivas = sales.filter((s) => ACTIVE_SALE_STATUSES.includes(s.status) && pasaFiltro(s.contact_id))
  const facturacion = ventasActivas.reduce((a, s) => a + num(s.gross_amount), 0)
  const pipeValue = vivas.reduce((a, s) => a + num(s.pipe_value), 0)

  return {
    agendas: citas.length,
    canceladas: canceladas.length,
    shows: showsTotales,
    llamadasSinCita,
    ventas: ventasActivas.length,
    facturacion,
    pipeValue,
    // La asistencia se mide SOLO sobre lo agendado: meter en el numerador llamadas que nunca se
    // agendaron daría porcentajes por encima del 100 %.
    tasaAsistencia: citas.length ? (yaPasadas.length / citas.length) * 100 : null,
    tasaCierre: showsTotales ? (ventasActivas.length / showsTotales) * 100 : null,
  }
}
