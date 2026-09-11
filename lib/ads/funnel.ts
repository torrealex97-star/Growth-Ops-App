// Cálculo del funnel de ads a partir de las campañas ya sincronizadas.
// Todas las métricas derivadas (CPM, CPC, CTR, %Carga, CPL, %Registro,
// %Conversión VSL, %Show Up, %Cierre, CPA) se calculan aquí, no en la BBDD.
import type { Campaign } from '@/lib/types/database'

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null)
const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null)

// Totales brutos sumados sobre un conjunto de campañas.
export type AdTotals = {
  inversion: number
  alcance: number
  impresiones: number
  linkClicks: number
  visitas: number
  leads: number
  agendas: number
  llamadas: number
  cierres: number
  facturacion: number
  seguidores: number
}

// Métricas del funnel (brutas + derivadas). Las derivadas pueden ser null si el
// denominador es 0 (se muestran como "—").
export type AdFunnel = AdTotals & {
  cpm: number | null // coste por mil impresiones
  cpc: number | null // coste por clic en el enlace
  ctr: number | null // % clics enlace / impresiones
  costeVisita: number | null
  pctCarga: number | null // visitas / clics enlace
  cpl: number | null // coste por lead
  pctRegistro: number | null // leads / visitas
  costeAgenda: number | null
  pctConversionVSL: number | null // agendas / leads
  pctShowUp: number | null // llamadas / agendas
  costeCierre: number | null
  pctCierre: number | null // cierres / llamadas
  cpa: number | null // coste por adquisición (inversión / cierres)
  roas: number | null // facturación / inversión
  costeSeguidor: number | null // inversión / seguidores conseguidos
}

export function sumTotals(campaigns: Campaign[]): AdTotals {
  const t: AdTotals = {
    inversion: 0,
    alcance: 0,
    impresiones: 0,
    linkClicks: 0,
    visitas: 0,
    leads: 0,
    agendas: 0,
    llamadas: 0,
    cierres: 0,
    facturacion: 0,
    seguidores: 0,
  }
  for (const c of campaigns) {
    t.inversion += c.adspend || 0
    t.alcance += c.reach || 0
    t.impresiones += c.impressions || 0
    t.linkClicks += c.link_clicks || 0
    t.visitas += c.landing_views || 0
    t.leads += c.meta_leads || 0
    t.agendas += c.appointments_count || 0
    t.llamadas += c.shows_count || 0
    t.cierres += c.sales_count || 0
    t.facturacion += c.sales_revenue || 0
    t.seguidores += c.followers || 0
  }
  return t
}

export function funnelFromTotals(t: AdTotals): AdFunnel {
  return {
    ...t,
    cpm: t.impresiones > 0 ? (t.inversion / t.impresiones) * 1000 : null,
    cpc: div(t.inversion, t.linkClicks),
    ctr: pct(t.linkClicks, t.impresiones),
    costeVisita: div(t.inversion, t.visitas),
    pctCarga: pct(t.visitas, t.linkClicks),
    cpl: div(t.inversion, t.leads),
    pctRegistro: pct(t.leads, t.visitas),
    costeAgenda: div(t.inversion, t.agendas),
    pctConversionVSL: pct(t.agendas, t.leads),
    pctShowUp: pct(t.llamadas, t.agendas),
    costeCierre: div(t.inversion, t.cierres),
    pctCierre: pct(t.cierres, t.llamadas),
    cpa: div(t.inversion, t.cierres),
    roas: div(t.facturacion, t.inversion),
    costeSeguidor: div(t.inversion, t.seguidores),
  }
}

export function computeAdFunnel(campaigns: Campaign[]): AdFunnel {
  return funnelFromTotals(sumTotals(campaigns))
}

// Métricas por campaña individual (para los gráficos comparativos).
export type CampaignFunnelPoint = {
  id: string
  name: string
  leads: number
  cpl: number | null
  agendas: number
  costeAgenda: number | null
  pctRegistro: number | null
  pctConversionVSL: number | null
}

export function perCampaign(campaigns: Campaign[]): CampaignFunnelPoint[] {
  return campaigns.map((c) => {
    const f = computeAdFunnel([c])
    return {
      id: c.id,
      name: c.name,
      leads: f.leads,
      cpl: f.cpl,
      agendas: f.agendas,
      costeAgenda: f.costeAgenda,
      pctRegistro: f.pctRegistro,
      pctConversionVSL: f.pctConversionVSL,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// RESUMEN DIARIO DE MÉTRICAS (una fila por FECHA) — pedido por el equipo de ads.
// Las métricas brutas por día vienen de campaign_daily (gasto/impresiones/clics/
// visitas/registros) y de las agendas de tráfico pago (cruce por UTM). Las derivadas
// (CPM, CTR, CPC, %carga, coste/visita, coste/registro, tasa de registro, coste/agenda,
// %conversión VSL) se calculan aquí con las mismas fórmulas que el funnel agregado.
// ─────────────────────────────────────────────────────────────────────────────
export type DailyFunnelInput = {
  date: string // YYYY-MM-DD
  inversion: number
  impresiones: number
  alcance: number
  clicsSalientes: number // clics en el enlace (inline_link_clicks)
  visitas: number // visitas a la página de destino (landing_page_view)
  registros: number // registros completados (leads Meta)
  agendas: number // agendas de tráfico pago
}

export type DailyFunnelRow = DailyFunnelInput & {
  cpm: number | null
  ctr: number | null // clics salientes / impresiones
  cpc: number | null // inversión / clics salientes
  costeVisita: number | null
  pctCarga: number | null // visitas / clics salientes
  costeRegistro: number | null // inversión / registros
  tasaRegistro: number | null // registros / visitas
  costeAgenda: number | null // inversión / agendas
  tasaConversionVSL: number | null // agendas / registros
}

export function deriveDailyRow(i: DailyFunnelInput): DailyFunnelRow {
  return {
    ...i,
    cpm: i.impresiones > 0 ? (i.inversion / i.impresiones) * 1000 : null,
    ctr: pct(i.clicsSalientes, i.impresiones),
    cpc: div(i.inversion, i.clicsSalientes),
    costeVisita: div(i.inversion, i.visitas),
    pctCarga: pct(i.visitas, i.clicsSalientes),
    costeRegistro: div(i.inversion, i.registros),
    tasaRegistro: pct(i.registros, i.visitas),
    costeAgenda: div(i.inversion, i.agendas),
    tasaConversionVSL: pct(i.agendas, i.registros),
  }
}

// Totales de un conjunto de filas diarias (para la fila de "Total" de la tabla).
export function sumDailyRows(rows: DailyFunnelInput[]): DailyFunnelRow {
  const t = rows.reduce<DailyFunnelInput>(
    (a, r) => ({
      date: 'Total',
      inversion: a.inversion + r.inversion,
      impresiones: a.impresiones + r.impresiones,
      alcance: a.alcance + r.alcance,
      clicsSalientes: a.clicsSalientes + r.clicsSalientes,
      visitas: a.visitas + r.visitas,
      registros: a.registros + r.registros,
      agendas: a.agendas + r.agendas,
    }),
    { date: 'Total', inversion: 0, impresiones: 0, alcance: 0, clicsSalientes: 0, visitas: 0, registros: 0, agendas: 0 }
  )
  return deriveDailyRow(t)
}

// Fuentes UTM que consideramos "tráfico pago" (Meta) al contar agendas por día.
export const PAID_UTM_SOURCES = new Set([
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

export function isPaidSource(...values: Array<string | null | undefined>): boolean {
  return values.some((v) => v != null && PAID_UTM_SOURCES.has(String(v).trim().toLowerCase()))
}

// Etiqueta de origen para agrupar ventas/agendas por canal (mismo criterio que la columna
// "Origen" de app/${tenant}/crm/agendas/page.tsx): leads del bot de Setting IA por DM, tráfico
// de pago (Meta), o el utm_source/campaña tal cual venga (orgánico/referido/directo).
export function originLabel(utmSource: string | null | undefined, utmTerm: string | null | undefined): string {
  const src = (utmSource || '').trim()
  const isIA = ['instagram-setting', 'facebook-setting'].includes(src) && (utmTerm || '').toUpperCase().includes('IA')
  if (isIA) return src === 'instagram-setting' ? 'IA Setting (Instagram)' : 'IA Setting (Facebook)'
  if (isPaidSource(src)) return 'Meta Ads (pago)'
  return src || 'Directo/Sin UTM'
}
