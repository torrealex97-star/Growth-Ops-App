// Capa de acceso a datos para el agente de IA — el modelo NUNCA recibe una conexión SQL ni un
// tenant_id que pueda elegir: cada tool recibe el tenant_id ya resuelto en el servidor (por
// requireTenant, antes de que exista este módulo) y lo aplica explícitamente a cada query, igual
// que el resto de endpoints admin de la app (ver app/api/[tenant]/evergreen/admin/*). Todas las
// tools son de solo lectura, devuelven resultados acotados (LIMIT) y solo consultan las tablas de
// negocio ya canónicas — no hay una capa de datos paralela.
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAdFunnel, perCampaign, type AdFunnel } from '@/lib/ads/funnel'
import { buildContactTimeline, type TimelineEvent } from '@/lib/contact-timeline'
import { cuentaComoVenta } from '@/lib/analytics'
import { metodoDePlan } from '@/lib/metrics/agregados'
import { parseAccountIds } from '@/lib/meta/accounts'
import { getMetricDefinition as lookupMetricDefinition } from '@/lib/ai/metrics/registry'
import {
  searchKnowledge as buscarKnowledgeChunks,
  type KnowledgeCategory,
  type KnowledgeType,
} from '@/lib/ai/knowledge'

// El gateway referencia `tools.KnowledgeCategory` y `tools.KnowledgeType` en el schema de la
// tool: re-exportar los tipos mantiene la definición en un solo sitio (lib/ai/knowledge.ts).
export type { KnowledgeCategory, KnowledgeType }
import type { Campaign, ContactAttribution, Appointment, Sale, ContactNote } from '@/lib/types/database'

export type ToolContext = {
  tenantId: string
  sb: SupabaseClient
  userId?: string
  /**
   * Instantánea de configuración del tenant (getTenantConfigWithFallback). La usan las tools que
   * necesitan credenciales de integración — hoy, el embedder de knowledge (OPENAI_API_KEY) para
   * la rama semántica del RAG. Nada se vuelca a process.env (lección de lib/config.ts).
   */
  env?: Record<string, string | undefined>
}

// Periodo en fechas YYYY-MM-DD. Sin "from"/"to" = todo el histórico disponible (acotado por
// row limits en cada query, nunca "trae toda la tabla").
export type Period = { from?: string; to?: string }

/**
 * Cuentas de ads seleccionadas en Integraciones, leídas de la instantánea de config que ya viaja en
 * el ToolContext (mismo parseo canónico que el resto de la app). La tabla `campaigns` conserva
 * históricos de cuentas deseleccionadas (el token ve todas las del business): sin este filtro, la
 * inversión y el CPL que el agente cita mezclan dinero que no es del negocio. Vacío = todas.
 */
function cuentasAdsDeContexto(env: Record<string, string | undefined> | undefined): string[] {
  return parseAccountIds(env?.META_AD_ACCOUNT_ID)
}

/** Filtra campañas por las cuentas seleccionadas. Una campaña sin cuenta (manual) siempre entra. */
function campanasDeCuentas<T extends { account_id?: string | null }>(filas: T[], cuentas: string[]): T[] {
  if (cuentas.length === 0) return filas
  const permitidas = new Set(cuentas)
  return filas.filter((f) => !f.account_id || permitidas.has(f.account_id))
}

const inPeriod = (dateStr: string | null, p: Period): boolean => {
  if (!dateStr) return false
  const d = dateStr.slice(0, 10)
  if (p.from && d < p.from) return false
  if (p.to && d > p.to) return false
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// searchKnowledge — recuperación RAG del conocimiento canónico (skills de ventas y marketing).
// Las fórmulas y guiones viven en la base (knowledge_chunks): el agente los RECUPERA en vez de
// improvisarlos (regla de CLAUDE.md). El tenant va cerrado por ToolContext y la RPC filtra por
// p_tenant; las categorías se exponen al modelo para afinar la búsqueda sin abrir el scope.
// ─────────────────────────────────────────────────────────────────────────────
export type KnowledgeHit = {
  id: string
  category: string
  title: string
  content: string
  source: string
  module: number
  section: string
}

export async function searchKnowledge(
  ctx: ToolContext,
  query: string,
  categories?: KnowledgeCategory[],
  limit = 5,
  types?: KnowledgeType[]
): Promise<KnowledgeHit[]> {
  const r = await buscarKnowledgeChunks(ctx.sb, ctx.tenantId, query, {
    categories,
    types,
    limit,
    embeddingEnv: ctx.env,
  })
  // Error de la RPC (tabla sin migrar, pgvector ausente...): se degrada a lista vacía — la tool
  // NO debe tumbar el turno del agente por un problema de índice de conocimiento. El gateway
  // registra el aviso en su log para detectar ingesta pendiente.
  if (!r.ok) {
    console.warn(`[knowledge] búsqueda fallida para tenant ${ctx.tenantId}: ${r.error}`)
    return []
  }
  return r.chunks.map((c) => ({
    id: c.id,
    category: c.category,
    title: c.title,
    content: c.content,
    source: c.source,
    module: c.module,
    section: c.section,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// getDataCoverage — qué fuentes tienen datos cargados y desde cuándo. Existe porque un 0 de una
// tabla VACÍA y un 0 medido significan cosas opuestas para el negocio: "no vendiste nada este mes"
// es un problema comercial, "no hay ninguna venta cargada en el sistema" es un problema de
// integración. Sin esta señal el agente presentaría lo segundo como lo primero.
// ─────────────────────────────────────────────────────────────────────────────
// filas = null significa "no se pudo leer", que NO es lo mismo que 0 ("vacía"). Confundirlos aquí
// reproduciría justo el error que esta tool existe para evitar.
export type SourceCoverage = {
  fuente: string
  filas: number | null
  desde: string | null
  hasta: string | null
  error?: string
}

const SOURCES: Array<{ fuente: string; table: string; dateColumn: string }> = [
  { fuente: 'ventas', table: 'sales', dateColumn: 'sale_date' },
  { fuente: 'campañas / ads', table: 'campaigns', dateColumn: 'start_date' },
  { fuente: 'cobros', table: 'collections', dateColumn: 'collected_at' },
  // first_seen_at = fecha real del lead (GHL dateAdded): created_at es la fecha de importación y
  // diría "los datos empiezan el día que se importó el histórico".
  { fuente: 'contactos', table: 'contacts', dateColumn: 'first_seen_at' },
  { fuente: 'citas', table: 'appointments', dateColumn: 'appointment_datetime' },
  { fuente: 'atribución de contactos', table: 'contact_attributions', dateColumn: 'created_at' },
]

export async function getDataCoverage({ tenantId, sb }: ToolContext): Promise<{
  fuentes: SourceCoverage[]
  fuentes_vacias: string[]
  fuentes_no_legibles: string[]
}> {
  const results = await Promise.all(
    SOURCES.map(async (s): Promise<SourceCoverage> => {
      // Las consultas de rango excluyen NULL en la columna de fecha: con ORDER BY DESC, Postgres
      // pone los NULL primero, así que una sola fila sin fecha dejaba "hasta" vacío aunque la
      // fuente estuviera completa.
      const [{ count, error: countError }, { data: first }, { data: last }] = await Promise.all([
        sb.from(s.table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        sb
          .from(s.table)
          .select(s.dateColumn)
          .eq('tenant_id', tenantId)
          .not(s.dateColumn, 'is', null)
          .order(s.dateColumn, { ascending: true })
          .limit(1),
        sb
          .from(s.table)
          .select(s.dateColumn)
          .eq('tenant_id', tenantId)
          .not(s.dateColumn, 'is', null)
          .order(s.dateColumn, { ascending: false })
          .limit(1),
      ])
      if (countError) {
        return { fuente: s.fuente, filas: null, desde: null, hasta: null, error: countError.message }
      }
      const pick = (rows: unknown): string | null => {
        const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined
        const v = row?.[s.dateColumn]
        return typeof v === 'string' ? v.slice(0, 10) : null
      }
      return { fuente: s.fuente, filas: count ?? 0, desde: pick(first), hasta: pick(last) }
    })
  )
  return {
    fuentes: results,
    fuentes_vacias: results.filter((r) => r.filas === 0).map((r) => r.fuente),
    fuentes_no_legibles: results.filter((r) => r.filas === null).map((r) => r.fuente),
  }
}

// Aviso compacto para incrustar en las respuestas de las tools de métricas: si la tabla que
// alimenta la métrica no tiene NI UNA fila, el 0 no es una medición. Un fallo de lectura se
// reporta aparte: dar por "vacía" una tabla que no se pudo consultar sería una alarma falsa.
async function emptySourceWarning(
  { tenantId, sb }: ToolContext,
  sources: Array<{ label: string; table: string }>
): Promise<string | null> {
  const counts = await Promise.all(
    sources.map(async (s) => {
      const { count, error } = await sb
        .from(s.table)
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
      return { label: s.label, empty: !error && (count ?? 0) === 0, unreadable: !!error }
    })
  )
  const empty = counts.filter((c) => c.empty).map((c) => c.label)
  const unreadable = counts.filter((c) => c.unreadable).map((c) => c.label)
  const parts: string[] = []
  if (empty.length > 0) {
    parts.push(
      `SIN DATOS CARGADOS en: ${empty.join(', ')}. Los ceros de estas métricas NO son una medición del negocio: esa fuente está vacía (nunca se ha sincronizado o se vació). Dilo explícitamente y no lo presentes como un resultado comercial.`
    )
  }
  if (unreadable.length > 0) {
    parts.push(
      `NO SE PUDO CONSULTAR: ${unreadable.join(', ')}. No afirmes que están vacías ni uses sus cifras: avisa de que la consulta falló.`
    )
  }
  return parts.length > 0 ? parts.join(' ') : null
}

// ─────────────────────────────────────────────────────────────────────────────
// getBusinessOverview — resumen ejecutivo rápido: inversión, leads, ventas, ingresos del periodo.
// Primera parada para preguntas tipo "¿qué ha cambiado?" / "resumen del negocio".
// ─────────────────────────────────────────────────────────────────────────────
/** Aplana el embed de plan para poder aplicar el predicado canónico de venta. */
function conMetodo<T extends { status: string }>(v: T) {
  return { ...v, payment_plan_method: metodoDePlan(v as { payment_plans?: unknown }) }
}

export async function getBusinessOverview({ tenantId, sb, env }: ToolContext, period: Period) {
  const cuentasAds = cuentasAdsDeContexto(env)
  const [{ data: campaigns }, { data: sales }, { count: contactCount }] = await Promise.all([
    sb.from('campaigns').select('*').eq('tenant_id', tenantId).limit(500),
    sb
      .from('sales')
      // Las mismas columnas que mira la pantalla: sin ellas la IA contaría como venta una reserva
      // que el Dashboard no cuenta, y las dos cifras serían "ventas del periodo" (D8, F03).
      .select('id,sale_date,gross_amount,status,reservation_completed_at,payment_plans(method)')
      .eq('tenant_id', tenantId)
      .gte('sale_date', period.from || '1970-01-01')
      .lte('sale_date', period.to || '2999-12-31')
      .limit(2000),
    sb.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
  ])

  // Solo campañas de las cuentas elegidas en Integraciones: el gasto de cuentas históricas
  // deseleccionadas no es del negocio (mismo convenio que la pantalla de Campañas).
  const periodCampaigns = campanasDeCuentas((campaigns as Campaign[]) || [], cuentasAds).filter(
    (c) => !period.from || !c.start_date || inPeriod(c.start_date, period) || !c.end_date
  )
  const funnel = computeAdFunnel(periodCampaigns)
  const activeSales = (sales || []).filter((s) => cuentaComoVenta(conMetodo(s)))
  const revenue = activeSales.reduce((sum, s) => sum + (s.gross_amount || 0), 0)

  const aviso = await emptySourceWarning({ tenantId, sb }, [
    { label: 'ventas', table: 'sales' },
    { label: 'campañas / ads', table: 'campaigns' },
  ])

  return {
    period,
    inversion: funnel.inversion,
    leads: funnel.leads,
    agendas: funnel.agendas,
    cpl: funnel.cpl,
    roas: funnel.roas,
    ventas: activeSales.length,
    ingresos: revenue,
    total_contactos: contactCount ?? null,
    campanas_activas: periodCampaigns.filter((c) => c.status === 'activa').length,
    ...(aviso ? { aviso_datos: aviso } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getFunnel — embudo de ads completo (mismas fórmulas que la pantalla de Campañas:
// lib/ads/funnel.ts), para no calcular métricas "a mano" en el LLM.
// ─────────────────────────────────────────────────────────────────────────────
export async function getFunnel(
  { tenantId, sb, env }: ToolContext,
  period: Period
): Promise<AdFunnel & { aviso_datos?: string }> {
  const { data } = await sb.from('campaigns').select('*').eq('tenant_id', tenantId).limit(500)
  // Solo cuentas seleccionadas en Integraciones (mismo convenio que la pantalla de Campañas).
  const campaigns = campanasDeCuentas((data as Campaign[]) || [], cuentasAdsDeContexto(env)).filter(
    (c) => !period.from || !c.start_date || inPeriod(c.start_date, period)
  )
  const funnel = computeAdFunnel(campaigns)
  // El funnel entero se alimenta de campaigns: si esa tabla está vacía, TODO lo de abajo es 0/null
  // por falta de datos, no porque el funnel vaya mal.
  const aviso = await emptySourceWarning({ tenantId, sb }, [{ label: 'campañas / ads', table: 'campaigns' }])
  return aviso ? { ...funnel, aviso_datos: aviso } : funnel
}

// ─────────────────────────────────────────────────────────────────────────────
// getCampaignPerformance — rendimiento por campaña (opcionalmente filtrado por nombre), con las
// métricas derivadas ya calculadas — el modelo puede comparar sin inventar fórmulas.
// ─────────────────────────────────────────────────────────────────────────────
export async function getCampaignPerformance(
  { tenantId, sb, env }: ToolContext,
  opts: { period?: Period; nameContains?: string }
) {
  const { data } = await sb.from('campaigns').select('*').eq('tenant_id', tenantId).limit(500)
  // Solo cuentas seleccionadas en Integraciones: el rendimiento por campaña no debe listar
  // campañas de cuentas que el usuario ya quitó del negocio.
  let campaigns = campanasDeCuentas((data as Campaign[]) || [], cuentasAdsDeContexto(env))
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
    .select('id,full_name,email,phone,lead_status,lead_channel,created_at,first_seen_at')
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
// canónica que docs/METRICS.md: cuentaComoVenta, que además excluye las reservas abiertas).
// ─────────────────────────────────────────────────────────────────────────────
export async function getSales({ tenantId, sb }: ToolContext, period: Period, limit = 20) {
  const { data } = await sb
    .from('sales')
    .select(
      'id,contact_id,sale_date,gross_amount,status,contacts(full_name),reservation_completed_at,payment_plans(method)'
    )
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
    reservation_completed_at?: string | null
    payment_plans?: unknown
  }>
  const active = rows.filter((r) => cuentaComoVenta(conMetodo(r)))
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

// ─────────────────────────────────────────────────────────────────────────────
// getMetricDefinition — capa semántica de negocio: definición/fórmula/fuente canónica de una
// métrica, para que el agente cite siempre la misma definición que docs/METRICS.md en vez de
// reformularla cada vez con sus propias palabras.
// ─────────────────────────────────────────────────────────────────────────────
export function getMetricDefinition(name: string) {
  const def = lookupMetricDefinition(name)
  return def || { error: `No hay una definición canónica registrada para "${name}".` }
}

// ─────────────────────────────────────────────────────────────────────────────
// comparePeriods — compara el resumen del negocio entre dos periodos y devuelve el delta de cada
// métrica ya calculado (nunca "las ventas bajaron" sin decir cuánto ni respecto a qué).
// ─────────────────────────────────────────────────────────────────────────────
export async function comparePeriods(ctx: ToolContext, current: Period, previous: Period) {
  const [now, prev] = await Promise.all([getBusinessOverview(ctx, current), getBusinessOverview(ctx, previous)])
  const pctChange = (a: number | null, b: number | null): number | null =>
    a === null || b === null || b === 0 ? null : ((a - b) / b) * 100
  return {
    current: now,
    previous: prev,
    delta: {
      inversion_pct: pctChange(now.inversion, prev.inversion),
      leads_pct: pctChange(now.leads, prev.leads),
      agendas_pct: pctChange(now.agendas, prev.agendas),
      cpl_pct: pctChange(now.cpl, prev.cpl),
      roas_pct: pctChange(now.roas, prev.roas),
      ventas_pct: pctChange(now.ventas, prev.ventas),
      ingresos_pct: pctChange(now.ingresos, prev.ingresos),
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// analyzeFunnelChange — Root Cause Analysis determinista: descompone el funnel completo entre
// dos periodos y señala en qué ETAPA está el mayor movimiento relativo, para que el agente no
// diga "las ventas bajaron" sino "el show rate cayó del 67% al 49%, el resto se mantuvo estable".
// ─────────────────────────────────────────────────────────────────────────────
export async function analyzeFunnelChange(ctx: ToolContext, current: Period, previous: Period) {
  const [now, prev] = await Promise.all([getFunnel(ctx, current), getFunnel(ctx, previous)])
  const stages: Array<{ stage: string; now: number | null; previous: number | null }> = [
    { stage: 'CPM', now: now.cpm, previous: prev.cpm },
    { stage: 'CTR', now: now.ctr, previous: prev.ctr },
    { stage: '% de carga (visitas/clics)', now: now.pctCarga, previous: prev.pctCarga },
    { stage: '% de registro (leads/visitas)', now: now.pctRegistro, previous: prev.pctRegistro },
    { stage: '% conversión VSL (agendas/leads)', now: now.pctConversionVSL, previous: prev.pctConversionVSL },
    { stage: '% show up (llamadas/agendas)', now: now.pctShowUp, previous: prev.pctShowUp },
    { stage: '% de cierre (cierres/llamadas)', now: now.pctCierre, previous: prev.pctCierre },
    { stage: 'ROAS', now: now.roas, previous: prev.roas },
  ]
  const withDelta = stages
    .map((s) => ({
      ...s,
      pct_change:
        s.now === null || s.previous === null || s.previous === 0 ? null : ((s.now - s.previous) / s.previous) * 100,
    }))
    .filter((s) => s.pct_change !== null)
    .sort((a, b) => (Math.abs(a.pct_change ?? 0) < Math.abs(b.pct_change ?? 0) ? 1 : -1))

  return {
    current: now,
    previous: prev,
    stages_ordenadas_por_mayor_cambio: withDelta,
    etapa_mas_afectada: withDelta[0] ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getTopObjections — Voice of Customer agregado: cuenta objeciones reales extraídas por
// analyzeCall() (lib/ai/claude.ts) y ya guardadas en appointments.ai_analysis.objections — no
// vuelve a leer transcripciones completas ni gasta una llamada nueva al LLM por consulta.
// ─────────────────────────────────────────────────────────────────────────────
export async function getTopObjections({ tenantId, sb }: ToolContext, period: Period, limit = 10) {
  const { data } = await sb
    .from('appointments')
    .select('ai_analysis, appointment_datetime')
    .eq('tenant_id', tenantId)
    .not('ai_analysis', 'is', null)
    .gte('appointment_datetime', period.from || '1970-01-01')
    .lte('appointment_datetime', period.to || '2999-12-31')
    .limit(2000)

  const rows = (data || []) as Array<{ ai_analysis: { objections?: string[] } | null }>
  const counts = new Map<string, number>()
  let analyzedCalls = 0
  for (const r of rows) {
    const objections = r.ai_analysis?.objections
    if (!objections || objections.length === 0) continue
    analyzedCalls++
    for (const o of objections) counts.set(o, (counts.get(o) || 0) + 1)
  }
  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.min(Math.max(limit, 1), 25))
    .map(([objection, count]) => ({
      objection,
      count,
      pct_of_calls: analyzedCalls > 0 ? (count / analyzedCalls) * 100 : 0,
    }))

  return { period, llamadas_analizadas: analyzedCalls, llamadas_totales_en_periodo: rows.length, top_objeciones: top }
}

// ─────────────────────────────────────────────────────────────────────────────
// compareClosers — Sales Intelligence agregado: compara closers por volumen de llamadas, score
// medio de ejecución (analyzeCall) y cierres reales — para encontrar patrones de éxito, no para
// "rankear" personas sin contexto (se muestra el dato crudo, la interpretación la hace el agente).
// ─────────────────────────────────────────────────────────────────────────────
export async function compareClosers({ tenantId, sb }: ToolContext, period: Period) {
  const [{ data: appointments }, { data: sales }, { data: users }] = await Promise.all([
    sb
      .from('appointments')
      .select('closer_id, ai_call_score, status, appointment_datetime')
      .eq('tenant_id', tenantId)
      .not('closer_id', 'is', null)
      .gte('appointment_datetime', period.from || '1970-01-01')
      .lte('appointment_datetime', period.to || '2999-12-31')
      .limit(3000),
    sb
      .from('sales')
      .select('closer_id, gross_amount, status, sale_date, reservation_completed_at, payment_plans(method)')
      .eq('tenant_id', tenantId)
      .not('closer_id', 'is', null)
      .gte('sale_date', period.from || '1970-01-01')
      .lte('sale_date', period.to || '2999-12-31')
      .limit(3000),
    sb.from('users').select('id,full_name'),
  ])

  const nameById = new Map((users || []).map((u) => [u.id as string, u.full_name as string]))
  const byCloser = new Map<
    string,
    { llamadas: number; scoreSum: number; scoreCount: number; ventas: number; ingresos: number }
  >()
  const ensure = (id: string) => {
    if (!byCloser.has(id)) byCloser.set(id, { llamadas: 0, scoreSum: 0, scoreCount: 0, ventas: 0, ingresos: 0 })
    return byCloser.get(id)!
  }
  for (const a of (appointments || []) as Array<{ closer_id: string; ai_call_score: number | null; status: string }>) {
    const e = ensure(a.closer_id)
    e.llamadas++
    if (a.ai_call_score !== null) {
      e.scoreSum += a.ai_call_score
      e.scoreCount++
    }
  }
  for (const s of (sales || []) as Array<{
    closer_id: string
    gross_amount: number
    status: string
    reservation_completed_at?: string | null
    payment_plans?: unknown
  }>) {
    if (!cuentaComoVenta(conMetodo(s))) continue
    const e = ensure(s.closer_id)
    e.ventas++
    e.ingresos += s.gross_amount || 0
  }

  return {
    period,
    closers: Array.from(byCloser.entries()).map(([id, v]) => ({
      closer: nameById.get(id) || id,
      llamadas: v.llamadas,
      score_medio_llamada: v.scoreCount > 0 ? v.scoreSum / v.scoreCount : null,
      ventas: v.ventas,
      ingresos: v.ingresos,
      close_rate: v.llamadas > 0 ? (v.ventas / v.llamadas) * 100 : null,
    })),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Business Memory — hechos/hipótesis/decisiones/resultados EXPLÍCITOS (nunca lo que el LLM
// "cree" por su cuenta). recordBusinessFact solo debe llamarse cuando el usuario confirma
// explícitamente el hecho en su mensaje (regla del system prompt del agente, no aquí).
// ─────────────────────────────────────────────────────────────────────────────
export async function getBusinessMemory({ tenantId, sb }: ToolContext, type?: string, limit = 20) {
  let q = sb
    .from('ai_business_facts')
    .select('id,type,content,evidence,outcome_of,created_at')
    .eq('tenant_id', tenantId)
  if (type) q = q.eq('type', type)
  const { data } = await q.order('created_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 50))
  return data || []
}

// ─────────────────────────────────────────────────────────────────────────────
// getRecentInsights — insights generados por el detector determinista (ver
// lib/ai/insights/detectors.ts + cron/ai-insights). Solo lectura; el agente los cita, no los
// genera él mismo en cada conversación.
// ─────────────────────────────────────────────────────────────────────────────
export async function getRecentInsights({ tenantId, sb }: ToolContext, limit = 10) {
  const { data } = await sb
    .from('ai_insights')
    .select('id,type,severity,title,summary,evidence,status,generated_at')
    .eq('tenant_id', tenantId)
    .neq('status', 'stale')
    .order('generated_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 30))
  return data || []
}

export async function recordBusinessFact(
  { tenantId, sb, userId }: ToolContext,
  input: { type: 'business' | 'hypothesis' | 'decision' | 'outcome'; content: string; outcomeOf?: string }
) {
  if (!userId) return { error: 'No se pudo identificar al usuario para registrar el hecho.' }
  const { data, error } = await sb
    .from('ai_business_facts')
    .insert({
      tenant_id: tenantId,
      type: input.type,
      content: input.content,
      outcome_of: input.outcomeOf || null,
      created_by: userId,
    })
    .select('id,type,content,created_at')
    .single()
  if (error) return { error: error.message }
  return data
}
