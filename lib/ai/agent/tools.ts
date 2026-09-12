// Capa de acceso a datos para el agente de IA — el modelo NUNCA recibe una conexión SQL ni un
// tenant_id que pueda elegir: cada tool recibe el tenant_id ya resuelto en el servidor (por
// requireTenant, antes de que exista este módulo) y lo aplica explícitamente a cada query, igual
// que el resto de endpoints admin de la app (ver app/api/[tenant]/evergreen/admin/*). Todas las
// tools son de solo lectura, devuelven resultados acotados (LIMIT) y solo consultan las tablas de
// negocio ya canónicas — no hay una capa de datos paralela.
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAdFunnel, perCampaign, type AdFunnel } from '@/lib/ads/funnel'
import { buildContactTimeline, type TimelineEvent } from '@/lib/contact-timeline'
import { isActiveSale } from '@/lib/analytics'
import type { Campaign, ContactAttribution, Appointment, Sale, ContactNote } from '@/lib/types/database'

export type ToolContext = { tenantId: string; sb: SupabaseClient }

// Periodo en fechas YYYY-MM-DD. Sin "from"/"to" = todo el histórico disponible (acotado por
// row limits en cada query, nunca "trae toda la tabla").
export type Period = { from?: string; to?: string }

const inPeriod = (dateStr: string | null, p: Period): boolean => {
  if (!dateStr) return false
  const d = dateStr.slice(0, 10)
  if (p.from && d < p.from) return false
  if (p.to && d > p.to) return false
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// getBusinessOverview — resumen ejecutivo rápido: inversión, leads, ventas, ingresos del periodo.
// Primera parada para preguntas tipo "¿qué ha cambiado?" / "resumen del negocio".
// ─────────────────────────────────────────────────────────────────────────────
export async function getBusinessOverview({ tenantId, sb }: ToolContext, period: Period) {
  const [{ data: campaigns }, { data: sales }, { data: contacts }] = await Promise.all([
    sb.from('campaigns').select('*').eq('tenant_id', tenantId).limit(500),
    sb
      .from('sales')
      .select('id,sale_date,gross_amount,status')
      .eq('tenant_id', tenantId)
      .gte('sale_date', period.from || '1970-01-01')
      .lte('sale_date', period.to || '2999-12-31')
      .limit(2000),
    sb.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
  ])

  const periodCampaigns = ((campaigns as Campaign[]) || []).filter(
    (c) => !period.from || !c.start_date || inPeriod(c.start_date, period) || !c.end_date
  )
  const funnel = computeAdFunnel(periodCampaigns)
  const activeSales = (sales || []).filter((s) => isActiveSale(s as { status: string }))
  const revenue = activeSales.reduce((sum, s) => sum + (s.gross_amount || 0), 0)

  return {
    period,
    inversion: funnel.inversion,
    leads: funnel.leads,
    agendas: funnel.agendas,
    cpl: funnel.cpl,
    roas: funnel.roas,
    ventas: activeSales.length,
    ingresos: revenue,
    total_contactos: contacts?.length ?? null,
    campanas_activas: periodCampaigns.filter((c) => c.status === 'activa').length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getFunnel — embudo de ads completo (mismas fórmulas que la pantalla de Campañas:
// lib/ads/funnel.ts), para no calcular métricas "a mano" en el LLM.
// ─────────────────────────────────────────────────────────────────────────────
export async function getFunnel({ tenantId, sb }: ToolContext, period: Period): Promise<AdFunnel> {
  const { data } = await sb.from('campaigns').select('*').eq('tenant_id', tenantId).limit(500)
  const campaigns = ((data as Campaign[]) || []).filter(
    (c) => !period.from || !c.start_date || inPeriod(c.start_date, period)
  )
  return computeAdFunnel(campaigns)
}

// ─────────────────────────────────────────────────────────────────────────────
// getCampaignPerformance — rendimiento por campaña (opcionalmente filtrado por nombre), con las
// métricas derivadas ya calculadas — el modelo puede comparar sin inventar fórmulas.
// ─────────────────────────────────────────────────────────────────────────────
export async function getCampaignPerformance(
  { tenantId, sb }: ToolContext,
  opts: { period?: Period; nameContains?: string }
) {
  const { data } = await sb.from('campaigns').select('*').eq('tenant_id', tenantId).limit(500)
  let campaigns = (data as Campaign[]) || []
  if (opts.period)
    campaigns = campaigns.filter((c) => !opts.period!.from || !c.start_date || inPeriod(c.start_date, opts.period!))
  if (opts.nameContains) {
    const q = opts.nameContains.toLowerCase()
    campaigns = campaigns.filter((c) => c.name.toLowerCase().includes(q))
  }
  return perCampaign(campaigns.slice(0, 100))
}

// ─────────────────────────────────────────────────────────────────────────────
// getContacts — búsqueda acotada de contactos por nombre/email/teléfono. Devuelve solo los
// campos de negocio necesarios para identificar y triar, no el registro completo.
// ─────────────────────────────────────────────────────────────────────────────
export async function getContacts({ tenantId, sb }: ToolContext, query: string, limit = 10) {
  const safeLimit = Math.min(Math.max(limit, 1), 25)
  const q = query.trim()
  if (!q) return []
  const { data } = await sb
    .from('contacts')
    .select('id,full_name,email,phone,lead_status,lead_channel,created_at')
    .eq('tenant_id', tenantId)
    .is('merged_into', null)
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
    .order('created_at', { ascending: false })
    .limit(safeLimit)
  return data || []
}

// ─────────────────────────────────────────────────────────────────────────────
// getContactTimeline — historia completa de un contacto (atribución → cita → transcripción →
// venta), reutilizando lib/contact-timeline.ts (misma fuente que la pestaña "Timeline" del CRM).
// Verifica explícitamente que el contacto pertenece a ESTE tenant antes de devolver nada.
// ─────────────────────────────────────────────────────────────────────────────
export async function getContactTimeline(
  { tenantId, sb }: ToolContext,
  contactId: string
): Promise<{ contact: { id: string; full_name: string } | null; timeline: TimelineEvent[] }> {
  const { data: contact } = await sb
    .from('contacts')
    .select('id,full_name')
    .eq('tenant_id', tenantId)
    .eq('id', contactId)
    .maybeSingle()
  if (!contact) return { contact: null, timeline: [] }

  const [{ data: attributions }, { data: appointments }, { data: sales }, { data: notes }] = await Promise.all([
    sb.from('contact_attributions').select('*').eq('tenant_id', tenantId).eq('contact_id', contactId),
    sb.from('appointments').select('*').eq('tenant_id', tenantId).eq('contact_id', contactId),
    sb.from('sales').select('*').eq('tenant_id', tenantId).eq('contact_id', contactId),
    sb.from('contact_notes').select('*').eq('contact_id', contactId).limit(50),
  ])

  const timeline = buildContactTimeline(
    (attributions as ContactAttribution[]) || [],
    (appointments as Appointment[]) || [],
    (sales as Sale[]) || [],
    (notes as ContactNote[]) || []
  )
  return { contact, timeline }
}

// ─────────────────────────────────────────────────────────────────────────────
// searchTranscripts — búsqueda por palabra clave en transcripciones de llamadas (Fathom) de
// ESTE tenant. Búsqueda por keyword, no semántica (no hay pgvector todavía) — devuelve el
// fragmento relevante, no la transcripción completa, para no inflar el contexto del LLM.
// ─────────────────────────────────────────────────────────────────────────────
export async function searchTranscripts({ tenantId, sb }: ToolContext, query: string, limit = 8) {
  const safeLimit = Math.min(Math.max(limit, 1), 20)
  const q = query.trim()
  if (!q) return []
  const { data } = await sb
    .from('appointments')
    .select('id,contact_id,appointment_datetime,transcript,ai_summary,contacts(full_name)')
    .eq('tenant_id', tenantId)
    .not('transcript', 'is', null)
    .ilike('transcript', `%${q}%`)
    .order('appointment_datetime', { ascending: false })
    .limit(safeLimit)

  return (data || []).map((row) => {
    const r = row as unknown as {
      id: string
      contact_id: string
      appointment_datetime: string
      transcript: string
      ai_summary: string | null
      contacts: { full_name: string } | null
    }
    const idx = r.transcript.toLowerCase().indexOf(q.toLowerCase())
    const start = Math.max(0, idx - 200)
    const snippet = r.transcript.slice(start, start + 500)
    return {
      appointment_id: r.id,
      contact_id: r.contact_id,
      contact_name: r.contacts?.full_name ?? null,
      date: r.appointment_datetime,
      summary: r.ai_summary,
      snippet: idx >= 0 ? snippet : r.transcript.slice(0, 500),
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// getSales — resumen de ventas/cobros del periodo (solo ventas activas, misma definición
// canónica que docs/METRICS.md: isActiveSale / ACTIVE_SALE_STATUSES).
// ─────────────────────────────────────────────────────────────────────────────
export async function getSales({ tenantId, sb }: ToolContext, period: Period, limit = 20) {
  const { data } = await sb
    .from('sales')
    .select('id,contact_id,sale_date,gross_amount,status,contacts(full_name)')
    .eq('tenant_id', tenantId)
    .gte('sale_date', period.from || '1970-01-01')
    .lte('sale_date', period.to || '2999-12-31')
    .order('sale_date', { ascending: false })
    .limit(500)

  const rows = (data || []) as unknown as Array<{
    id: string
    contact_id: string
    sale_date: string
    gross_amount: number
    status: string
    contacts: { full_name: string } | null
  }>
  const active = rows.filter((r) => isActiveSale({ status: r.status }))
  const total = active.reduce((s, r) => s + (r.gross_amount || 0), 0)
  return {
    period,
    total_ventas: active.length,
    ingresos: total,
    ticket_medio: active.length > 0 ? total / active.length : null,
    ultimas_ventas: active.slice(0, Math.min(Math.max(limit, 1), 50)).map((r) => ({
      contact_name: r.contacts?.full_name ?? null,
      sale_date: r.sale_date,
      gross_amount: r.gross_amount,
    })),
  }
}
