// Lectura de los recuentos de cada etapa desde las tablas reales.
//
// Principio que gobierna este archivo: **solo se calcula lo que se puede demostrar con el esquema
// que existe.** Donde no hay fuente conectada o falta un mapeo, se devuelve `no_configurada` con el
// motivo, no un 0 y tampoco un error rojo. Inventar un vocabulario de eventos o rellenar huecos con
// ceros es precisamente lo que haría que esta pantalla mintiera.
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { ACTIVE_SALE_STATUSES } from '@/lib/analytics'
import { type FunnelFamily, stagesOf } from '@/lib/funnels/definitions'
import { type EventMap, namesFor } from '@/lib/funnels/event-map'
import { fromCount, noConfigurada, type MetricValue } from '@/lib/funnels/types'

export type DateRange = { from: string; to: string } // ISO, inclusivo por fecha

type CountResult = { rows: number | null; error?: string }

/**
 * Cuenta filas de una tabla en un rango, devolviendo `rows: null` si la lectura falla.
 * `head: true` + `count: 'exact'` no trae filas: solo el número, así que no choca con el límite de
 * filas de PostgREST (que ya causó un truncado silencioso en Finanzas).
 *
 * `filter` se aplica sobre la consulta ya construida, así el tipado del cliente se conserva y no
 * hace falta castear nada.
 */
async function countRows(
  sb: SupabaseClient,
  table: string,
  tenantId: string,
  dateColumn: string,
  range: DateRange,
  filter?: { column: string; eq?: string; in?: string[] }
): Promise<CountResult> {
  const base = sb
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte(dateColumn, range.from)
    .lte(dateColumn, range.to)
    // Sin esto, las filas con fecha nula quedarían fuera del rango sin que nadie lo sepa.
    .not(dateColumn, 'is', null)
  const q = filter?.eq ? base.eq(filter.column, filter.eq) : filter?.in ? base.in(filter.column, filter.in) : base
  const { count, error } = await q
  if (error) return { rows: null, error: error.message }
  return { rows: count ?? 0 }
}

// ── Etapas del CRM: son las únicas deterministas hoy ────────────────────────
// (contacts, appointments y sales existen, tienen tenant_id y fechas fiables)

async function crmStages(sb: SupabaseClient, tenantId: string, range: DateRange) {
  const [leads, agendas, llamadas, cierres] = await Promise.all([
    countRows(sb, 'contacts', tenantId, 'first_seen_at', range),
    countRows(sb, 'appointments', tenantId, 'appointment_datetime', range),
    // "Llamada realizada" es status 'show'. Mismo criterio que Analítica de ventas: no se cuenta
    // 'completed' ni 'confirmed', que no significan que la llamada ocurriera.
    countRows(sb, 'appointments', tenantId, 'appointment_datetime', range, { column: 'status', eq: 'show' }),
    // Ventas activas según el criterio canónico de lib/analytics (no se cuenta un reembolso
    // como cierre), para que Funnels no discrepe del resto de la app.
    countRows(sb, 'sales', tenantId, 'sale_date', range, { column: 'status', in: ACTIVE_SALE_STATUSES }),
  ])
  return {
    leads: fromCount(leads.rows, 'crm', { error: leads.error }),
    agendas: fromCount(agendas.rows, 'crm', { error: agendas.error }),
    llamadas: fromCount(llamadas.rows, 'crm', { error: llamadas.error }),
    cierres: fromCount(cierres.rows, 'crm', { error: cierres.error }),
  }
}

// ── Etapas de Meta: campaign_daily es la fuente por día ya sincronizada ─────

async function metaStages(sb: SupabaseClient, tenantId: string, range: DateRange) {
  // Paginado: `campaign_daily` tiene una fila por campaña y día, así que unos meses de histórico
  // pasan de las 1.000 filas que devuelve PostgREST como máximo. Sin paginar, el gasto y las
  // impresiones del embudo salían recortados sin ningún aviso — más bajos que los reales.
  const { rows: data, error } = await fetchAllRows<{
    impressions: number | null
    link_clicks: number | null
    reach: number | null
    spend: number | null
  }>(() =>
    sb
      .from('campaign_daily')
      .select('impressions,link_clicks,reach,spend,date')
      .eq('tenant_id', tenantId)
      .gte('date', range.from)
      .lte('date', range.to)
      .not('date', 'is', null)
  )
  if (error) {
    const fail = { rows: null as number | null, error }
    return {
      impresiones: fromCount(fail.rows, 'meta', { error: fail.error }),
      clics: fromCount(fail.rows, 'meta', { error: fail.error }),
      alcance: fromCount(fail.rows, 'meta', { error: fail.error }),
      inversion: null as number | null,
    }
  }
  const rows = data
  const sum = (k: 'impressions' | 'link_clicks' | 'reach' | 'spend') =>
    rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)
  return {
    impresiones: fromCount(sum('impressions'), 'meta'),
    clics: fromCount(sum('link_clicks'), 'meta'),
    alcance: fromCount(sum('reach'), 'meta'),
    // La inversión se devuelve aparte: no es una etapa, es el denominador de los costes.
    inversion: rows.length > 0 ? sum('spend') : null,
  }
}

// ── Etapas de GA4: sesiones desde ga4_daily ─────────────────────────────────
// Se lee la tabla local, NO la API de Google: la pantalla de Funnels no debe depender de una
// llamada externa que puede tardar o fallar. El sync llena la tabla; aquí solo se suma.

async function ga4Stages(sb: SupabaseClient, tenantId: string, range: DateRange) {
  // ¿Hay conexión con propiedad elegida? Si no la hay, la etapa no está "vacía": está sin
  // configurar, y decir 0 sesiones sería afirmar que nadie visitó la web.
  const { data: conn, error: connError } = await sb
    .from('google_oauth_connections')
    .select('ga4_property_id,status,last_sync_at')
    .eq('tenant_id', tenantId)
    .eq('provider', 'ga4')
    .maybeSingle()
  if (connError) return { sesiones: fromCount(null, 'ga4', { error: connError.message }) }
  const c = conn as { ga4_property_id: string | null; status: string; last_sync_at: string | null } | null
  if (!c) {
    return { sesiones: noConfigurada('ga4', 'GA4 no está conectado en esta subcuenta.') }
  }
  if (!c.ga4_property_id) {
    return { sesiones: noConfigurada('ga4', 'GA4 está conectado pero no se ha elegido ninguna propiedad.') }
  }
  if (c.status === 'revocada') {
    return { sesiones: fromCount(null, 'ga4', { error: 'Google revocó el acceso: hay que volver a conectar.' }) }
  }
  if (!c.last_sync_at) {
    return { sesiones: noConfigurada('ga4', 'GA4 conectado, pero todavía no se ha sincronizado ningún dato.') }
  }

  // `date` es DATE, así que el rango se compara por día. El `to` del rango puede venir con hora
  // (para las tablas con timestamptz), de ahí el recorte a 10 caracteres.
  const { data, error } = await sb
    .from('ga4_daily')
    .select('sessions')
    .eq('tenant_id', tenantId)
    .gte('date', range.from.slice(0, 10))
    .lte('date', range.to.slice(0, 10))
  if (error) return { sesiones: fromCount(null, 'ga4', { error: error.message }) }
  const total = (data ?? []).reduce((a, r) => a + (Number((r as { sessions: number }).sessions) || 0), 0)
  return { sesiones: fromCount(total, 'ga4', { lastSync: c.last_sync_at }) }
}

// ── Etapas de tracking propio (landing/VSL): solo con el mapeo de la subcuenta ─
//
// `canonical_events.event_name` es texto libre. Sin un mapeo explícito de qué nombre de evento
// corresponde a cada etapa, esto NO cuenta nada: ni 0 ni una suposición. Con mapeo, cuenta las filas
// cuyo event_name está en la lista que eligió el usuario.
async function vslStage(sb: SupabaseClient, tenantId: string, range: DateRange, names: string[]): Promise<MetricValue> {
  const { rows, error } = await countRows(sb, 'canonical_events', tenantId, 'occurred_at', range, {
    column: 'event_name',
    in: names,
  })
  return fromCount(rows, 'vsl', { error })
}

// ── Fuentes que todavía no pueden alimentar una etapa, y por qué ────────────
// Se nombran con precisión para que la UI diga qué hay que configurar. Un texto genérico obligaría
// al usuario a adivinar si es un fallo suyo, nuestro o de la integración.
const NOT_READY: Record<string, string> = {
  vsl: 'Los eventos de landing/VSL se guardan con nombre libre en canonical_events y esta subcuenta no tiene mapeado qué nombre corresponde a esta etapa.',
  clarity:
    'Clarity solo expone los últimos 1-3 días con 10 peticiones diarias, así que no puede alimentar una etapa del funnel.',
}

/**
 * Recuentos de todas las etapas de una familia. Las etapas cuya fuente no está lista salen como
 * `no_configurada`, nunca como 0.
 */
export async function loadFunnelCounts(
  sb: SupabaseClient,
  tenantId: string,
  family: FunnelFamily,
  range: DateRange,
  // Mapeo de etapa → nombres de evento de esta subcuenta. Vacío por defecto: sin mapeo, las etapas
  // de tracking siguen saliendo como 'no_configurada', que es la verdad.
  eventMap: EventMap = {}
): Promise<{ counts: Record<string, MetricValue>; inversion: number | null }> {
  const stages = stagesOf(family)
  const needsCrm = stages.some((s) => s.source === 'crm')
  const needsMeta = stages.some((s) => s.source === 'meta')
  const needsGa4 = stages.some((s) => s.source === 'ga4')

  const [crm, meta, ga4] = await Promise.all([
    needsCrm ? crmStages(sb, tenantId, range) : Promise.resolve(null),
    needsMeta ? metaStages(sb, tenantId, range) : Promise.resolve(null),
    needsGa4 ? ga4Stages(sb, tenantId, range) : Promise.resolve(null),
  ])

  const counts: Record<string, MetricValue> = {}
  for (const stage of stages) {
    if (stage.source === 'crm' && crm) {
      // Las etapas de "entrada" del CRM comparten el mismo recuento de contactos nuevos: registros
      // de webinar, opt-ins de VSL y conversaciones por DM son, hoy, el mismo dato sin segmentar.
      // Se marca como no configurada cuando la etapa exige una distinción que aún no existe.
      if (stage.id === 'leads') counts[stage.id] = crm.leads
      else if (stage.id === 'agendas') counts[stage.id] = crm.agendas
      else if (stage.id === 'llamadas') counts[stage.id] = crm.llamadas
      else if (stage.id === 'cierres') counts[stage.id] = crm.cierres
      else
        counts[stage.id] = noConfigurada(
          'crm',
          `La etapa "${stage.label}" necesita distinguir este subconjunto de contactos y todavía no hay ese criterio en base.`
        )
      continue
    }
    if (stage.source === 'ga4' && ga4) {
      counts[stage.id] =
        stage.id === 'sesiones' ? ga4.sesiones : noConfigurada('ga4', `GA4 no aporta "${stage.label}".`)
      continue
    }
    if (stage.source === 'meta' && meta) {
      if (stage.id === 'impresiones') counts[stage.id] = meta.impresiones
      else if (stage.id === 'clics') counts[stage.id] = meta.clics
      else if (stage.id === 'alcance') counts[stage.id] = meta.alcance
      else
        counts[stage.id] = noConfigurada(
          'meta',
          `Meta no expone "${stage.label}" en las columnas que se sincronizan hoy.`
        )
      continue
    }
    if (stage.source === 'vsl') {
      const names = namesFor(eventMap, family, stage.id)
      counts[stage.id] =
        names.length > 0 ? await vslStage(sb, tenantId, range, names) : noConfigurada('vsl', NOT_READY.vsl)
      continue
    }
    counts[stage.id] = noConfigurada(stage.source, NOT_READY[stage.source] ?? 'Fuente sin configurar.')
  }

  return { counts, inversion: meta?.inversion ?? null }
}
