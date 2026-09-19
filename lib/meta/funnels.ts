// Configuración declarativa de los funnels del dashboard Meta Ads.
// Cada funnel define: su resultado principal (§27), sus KPI cards en orden de prioridad (§9/§33),
// las etapas del funnel visual (§12/§14/§21), las columnas de las tablas de campañas (§28) y
// diaria (§31) y las métricas de tendencia (§30).
//
// REGLA (§45): toda métrica viene de Meta o se calcula SOLO con datos Meta. Una etapa cuyo valor
// es null (Meta no lo devolvió) desaparece del funnel; una card cuyo input falta no se muestra
// (gate de tracking: aparece sola en cuanto Meta devuelve el dato).

import type { MetaCalc, MetaActionKey, Metrica } from '@/lib/meta/actions'

export type FunnelType = 'todo' | 'dm' | 'vsl' | 'webinar' | 'custom'
export type AsignacionFunnel = Exclude<FunnelType, 'todo'> // lo que se guarda en la asignación

export type SelectableFunnel = 'todo' | 'dm' | 'vsl' | 'webinar'

// ── Definición de una métrica mostrable ──────────────────────────────────────
export type MetricDef = {
  key: string
  label: string
  fmt: 'eur' | 'num' | 'pct' | 'x' | 'int'
  /** Fórmula/explicación para el tooltip (§40). */
  tooltip: string
  /** true → calculada con datos Meta; false → métrica directa de la API. */
  calculated?: boolean
  /** Lee el valor de la fila calculada; null = Meta no lo da para esta selección. */
  get: (m: MetaCalc) => Metrica
}

// ── Etapa del funnel visual (§12): cantidad + % respecto a la anterior + coste ──
export type StageDef = {
  key: MetaActionKey | 'impressions' | 'linkClicks'
  label: string
  fmt: 'num' | 'eur'
  tooltip: string
}

export type FunnelConfig = {
  type: FunnelType
  label: string
  /** Métrica del resultado principal (§27) y su etiqueta universal. */
  primary: MetricDef
  kpis: MetricDef[] // en orden de prioridad; las que salen a null se ocultan
  stages: StageDef[]
  campaignColumns: MetricDef[]
  dailyColumns: MetricDef[]
  trends: MetricDef[] // selector del gráfico temporal (§30)
}

// ── Métricas reutilizables ───────────────────────────────────────────────────
const spend: MetricDef = {
  key: 'spend',
  label: 'Spend',
  fmt: 'eur',
  tooltip: 'Inversión total del periodo. Métrica directa de la Insights API de Meta (spend).',
  get: () => null, // se resuelve aparte (viene de la base, no de MetaCalc)
}

const impressions: MetricDef = {
  key: 'impressions',
  label: 'Impressions',
  fmt: 'int',
  tooltip: 'Nº de veces que se mostraron los anuncios. Directo de Meta (impressions).',
  get: () => null,
}

const cpm: MetricDef = {
  key: 'cpm',
  label: 'CPM',
  fmt: 'eur',
  calculated: true,
  tooltip: 'Coste por mil impresiones. Fórmula: Spend / Impressions × 1000. Ambos valores de Meta.',
  get: (m) => m.cpm,
}

const clicks: MetricDef = {
  key: 'linkClicks',
  label: 'Inline link clicks',
  fmt: 'int',
  tooltip: 'Clics en el enlace del anuncio. Directo de Meta (inline_link_clicks).',
  // Se resuelve por la base (resolveMetric), no por MetaCalc.
  get: () => null,
}

const ctr: MetricDef = {
  key: 'ctr',
  label: 'CTR',
  fmt: 'pct',
  calculated: true,
  tooltip:
    'Porcentaje de impresiones que acaban en clic en el enlace. Fórmula: Link Clicks / Impressions × 100. Datos de Meta.',
  get: (m) => m.ctr,
}

const cpc: MetricDef = {
  key: 'cpc',
  label: 'CPC',
  fmt: 'eur',
  calculated: true,
  tooltip: 'Coste por clic en el enlace. Fórmula: Spend / Link Clicks. Datos de Meta.',
  get: (m) => m.cpc,
}

const lpv: MetricDef = {
  key: 'lpv',
  label: 'Landing page views',
  fmt: 'int',
  tooltip: 'Visitas reales a la página de destino atribuidas por el píxel de Meta (landing_page_view).',
  get: (m) => m.lpv,
}

const costLpv: MetricDef = {
  key: 'costPerLpv',
  label: 'Cost / LPV',
  fmt: 'eur',
  calculated: true,
  tooltip: 'Coste por visita a la página. Fórmula: Spend / Landing Page Views. Datos de Meta.',
  get: (m) => m.costPerLpv,
}

const lpvRate: MetricDef = {
  key: 'lpvRate',
  label: 'LPV rate',
  fmt: 'pct',
  calculated: true,
  tooltip: 'Porcentaje de clics que cargan realmente la página. Fórmula: LP Views / Link Clicks × 100. Datos de Meta.',
  get: (m) => m.lpvRate,
}

const leads: MetricDef = {
  key: 'leads',
  label: 'Leads',
  fmt: 'int',
  tooltip: 'Leads atribuidos por Meta (lead, leadgen, píxel). Directo de actions[] de Meta.',
  get: (m) => m.leads,
}

const cpl: MetricDef = {
  key: 'cpl',
  label: 'CPL',
  fmt: 'eur',
  calculated: true,
  tooltip: 'Coste por lead. Fórmula: Spend / Leads. Datos de Meta.',
  get: (m) => m.cpl,
}

const leadRate: MetricDef = {
  key: 'leadRate',
  label: 'Lead rate',
  fmt: 'pct',
  calculated: true,
  tooltip: 'Porcentaje de visitas que se convierten en lead. Fórmula: Leads / LP Views × 100. Datos de Meta.',
  get: (m) => m.leadRate,
}

const schedules: MetricDef = {
  key: 'schedules',
  label: 'Schedules',
  fmt: 'int',
  tooltip: 'Citas reservadas atribuidas por Meta (action_type schedule). Solo aparece si Meta lo devuelve.',
  get: (m) => m.schedules,
}

const costSchedule: MetricDef = {
  key: 'costPerSchedule',
  label: 'Cost / Schedule',
  fmt: 'eur',
  calculated: true,
  tooltip: 'Coste por cita reservada. Fórmula: Spend / Schedules. Datos de Meta.',
  get: (m) => m.costPerSchedule,
}

const purchases: MetricDef = {
  key: 'purchases',
  label: 'Purchases (Meta)',
  fmt: 'int',
  tooltip:
    'Compras atribuidas por Meta (evento Purchase). Meta-attributed: puede no coincidir con el revenue contable.',
  get: (m) => m.purchases,
}

const costPurchase: MetricDef = {
  key: 'costPerPurchase',
  label: 'Cost / Purchase',
  fmt: 'eur',
  calculated: true,
  tooltip: 'Coste por compra atribuida. Fórmula: Spend / Purchases. Datos de Meta.',
  get: (m) => m.costPerPurchase,
}

const purchaseValue: MetricDef = {
  key: 'purchaseValue',
  label: 'Purchase conversion value',
  fmt: 'eur',
  tooltip: 'Valor de las compras atribuidas (action_values de Meta). Meta-attributed, no revenue contable.',
  get: (m) => m.purchaseValue,
}

const roas: MetricDef = {
  key: 'roas',
  label: 'ROAS',
  fmt: 'x',
  calculated: true,
  tooltip:
    'Retorno sobre la inversión publicitaria. Fórmula: Purchase Value / Spend. SOLO si Meta atribuye valor de compra.',
  get: (m) => m.roas,
}

const registrations: MetricDef = {
  key: 'registrations',
  label: 'Registrations',
  fmt: 'int',
  tooltip: 'Registros completados atribuidos por Meta (complete_registration).',
  get: (m) => m.registrations,
}

const costReg: MetricDef = {
  key: 'costPerRegistration',
  label: 'Cost / Registration',
  fmt: 'eur',
  calculated: true,
  tooltip: 'Coste por registro. Fórmula: Spend / Complete Registrations. Datos de Meta.',
  get: (m) => m.costPerRegistration,
}

const regRate: MetricDef = {
  key: 'registrationRate',
  label: 'Registration rate',
  fmt: 'pct',
  calculated: true,
  tooltip: 'Porcentaje de visitas que terminan en registro. Fórmula: Registrations / LP Views × 100. Datos de Meta.',
  get: (m) => m.registrationRate,
}

const conversations: MetricDef = {
  key: 'conversations',
  label: 'Messaging conversations started',
  fmt: 'int',
  tooltip: 'Conversaciones de messaging iniciadas, atribuidas por Meta (messaging_conversation_started_7d).',
  get: (m) => m.conversations,
}

const costConversation: MetricDef = {
  key: 'costPerConversation',
  label: 'Cost / Conversation',
  fmt: 'eur',
  calculated: true,
  tooltip: 'Coste por conversación iniciada. Fórmula: Spend / Messaging Conversations. Datos de Meta.',
  get: (m) => m.costPerConversation,
}

const engagements: MetricDef = {
  key: 'engagements',
  label: 'Post engagements',
  fmt: 'int',
  tooltip: 'Interacciones con las publicaciones (post_engagement de Meta: reacciones, comentarios, clics…).',
  get: (m) => m.engagements,
}

const costEngagement: MetricDef = {
  key: 'costPerEngagement',
  label: 'Cost / Engagement',
  fmt: 'eur',
  calculated: true,
  tooltip: 'Coste por interacción. Fórmula: Spend / Post Engagements. Datos de Meta.',
  get: (m) => m.costPerEngagement,
}

const comments: MetricDef = {
  key: 'comments',
  label: 'Comments',
  fmt: 'int',
  tooltip: 'Comentarios en las publicaciones atribuidos por Meta (action_type comment).',
  get: (m) => m.comments,
}

const viewContent: MetricDef = {
  key: 'viewContent',
  label: 'ViewContent',
  fmt: 'int',
  tooltip:
    'Evento ViewContent recibido y atribuido por Meta. NO equivale a "VSL vista" salvo mapeo explícito del usuario (§13).',
  get: (m) => m.viewContent,
}

const reach: MetricDef = {
  key: 'reach',
  label: 'Reach',
  fmt: 'int',
  tooltip: 'Personas únicas alcanzadas. Directo de Meta (reach).',
  get: () => null,
}

// Métricas cuya fuente es la base (no MetaCalc) se resuelven en el componente con la fila base.
/** Resuelve una MetricDef sobre (MetaCalc + base). Las defs con get()=null usan la base. */
export function resolveMetric(
  def: MetricDef,
  calc: MetaCalc,
  base: { spend?: Metrica; impressions?: Metrica; reach?: Metrica; linkClicks?: Metrica }
): Metrica {
  switch (def.key) {
    case 'spend':
      return base.spend ?? null
    case 'impressions':
      return base.impressions ?? null
    case 'reach':
      return base.reach ?? null
    case 'linkClicks':
      return base.linkClicks ?? null
    default:
      return def.get(calc)
  }
}

// ── Etapas de funnel visual ──────────────────────────────────────────────────
const stageImpressions: StageDef = {
  key: 'impressions',
  label: 'Impressions',
  fmt: 'num',
  tooltip: 'Impresiones (Meta).',
}
const stageClicks: StageDef = {
  key: 'linkClicks',
  label: 'Inline link clicks',
  fmt: 'num',
  tooltip: 'Clics en el enlace (Meta).',
}
const stageLpv: StageDef = {
  key: 'landing_page_view',
  label: 'Landing page views',
  fmt: 'num',
  tooltip: 'Visitas a la página (Meta: landing_page_view).',
} as StageDef
const stageLeads: StageDef = { key: 'lead', label: 'Leads', fmt: 'num', tooltip: 'Leads atribuidos por Meta.' }
const stageSchedule: StageDef = {
  key: 'schedule',
  label: 'Schedule',
  fmt: 'num',
  tooltip: 'Citas reservadas atribuidas por Meta.',
}
const stagePurchase: StageDef = {
  key: 'purchase',
  label: 'Purchases',
  fmt: 'num',
  tooltip: 'Compras atribuidas por Meta.',
}
const stageEngagement: StageDef = {
  key: 'post_engagement',
  label: 'Engagement',
  fmt: 'num',
  tooltip: 'Interacciones atribuidas por Meta.',
}
const stageConv: StageDef = {
  key: 'messaging_conversation_started',
  label: 'Conversaciones',
  fmt: 'num',
  tooltip: 'Conversaciones de messaging iniciadas (Meta).',
}
const stageReg: StageDef = {
  key: 'complete_registration',
  label: 'Registrations',
  fmt: 'num',
  tooltip: 'Registros completados (Meta: complete_registration).',
}

// ── Configuraciones por funnel ───────────────────────────────────────────────
export const VSL_FUNNEL: FunnelConfig = {
  type: 'vsl',
  label: 'VSL',
  primary: cpl,
  kpis: [spend, lpv, costLpv, leads, cpl, schedules, costSchedule, purchases, costPurchase, roas],
  stages: [stageImpressions, stageClicks, stageLpv, stageLeads, stageSchedule, stagePurchase],
  campaignColumns: [
    spend,
    impressions,
    cpm,
    clicks,
    ctr,
    cpc,
    lpv,
    costLpv,
    viewContent,
    leads,
    cpl,
    schedules,
    costSchedule,
    purchases,
    costPurchase,
    purchaseValue,
    roas,
  ],
  dailyColumns: [
    spend,
    cpm,
    impressions,
    reach,
    clicks,
    ctr,
    cpc,
    lpv,
    costLpv,
    leads,
    cpl,
    schedules,
    costSchedule,
    purchases,
    costPurchase,
    roas,
  ],
  trends: [spend, lpv, costLpv, leads, cpl, schedules, costSchedule, purchases, costPurchase, roas],
}

export const DM_FUNNEL: FunnelConfig = {
  type: 'dm',
  label: 'DM Funnel',
  primary: costConversation,
  kpis: [spend, conversations, costConversation, engagements, costEngagement, clicks, cpc],
  stages: [stageImpressions, stageEngagement, stageClicks, stageConv, stagePurchase],
  campaignColumns: [
    spend,
    impressions,
    reach,
    cpm,
    clicks,
    ctr,
    cpc,
    engagements,
    costEngagement,
    comments,
    conversations,
    costConversation,
    leads,
    purchases,
    roas,
  ],
  dailyColumns: [
    spend,
    cpm,
    impressions,
    reach,
    clicks,
    ctr,
    cpc,
    engagements,
    costEngagement,
    conversations,
    costConversation,
  ],
  trends: [spend, conversations, costConversation, engagements, costEngagement, clicks, cpc],
}

export const WEBINAR_FUNNEL: FunnelConfig = {
  type: 'webinar',
  label: 'Webinar',
  primary: costReg,
  kpis: [spend, registrations, costReg, regRate, purchases, costPurchase, roas],
  stages: [stageImpressions, stageClicks, stageLpv, stageReg, stagePurchase],
  campaignColumns: [
    spend,
    impressions,
    cpm,
    clicks,
    ctr,
    cpc,
    lpv,
    registrations,
    regRate,
    costReg,
    purchases,
    costPurchase,
    purchaseValue,
    roas,
  ],
  dailyColumns: [
    spend,
    cpm,
    impressions,
    clicks,
    ctr,
    cpc,
    lpv,
    registrations,
    regRate,
    costReg,
    purchases,
    costPurchase,
    roas,
  ],
  trends: [spend, registrations, costReg, purchases, costPurchase, roas],
}

export const FUNNELS: Record<'vsl' | 'dm' | 'webinar', FunnelConfig> = {
  vsl: VSL_FUNNEL,
  dm: DM_FUNNEL,
  webinar: WEBINAR_FUNNEL,
}

export const FUNNEL_OPTIONS: { value: SelectableFunnel; label: string }[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'vsl', label: 'VSL' },
  { value: 'dm', label: 'DM Funnel' },
  { value: 'webinar', label: 'Webinar' },
]

// Sugerencia de clasificación por nombre (§2): SOLO sugerencia, el usuario corrige.
export function suggestFunnelByName(name: string): AsignacionFunnel | null {
  const n = name.toLowerCase()
  if (/\b(dm|dm funnel|messaging|whatsapp|messenger|chat)\b/.test(n)) return 'dm'
  if (/\b(vsl)\b/.test(n)) return 'vsl'
  if (/\b(webinar|reg (abierta|cerrada)|registro)\b/.test(n)) return 'webinar'
  return null
}

// ── Filtro TODO (§26): métricas universales + performance por funnel ─────────
export const TODO_UNIVERSAL: MetricDef[] = [
  spend,
  impressions,
  reach,
  cpm,
  clicks,
  ctr,
  cpc,
  purchases,
  costPurchase,
  purchaseValue,
  roas,
]

export type FunnelRowByFunnel = {
  funnel: string
  spend: number | null
  primary: number | null
  primaryLabel: string
  costPrimary: number | null
  purchases: number | null
  costPurchase: number | null
  roas: number | null
}
