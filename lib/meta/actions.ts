// Normalizador central de `actions[]` de la Insights API de Meta.
//
// REGLA DE ORO (§6-7 de la spec del dashboard Meta): 0 ≠ NULL.
//   · 0    → Meta CONFIRMA cero acciones de ese tipo.
//   · null → Meta NO devolvió la métrica (la cuenta/campaña no la mide o no aplica).
// Nunca convertir null → 0: un CPL "€0" de una campaña que no mide leads mentiría sobre el coste
// real de captación. La UI pinta null como "—" con tooltip, y 0 como 0.
//
// Los action_types de Meta varían por tipo de campaña, objetivo y píxel (onsite_conversion.*,
// offsite_conversion.fb_pixel_*, leadgen_grouped…). Este módulo centraliza su traducción a
// métricas internas de forma aditiva: añadir un alias es una línea, no un if más en la UI.

// ── Alias conocidos por métrica (action_type → métrica interna) ──────────────
export const ACTION_ALIASES = {
  landing_page_view: ['landing_page_view', 'offsite_conversion.fb_pixel_landing_page_view'],
  lead: ['lead', 'leadgen_grouped', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'],
  complete_registration: [
    'complete_registration',
    'onsite_conversion.complete_registration',
    'offsite_conversion.fb_pixel_complete_registration',
  ],
  schedule: ['schedule', 'onsite_conversion.schedule', 'offsite_conversion.fb_pixel_schedule'],
  purchase: ['purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase'],
  initiate_checkout: ['initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout'],
  view_content: ['view_content', 'offsite_conversion.fb_pixel_view_content', 'onsite_conversion.view_content'],
  messaging_conversation_started: [
    'messaging_conversation_started_7d',
    'messaging_conversation',
    'onsite_conversion.messaging_conversation_started_7d',
  ],
  link_click: ['link_click', 'inline_link_click'],
  post_engagement: ['post_engagement', 'post', 'page_engagement'],
  post_reaction: ['post_reaction', 'like'],
  comment: ['comment'],
  post_save: ['post_save', 'save'],
  video_view: ['video_view', 'video_play'],
  profile_visit: ['profile_visit', 'onsite_conversion.profile_visit'],
  follow: ['follow', 'onsite_conversion.follow', 'ig_follow', 'onsite_conversion.ig_follow'],
  contact: ['contact', 'onsite_conversion.contact'],
} as const

export type MetaActionKey = keyof typeof ACTION_ALIASES

// Índice action_type de Meta → métrica interna (construido una vez).
const BY_ALIAS: Map<string, MetaActionKey> = (() => {
  const m = new Map<string, MetaActionKey>()
  for (const [key, aliases] of Object.entries(ACTION_ALIASES)) {
    for (const a of aliases as readonly string[]) m.set(a, key as MetaActionKey)
  }
  return m
})()

type AccionMeta = { action_type?: unknown; value?: unknown }

/**
 * Convierte `actions[]` (o `action_values[]`) de un insight de Meta en un mapa métrica → valor.
 * Solo entran las métricas que Meta DEVOLVIÓ: si un action_type no aparece, la métrica queda
 * fuera del mapa (null para el consumidor) — nunca 0 por defecto.
 */
export function normalizeMetaActions(raw: unknown): Partial<Record<MetaActionKey, number>> {
  const out: Partial<Record<MetaActionKey, number>> = {}
  if (!Array.isArray(raw)) return out
  for (const a of raw as AccionMeta[]) {
    const key = BY_ALIAS.get(String(a?.action_type ?? ''))
    if (!key) continue
    const v = Number(a?.value)
    if (!Number.isFinite(v)) continue
    out[key] = (out[key] ?? 0) + v
  }
  return out
}

/** Igual que normalizeMetaActions pero para `action_values[]` (valores en € de conversiones). */
export function normalizeMetaActionValues(raw: unknown): Partial<Record<MetaActionKey, number>> {
  // Misma forma de datos; el consumidor distingue counts de values por la columna destino.
  return normalizeMetaActions(raw)
}

// ── Serie temporal (una fila por día y campaña) ──────────────────────────────

/** Suma dos mapas de acciones respetando ausencia: si ambos son null → null. */
function mergeNullable(
  a: Partial<Record<MetaActionKey, number>> | null,
  b: Partial<Record<MetaActionKey, number>> | null
): Partial<Record<MetaActionKey, number>> | null {
  if (!a && !b) return null
  const out: Partial<Record<MetaActionKey, number>> = {}
  for (const src of [a, b]) {
    if (!src) continue
    for (const [k, v] of Object.entries(src)) {
      out[k as MetaActionKey] = (out[k as MetaActionKey] ?? 0) + (v ?? 0)
    }
  }
  return out
}

/** Agrega N filas diarias (mapas por día) en UN total del rango, respetando null≠0. */
export function aggregateActions(
  rows: Array<{ metaActions: Partial<Record<MetaActionKey, number>> | null }>
): Partial<Record<MetaActionKey, number>> | null {
  return rows.reduce<Partial<Record<MetaActionKey, number>> | null>((acc, r) => mergeNullable(acc, r.metaActions), null)
}

// ── Métricas calculadas EXCLUSIVAMENTE con datos Meta (§8) ───────────────────

/** Número o null; el consumidor pinta null como "—". */
export type Metrica = number | null

/** divide salvaguardando la semántica null: divisor 0 o faltante → null (nunca 0). */
export const divMeta = (a: Metrica, b: Metrica): Metrica => (a == null || b == null || b === 0 ? null : a / b)

export type BaseMeta = {
  spend: Metrica
  impressions: Metrica
  reach: Metrica
  linkClicks: Metrica
  actions: Partial<Record<MetaActionKey, number>> | null
  actionValues: Partial<Record<MetaActionKey, number>> | null
}

export type MetaCalc = {
  cpm: Metrica
  cpc: Metrica
  ctr: Metrica // link clicks / impressions
  lpv: Metrica
  costPerLpv: Metrica
  lpvRate: Metrica
  leads: Metrica
  cpl: Metrica
  leadRate: Metrica
  registrations: Metrica
  costPerRegistration: Metrica
  registrationRate: Metrica
  schedules: Metrica
  costPerSchedule: Metrica
  purchases: Metrica
  costPerPurchase: Metrica
  purchaseValue: Metrica
  roas: Metrica
  conversations: Metrica
  costPerConversation: Metrica
  engagements: Metrica
  costPerEngagement: Metrica
  comments: Metrica
  followers: Metrica
  profileVisits: Metrica
  viewContent: Metrica
}

/** Lee una acción del mapa normalizado. Array PRESENTE = Meta midió: clave ausente → 0 real.
 *  Mapa NULL (Meta no devolvió actions[]) → null. Esa es la línea que separa 0 de "no disponible". */
const act = (a: BaseMeta, k: MetaActionKey): Metrica => (a.actions ? (a.actions[k] ?? 0) : null)

/** Calcula TODAS las métricas derivadas desde la base Meta; cada una es null si su input falta. */
export function calcMeta(base: BaseMeta): MetaCalc {
  const lpv = act(base, 'landing_page_view')
  const leads = act(base, 'lead')
  const regs = act(base, 'complete_registration')
  const schedules = act(base, 'schedule')
  const purchases = act(base, 'purchase')
  const conversations = act(base, 'messaging_conversation_started')
  const engagements = act(base, 'post_engagement')
  const comments = act(base, 'comment')
  const followers = act(base, 'follow')
  const profileVisits = act(base, 'profile_visit')
  const viewContent = act(base, 'view_content')

  return {
    cpm: base.impressions == null || base.spend == null ? null : (base.spend / base.impressions) * 1000,
    cpc: divMeta(base.spend, base.linkClicks),
    ctr:
      base.linkClicks != null && base.impressions != null && base.impressions > 0
        ? (base.linkClicks / base.impressions) * 100
        : null,
    lpv,
    costPerLpv: divMeta(base.spend, lpv),
    lpvRate: lpv != null && base.linkClicks != null && base.linkClicks > 0 ? (lpv / base.linkClicks) * 100 : null,
    leads,
    cpl: divMeta(base.spend, leads),
    leadRate: lpv != null && leads != null && lpv > 0 ? (leads / lpv) * 100 : null,
    registrations: regs,
    costPerRegistration: divMeta(base.spend, regs),
    registrationRate: lpv != null && regs != null && lpv > 0 ? (regs / lpv) * 100 : null,
    schedules,
    costPerSchedule: divMeta(base.spend, schedules),
    purchases,
    costPerPurchase: divMeta(base.spend, purchases),
    purchaseValue: base.actionValues?.purchase ?? null,
    roas: divMeta(base.actionValues?.purchase ?? null, base.spend),
    conversations,
    costPerConversation: divMeta(base.spend, conversations),
    engagements,
    costPerEngagement: divMeta(base.spend, engagements),
    comments,
    followers,
    profileVisits,
    viewContent,
  }
}
