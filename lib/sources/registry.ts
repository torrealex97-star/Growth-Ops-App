// ─────────────────────────────────────────────────────────────────────────────
// REGISTRO DE SOURCE OF TRUTH (§1/§18 de la spec del dashboard global)
// ─────────────────────────────────────────────────────────────────────────────
// Cada métrica del dashboard declara:
//   · primary_source     → la fuente con autoridad.
//   · fallback_sources   → el orden de respaldo cuando la primaria no tiene dato.
//   · deduplication_key  → la(s) clave(s) que identifican EL MISMO evento entre fuentes.
//   · confidence         → HIGH/MEDIUM/LOW según cómo se resolvió el dato.
//   · manual_override    → si un humano puede corregirla (con auditoría, §5/§36).
//
// REGLA DE ORO (§1/§19): NUNCA se suman dos fuentes que pueden representar el mismo evento.
// Si la primaria no tiene dato, se usa el fallback EN ORDEN; si dos fuentes discrepan, gana la
// de mayor prioridad y el conflicto queda REGISTRADO (nunca resuelto en silencio).

export type DataSource =
  | 'stripe'
  | 'bank'
  | 'internal_payments'
  | 'manual'
  | 'internal_sales'
  | 'crm'
  | 'pipeline'
  | 'product_price'
  | 'calendly'
  | 'google_calendar'
  | 'native_forms'
  | 'typeform'
  | 'meta'
  | 'first_party'
  | 'ga4'
  | 'affiliate'
  | 'collaborator'

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export type SourceOfTruth = {
  metric: string
  /** Etiqueta humana de la métrica (coherente en TODO el dashboard). */
  label: string
  primary: DataSource
  fallbacks: DataSource[]
  /** Claves con las que se identifica EL MISMO evento entre fuentes distintas. */
  dedupKey: string[]
  manualOverride: boolean
  /** Definición/fórmula para el tooltip de fuente (§37). */
  what: string
  formula: string
}

// ── Definiciones por métrica (§2-§12/§18) ───────────────────────────────────
export const SOURCE_REGISTRY: Record<string, SourceOfTruth> = {
  cash_collected: {
    metric: 'cash_collected',
    label: 'Cash Collected',
    primary: 'stripe',
    fallbacks: ['bank', 'internal_payments', 'manual'],
    dedupKey: ['payment_id', 'transaction_id', 'customer_id+amount+timestamp'],
    manualOverride: true,
    what: 'Dinero efectivamente cobrado (pagos liquidados, no facturado ni pactado).',
    formula: 'SUM(successful_settled_payments) − refunds según lógica financiera. Excluye failed/pending/void.',
  },
  revenue_closed: {
    metric: 'revenue_closed',
    label: 'Revenue Closed',
    primary: 'internal_sales',
    fallbacks: ['crm', 'product_price', 'manual'],
    dedupKey: ['sale_id', 'opportunity_id', 'lead_id+closed_at+amount'],
    manualOverride: true,
    what: 'Valor total de las ventas cerradas del periodo (precio real vendido, no el de lista).',
    formula: 'SUM(actual_sale_price ?? product.base_price) sobre ventas activas.',
  },
  lead: {
    metric: 'lead',
    label: 'New Unique Leads',
    primary: 'crm',
    fallbacks: ['typeform', 'native_forms', 'calendly', 'google_calendar'],
    dedupKey: ['email', 'phone', 'external_contact_id'],
    manualOverride: false,
    what: 'Personas NUEVAS creadas por primera vez en el periodo (leads canónicos, no envíos).',
    formula: 'Recuento de contactos canónicos únicos con created_at en el periodo.',
  },
  form_submissions: {
    metric: 'form_submissions',
    label: 'Form Submissions',
    primary: 'typeform',
    fallbacks: ['native_forms'],
    dedupKey: ['form_submission_id'],
    manualOverride: false,
    what: 'Formularios enviados (puede haber varios de la misma persona).',
    formula: 'Recuento de submissions. NO equivale a leads: una persona que envía 2 veces = 1 lead, 2 submissions.',
  },
  appointment: {
    metric: 'appointment',
    label: 'Booked Appointments',
    primary: 'calendly',
    fallbacks: ['google_calendar', 'crm', 'internal_payments'],
    dedupKey: ['calendly_event_id', 'calendar_event_id', 'contact_id+scheduled_at'],
    manualOverride: false,
    what: 'Citas reservadas (canónicas: si Calendly crea la cita y Google Calendar recibe el evento, es UNA).',
    formula: 'Recuento de appointments canónicas con scheduled_at en el periodo.',
  },
  show: {
    metric: 'show',
    label: 'Shows',
    primary: 'crm',
    fallbacks: ['manual'],
    dedupKey: ['appointment_id'],
    manualOverride: true,
    what: 'Llamadas comerciales que OCURRIERON de verdad (confirmación explícita, nunca deducida del calendario).',
    formula: "appointments con status IN ('show','completed') o confirmación manual con show_at + confirmed_by.",
  },
  sale: {
    metric: 'sale',
    label: 'Sales',
    primary: 'internal_sales',
    fallbacks: ['crm', 'manual'],
    dedupKey: ['sale_id', 'opportunity_id'],
    manualOverride: true,
    what: 'Ventas cerradas (unidad de negocio, sin duplicar por aparecer en dos sistemas).',
    formula: "Ventas activas: status IN ('active','partial_refund').",
  },
  traffic_meta: {
    metric: 'traffic_meta',
    label: 'Tráfico (Meta)',
    primary: 'meta',
    fallbacks: [],
    dedupKey: ['campaign_id+date'],
    manualOverride: false,
    what: 'Spend/Impressions/Reach/CPM/CTR/CPC. SIEMPRE Meta Ads — nunca first-party ni GA4.',
    formula: 'Insights API de Meta (campaign_daily).',
  },
  onsite_behavior: {
    metric: 'onsite_behavior',
    label: 'Comportamiento onsite',
    primary: 'first_party',
    fallbacks: ['ga4'],
    dedupKey: ['session_id', 'anonymous_id'],
    manualOverride: false,
    what: 'Page views, sesiones, scroll, CTA clicks. First-party primero; GA4 como respaldo, sin mezclar sesiones.',
    formula: 'Tracking first-party (canonical_events); fallback GA4.',
  },
  collaborator: {
    metric: 'collaborator',
    label: 'Colaboradores',
    primary: 'collaborator',
    fallbacks: ['affiliate'],
    dedupKey: ['collaborator_id', 'affiliate_id'],
    manualOverride: false,
    what: 'Colaboradores como entidad real; si el mismo existe como afiliado, se RELACIONA (no se duplica).',
    formula: 'collaborator_id estructurado en contact_attributions; fallback al módulo de afiliados.',
  },
}

// ── Confianza (§20) ─────────────────────────────────────────────────────────
export type ConfidenceRule = { level: ConfidenceLevel; reason: string }

export function confidenceForMatch(kind: 'exact_id' | 'email' | 'phone' | 'external_id' | 'inferred'): ConfidenceRule {
  switch (kind) {
    case 'exact_id':
      return { level: 'high', reason: 'Coincidencia por ID exacto de la fuente.' }
    case 'email':
      return { level: 'high', reason: 'Coincidencia por email exacto.' }
    case 'phone':
      return { level: 'medium', reason: 'Coincidencia por teléfono (puede haber números compartidos).' }
    case 'external_id':
      return { level: 'medium', reason: 'Coincidencia por ID externo de la integración.' }
    case 'inferred':
      return { level: 'low', reason: 'Origen inferido (UTM sin contacto que casar) — baja confianza.' }
  }
}

// ── Resolución de conflictos (§19): nunca silenciosa ────────────────────────
export type ConflictRecord<T> = {
  selected: { source: DataSource; value: T }
  candidates: { source: DataSource; value: T }[]
  conflicted: boolean
}

/**
 * Resuelve el valor de una métrica con múltiples fuentes por ORDEN de prioridad del registro.
 * Si dos fuentes con dato discrepan, gana la primera (prioridad) y `conflicted=true` para que la
 * UI pueda mostrar ambas. NUNCA decide por criterio oculto: el orden viene del registro (§18).
 */
export function resolveByPriority<T>(
  def: SourceOfTruth,
  values: Partial<Record<DataSource, T | null | undefined>>
): ConflictRecord<T | null> {
  const order = [def.primary, ...def.fallbacks]
  const candidates = order
    .map((source) => ({ source, value: values[source] }))
    .filter((c): c is { source: DataSource; value: T } => c.value != null && c.value !== undefined)

  if (candidates.length === 0) return { selected: { source: order[0], value: null }, candidates: [], conflicted: false }

  const selected = candidates[0]
  const conflicted = candidates.some((c) => c.source !== selected.source && c.value !== selected.value)
  return { selected, candidates, conflicted }
}
