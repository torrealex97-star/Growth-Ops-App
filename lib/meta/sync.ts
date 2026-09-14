import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/paginate'
import {
  resolveMetaConfigs,
  fetchMetaCampaigns,
  fetchMetaInsights,
  fetchMetaAds,
  fetchMetaAdInsights,
  fetchMetaDailyInsights,
  type MetaCampaign,
  type MetaConfig,
  type MetaInsight,
  type MetaAdInsight,
  type MetaEnv,
} from './client'

// Fuentes UTM que consideramos "Meta" al cruzar los LEADS FUNNEL de la BBDD.
const META_SOURCES = new Set([
  'facebook',
  'fb',
  'meta',
  'meta_ads',
  'facebook_ads',
  'ig',
  'instagram',
  'instagram_ads',
  'an',
  'audience_network',
  'messenger',
])

const norm = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase()

function mapStatus(c: MetaCampaign): 'activa' | 'pausada' | 'finalizada' {
  const s = (c.effective_status || c.status || '').toUpperCase()
  if (s === 'ACTIVE') return 'activa'
  if (s.includes('PAUSED')) return 'pausada'
  return 'finalizada'
}

const toDate = (iso?: string): string | null => (iso ? iso.slice(0, 10) : null)

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export type MetaSyncResult = {
  ok: true
  synced: number
  totalSpend: number
  totalMetaLeads: number
  totalFunnelLeads: number
  totalFollowers: number // seguidores atribuidos por Meta (suma de campañas)
  monthSpend: number
  accountId: string // lista de cuentas sincronizadas, separadas por comas
  accounts: number // nº de cuentas publicitarias procesadas
  at: string
  /**
   * Escrituras que fallaron. Antes se hacía `if (error) continue` y la sync devolvía `ok: true` con
   * 0 campañas: un fallo total era indistinguible de una cuenta sin campañas, y `campaign_daily` y
   * `campaign_ads` quedaban vacías de rebote porque dependen del mapa de campañas. Los fallos
   * parciales viajan aquí y se guardan en el historial de ejecuciones.
   */
  failures: string[]
}

// Acumuladores compartidos entre cuentas durante una ejecución de sync.
type SyncTotals = {
  synced: number
  totalSpend: number
  totalMetaLeads: number
  totalFunnelLeads: number
  totalFollowers: number
  monthSpend: number
}

// Estados de agenda que cuentan como "Llamada" (show up efectivo).
const SHOW_STATUSES = new Set(['show', 'completed'])
// Estados de venta que cuentan como "Cierre" (mismo criterio que attribution_funnel).
const SALE_CLOSED_STATUSES = new Set(['active', 'partial_refund'])

type ApptRow = { contact_id: unknown; status: unknown }
type SaleRow = { contact_id: unknown; status: unknown; gross_amount: unknown }
type CrmIndex = {
  appointmentsByContact: Map<string, ApptRow[]>
  salesByContact: Map<string, SaleRow[]>
}

// Agrupa filas por una clave (índice contact_id → filas).
function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const arr = map.get(k)
    if (arr) arr.push(r)
    else map.set(k, [r])
  }
  return map
}

// Orquestador de la sincronización con Meta. Lo usan tanto el botón manual
// (/api/${tenant}/evergreen/meta/sync) como el cron de 30 min (/api/${tenant}/evergreen/cron/meta).
// Recorre TODAS las cuentas publicitarias declaradas (una o varias, mismo token)
// y agrega los totales. Requiere un cliente Supabase con service-role (salta RLS).
export async function runMetaSync(sb: SupabaseClient, tenantId: string, env: MetaEnv): Promise<MetaSyncResult> {
  const configs = await resolveMetaConfigs(env)

  // Cargar atribuciones para el cruce de LEADS FUNNEL (una sola consulta, común a
  // todas las cuentas), acotadas al tenant.
  //
  // PAGINADO: estas tres tablas se leen COMPLETAS para cruzarlas por contacto, y PostgREST devuelve
  // como máximo 1.000 filas sin avisar de que ha recortado. Pasado ese punto, los leads/agendas/
  // cierres atribuidos a cada campaña salían más bajos que los reales y parecían un dato bueno.
  const { rows: attribs } = await fetchAllRows<Record<string, unknown>>(() =>
    sb
      .from('contact_attributions')
      .select(
        'contact_id, utm_source, utm_campaign, first_utm_source, first_utm_campaign, last_utm_source, last_utm_campaign'
      )
      .eq('tenant_id', tenantId)
  )

  // CRM: agendas y ventas por contacto, para el funnel (Agendas → Llamadas →
  // Cierres). Se atribuyen a la campaña por el mismo contacto que ya casó por UTM.
  const { rows: apptRows } = await fetchAllRows<ApptRow>(() =>
    sb.from('appointments').select('contact_id, status').eq('tenant_id', tenantId)
  )
  const { rows: saleRows } = await fetchAllRows<SaleRow>(() =>
    sb.from('sales').select('contact_id, status, gross_amount').eq('tenant_id', tenantId)
  )

  const crm: CrmIndex = {
    appointmentsByContact: groupBy(apptRows, (r) => String(r.contact_id)),
    salesByContact: groupBy(
      saleRows.filter((s) => SALE_CLOSED_STATUSES.has(String(s.status))),
      (r) => String(r.contact_id)
    ),
  }

  // Mapa de campañas Meta ya existentes (external_id → id) para upsert manual
  // (no dependemos de ON CONFLICT: el índice único podría no existir). Los ids de
  // campaña de Meta son globalmente únicos, pero acotamos por tenant para no mezclar
  // campañas de otra subcuenta en el mapa (y no actualizar por error una fila ajena).
  const { data: existingRows } = await sb
    .from('campaigns')
    .select('id, external_id')
    .eq('provider', 'meta')
    .eq('tenant_id', tenantId)
  const existingByExt = new Map<string, string>(
    (existingRows || []).filter((r) => r.external_id).map((r) => [r.external_id as string, r.id as string])
  )

  const at = new Date().toISOString()
  const period = currentPeriod()

  const failures: string[] = []
  const totals: SyncTotals = {
    synced: 0,
    totalSpend: 0,
    totalMetaLeads: 0,
    totalFunnelLeads: 0,
    totalFollowers: 0,
    monthSpend: 0,
  }

  for (const cfg of configs) {
    await syncOneAccount(sb, tenantId, cfg, attribs, crm, existingByExt, at, period, totals, failures)
  }

  return {
    ok: true,
    synced: totals.synced,
    totalSpend: totals.totalSpend,
    totalMetaLeads: totals.totalMetaLeads,
    totalFunnelLeads: totals.totalFunnelLeads,
    totalFollowers: totals.totalFollowers,
    monthSpend: totals.monthSpend,
    accountId: configs.map((c) => c.accountId).join(', '),
    accounts: configs.length,
    at,
    failures,
  }
}

// Sincroniza UNA cuenta publicitaria, acumulando sus resultados en `totals`.
async function syncOneAccount(
  sb: SupabaseClient,
  tenantId: string,
  cfg: MetaConfig,
  attribs: Array<Record<string, unknown>>,
  crm: CrmIndex,
  existingByExt: Map<string, string>,
  at: string,
  period: string,
  totals: SyncTotals,
  failures: string[]
): Promise<void> {
  // 1) Traer campañas + insights (histórico para totales, este mes para el gasto de P&L)
  const [campaigns, lifetime, thisMonth] = await Promise.all([
    fetchMetaCampaigns(cfg),
    fetchMetaInsights(cfg, 'maximum'),
    fetchMetaInsights(cfg, 'this_month'),
  ])

  const lifetimeById = new Map<string, MetaInsight>(lifetime.map((i) => [i.campaign_id, i]))
  const monthById = new Map<string, MetaInsight>(thisMonth.map((i) => [i.campaign_id, i]))

  for (const c of campaigns) {
    const life = lifetimeById.get(c.id)
    const mon = monthById.get(c.id)

    const adspend = life?.spend ?? 0
    const impressions = life?.impressions ?? 0
    const clicks = life?.clicks ?? 0
    const reach = life?.reach ?? 0
    const metaLeads = life?.leads ?? 0
    const metaFollowers = life?.followers ?? 0
    const budget = Number(c.lifetime_budget || 0) / 100 || Number(c.daily_budget || 0) / 100 || 0

    // LEADS FUNNEL: contactos con una atribución Meta cuyo utm_campaign casa con
    // el id o el nombre de esta campaña (comparamos con lo que reporta Meta).
    const nameKey = norm(c.name)
    const funnelContacts = new Set<string>()
    for (const a of attribs || []) {
      const srcOk =
        META_SOURCES.has(norm(a.utm_source)) ||
        META_SOURCES.has(norm(a.first_utm_source)) ||
        META_SOURCES.has(norm(a.last_utm_source))
      if (!srcOk) continue
      const camps = [a.utm_campaign, a.first_utm_campaign, a.last_utm_campaign].map(norm)
      const match = camps.some((v) => v && (v === c.id || v === nameKey))
      if (match && a.contact_id) funnelContacts.add(String(a.contact_id))
    }
    const funnelLeads = funnelContacts.size

    // FUNNEL CRM: agendas, llamadas (show up) y cierres de los contactos atribuidos
    // a esta campaña (mismo cruce por UTM que los funnel leads).
    let appointmentsCount = 0
    let showsCount = 0
    let salesCount = 0
    let salesRevenue = 0
    for (const contactId of Array.from(funnelContacts)) {
      const appts = crm.appointmentsByContact.get(contactId)
      if (appts) {
        appointmentsCount += appts.length
        for (const ap of appts) if (SHOW_STATUSES.has(String(ap.status))) showsCount++
      }
      const sales = crm.salesByContact.get(contactId)
      if (sales) {
        salesCount += sales.length
        for (const s of sales) salesRevenue += Number(s.gross_amount) || 0
      }
    }

    // 3) Upsert manual por (provider, external_id): update si existe, insert si no.
    const row = {
      tenant_id: tenantId,
      provider: 'meta',
      external_id: c.id,
      account_id: cfg.accountId, // cuenta publicitaria de origen (act_XXX)
      account_name: cfg.accountName || null, // nombre legible de la cuenta
      name: c.name,
      channel: 'meta_ads',
      status: mapStatus(c),
      start_date: toDate(c.start_time),
      end_date: toDate(c.stop_time),
      budget,
      adspend,
      impressions,
      clicks,
      reach,
      link_clicks: life?.linkClicks ?? 0,
      landing_views: life?.landingViews ?? 0,
      meta_leads: metaLeads,
      funnel_leads: funnelLeads,
      followers: life?.followers ?? 0, // seguidores atribuidos (0 si no es campaña de captación)
      leads_generated: metaLeads, // compat con CPL/Unit Economics existentes
      appointments_count: appointmentsCount,
      shows_count: showsCount,
      sales_count: salesCount,
      sales_revenue: salesRevenue,
      synced_at: at,
    }

    let campaignId: string | undefined = existingByExt.get(c.id)
    if (campaignId) {
      const { error: updErr } = await sb.from('campaigns').update(row).eq('id', campaignId)
      if (updErr) {
        failures.push(`No se pudo actualizar la campaña "${c.name}": ${updErr.message}`)
        continue
      }
    } else {
      const { data: inserted, error: insErr } = await sb.from('campaigns').insert(row).select('id').single()
      if (insErr || !inserted) {
        failures.push(
          `No se pudo guardar la campaña "${c.name}": ${insErr?.message || 'la base de datos no devolvió la fila'}`
        )
        continue
      }
      campaignId = inserted.id as string
      existingByExt.set(c.id, campaignId)
    }
    if (!campaignId) continue
    const upserted = { id: campaignId }
    totals.synced++
    totals.totalSpend += adspend
    totals.totalMetaLeads += metaLeads
    totals.totalFunnelLeads += funnelLeads
    totals.totalFollowers += metaFollowers

    // 4) Gasto del MES a Finanzas/P&L (automático, idempotente por auto_source+period)
    const spendThisMonth = mon?.spend ?? 0
    totals.monthSpend += spendThisMonth
    if (spendThisMonth > 0) {
      const { error: expErr } = await sb.from('expenses').upsert(
        {
          tenant_id: tenantId,
          concept: `Ads Meta - ${c.name}`,
          category: 'publicidad',
          subcategory: 'ads',
          amount: spendThisMonth,
          expense_date: `${period}-01`,
          auto_source: `campaign:${upserted.id}`,
          period,
          status: 'pagado',
        },
        { onConflict: 'auto_source,period', ignoreDuplicates: false }
      )
      if (expErr) failures.push(`No se pudo llevar el gasto de "${c.name}" a Finanzas: ${expErr.message}`)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC DE GASTO DIARIO (nivel campaña, time_increment=1) — SEPARADO del de campañas.
// Es lo que permite filtrar el gasto por rango real (este mes / trimestre / año) en vez de
// mostrar el total histórico. Cuentas EN PARALELO (best-effort) para caber en los 60s de Vercel.
// ─────────────────────────────────────────────────────────────────────────────
export type MetaDailySyncResult = {
  ok: true
  daysSynced: number
  accounts: number
  at: string
  failures: string[]
}

export async function runMetaDailySync(
  sb: SupabaseClient,
  tenantId: string,
  env: MetaEnv,
  sinceDays = 180
): Promise<MetaDailySyncResult> {
  const configs = await resolveMetaConfigs(env)

  // Mapa campaña Meta (external_id → id) para enlazar cada fila diaria a su campaña.
  const { data: existingRows } = await sb
    .from('campaigns')
    .select('id, external_id')
    .eq('provider', 'meta')
    .eq('tenant_id', tenantId)
  const campaignByExt = new Map<string, string>(
    (existingRows || []).filter((r) => r.external_id).map((r) => [r.external_id as string, r.id as string])
  )

  const at = new Date().toISOString()
  const failures: string[] = []
  const perAccount = await Promise.all(
    configs.map((cfg) =>
      syncDailyOneAccount(sb, tenantId, cfg, campaignByExt, sinceDays, failures).catch((err) => {
        // Antes este catch devolvía 0 y se comía el motivo: una cuenta que falla entera se leía
        // como "esta cuenta no gastó nada".
        failures.push(`Cuenta ${cfg.accountId}: ${err instanceof Error ? err.message : 'error desconocido'}`)
        return 0
      })
    )
  )
  if (campaignByExt.size === 0) {
    failures.push(
      'No hay ninguna campaña de Meta guardada todavía, así que no se puede enlazar el gasto diario. Sincroniza primero las campañas.'
    )
  }
  return { ok: true, daysSynced: perAccount.reduce((a, b) => a + b, 0), accounts: configs.length, at, failures }
}

async function syncDailyOneAccount(
  sb: SupabaseClient,
  tenantId: string,
  cfg: MetaConfig,
  campaignByExt: Map<string, string>,
  sinceDays: number,
  failures: string[]
): Promise<number> {
  const daily = await fetchMetaDailyInsights(cfg, sinceDays)
  let huerfanos = 0
  const rows = daily
    .map((d) => {
      const campaignId = campaignByExt.get(d.campaign_id)
      if (!campaignId || !d.date) {
        huerfanos++
        return null
      }
      return {
        tenant_id: tenantId,
        campaign_id: campaignId,
        external_id: d.campaign_id,
        account_id: cfg.accountId,
        date: d.date,
        spend: d.spend,
        impressions: d.impressions,
        clicks: d.clicks,
        leads: d.leads,
        reach: d.reach,
        link_clicks: d.linkClicks,
        landing_views: d.landingViews,
        updated_at: new Date().toISOString(),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  let synced = 0
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK)
    const { error } = await sb
      .from('campaign_daily')
      .upsert(batch, { onConflict: 'campaign_id,date', ignoreDuplicates: false })
    if (error) failures.push(`No se pudo guardar el gasto diario de ${cfg.accountId}: ${error.message}`)
    else synced += batch.length
  }
  if (huerfanos > 0 && rows.length === 0) {
    failures.push(
      `Meta devolvió ${huerfanos} días de gasto de ${cfg.accountId} pero ninguna de esas campañas está guardada: sincroniza primero las campañas.`
    )
  }
  return synced
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC DE ANUNCIOS (nivel ad) — SEPARADO del de campañas.
// Los ad-insights con `actions` son lentos (~13s/página) y la cuenta grande tiene
// cientos de anuncios; sumar todas las cuentas en serie superaría el límite de 60s
// de Vercel Hobby. Por eso: (a) endpoint propio, (b) cuentas EN PARALELO (el tiempo
// total ≈ la cuenta más lenta, no la suma). Cada cuenta es best-effort.
// ─────────────────────────────────────────────────────────────────────────────
export type MetaAdsSyncResult = {
  ok: true
  adsSynced: number
  accounts: number
  at: string
  failures: string[]
}

export async function runMetaAdsSync(sb: SupabaseClient, tenantId: string, env: MetaEnv): Promise<MetaAdsSyncResult> {
  const configs = await resolveMetaConfigs(env)

  // Mapa campaña Meta (external_id → id) para enlazar cada anuncio a su campaña.
  const { data: existingRows } = await sb
    .from('campaigns')
    .select('id, external_id')
    .eq('provider', 'meta')
    .eq('tenant_id', tenantId)
  const campaignByExt = new Map<string, string>(
    (existingRows || []).filter((r) => r.external_id).map((r) => [r.external_id as string, r.id as string])
  )

  const at = new Date().toISOString()
  const failures: string[] = []
  const perAccount = await Promise.all(
    configs.map((cfg) =>
      syncAdsOneAccount(sb, tenantId, cfg, campaignByExt, at, failures).catch((err) => {
        failures.push(`Cuenta ${cfg.accountId}: ${err instanceof Error ? err.message : 'error desconocido'}`)
        return 0
      })
    )
  )
  return { ok: true, adsSynced: perAccount.reduce((a, b) => a + b, 0), accounts: configs.length, at, failures }
}

// Sincroniza los anuncios de UNA cuenta → tabla campaign_ads. Devuelve nº sincronizados.
async function syncAdsOneAccount(
  sb: SupabaseClient,
  tenantId: string,
  cfg: MetaConfig,
  campaignByExt: Map<string, string>,
  at: string,
  failures: string[]
): Promise<number> {
  // Insights de los últimos 90 días (rendimiento reciente = lo relevante para
  // monitorizar campañas). `maximum` traería cientos de anuncios históricos y no
  // cabría en los 60s de Vercel Hobby. Solo guardamos anuncios con actividad
  // reciente o actualmente activos, para mantener la vista enfocada.
  const [ads, adInsights] = await Promise.all([fetchMetaAds(cfg), fetchMetaAdInsights(cfg, 'last_90d')])
  const insByAd = new Map<string, MetaAdInsight>(adInsights.map((i) => [i.ad_id, i]))
  const adRows = ads
    .filter((ad) => {
      const s = (ad.effective_status || ad.status || '').toUpperCase()
      return insByAd.has(ad.id) || s === 'ACTIVE'
    })
    .map((ad) => {
      const ins = insByAd.get(ad.id)
      const s = (ad.effective_status || ad.status || '').toUpperCase()
      const status = s === 'ACTIVE' ? 'activa' : s.includes('PAUSED') ? 'pausada' : 'finalizada'
      return {
        tenant_id: tenantId,
        external_id: ad.id,
        campaign_external_id: ad.campaign_id || null,
        campaign_id: ad.campaign_id ? campaignByExt.get(ad.campaign_id) || null : null,
        account_id: cfg.accountId,
        account_name: cfg.accountName || null,
        name: ad.name,
        adset_name: ad.adset_name || null,
        status,
        spend: ins?.spend ?? 0,
        impressions: ins?.impressions ?? 0,
        clicks: ins?.clicks ?? 0,
        reach: ins?.reach ?? 0,
        link_clicks: ins?.linkClicks ?? 0,
        landing_views: ins?.landingViews ?? 0,
        leads: ins?.leads ?? 0,
        followers: ins?.followers ?? 0,
        synced_at: at,
      }
    })
  let synced = 0
  const CHUNK = 300
  for (let i = 0; i < adRows.length; i += CHUNK) {
    const batch = adRows.slice(i, i + CHUNK)
    const { error } = await sb
      .from('campaign_ads')
      .upsert(batch, { onConflict: 'tenant_id,external_id', ignoreDuplicates: false })
    if (error) failures.push(`No se pudieron guardar los anuncios de ${cfg.accountId}: ${error.message}`)
    else synced += batch.length
  }
  return synced
}
