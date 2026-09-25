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
import { errorFuente, fromCount, noConfigurada, type MetricValue } from '@/lib/funnels/types'

// Familia del motor → tipo de asignación manual (campaign_funnel_assignments.funnel_type).
// web_seo es orgánico/GA4: no filtra campañas de pago.
const FAMILIA_A_ASIGNACION: Partial<Record<FunnelFamily, 'dm' | 'vsl' | 'webinar'>> = {
  vsl: 'vsl',
  webinar: 'webinar',
  profile: 'dm',
}

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

// Ids de campaña asignados MANUALMENTE a la familia (campaign_funnel_assignments, la fuente de
// verdad que llena MetaFunnelAssigner). Sin asignaciones devolvemos null (no []) para que el
// llamador distinga "nadie ha asignado nada" de "asignaron 0 campañas": con la sugerencia por
// nombre sin guardar no se calcula nada — §2 dice que es solo sugerencia.
async function campanasAsignadas(sb: SupabaseClient, tenantId: string, family: FunnelFamily): Promise<string[] | null> {
  const tipo = FAMILIA_A_ASIGNACION[family]
  if (!tipo) return null
  try {
    const { data, error } = await sb
      .from('campaign_funnel_assignments')
      .select('campaign_id')
      .eq('tenant_id', tenantId)
      .eq('funnel_type', tipo)
    if (error) return null
    return (data ?? []).map((r: { campaign_id: string }) => r.campaign_id)
  } catch {
    return null
  }
}

async function metaStages(
  sb: SupabaseClient,
  tenantId: string,
  range: DateRange,
  campaignIds: string[] | null,
  // Cuentas de ads seleccionadas en Integraciones (vacío = todas). La tabla conserva históricos de
  // cuentas ya deseleccionadas: sin este filtro, su gasto inflaba la inversión del funnel.
  cuentasAds: string[] = []
) {
  // Paginado: `campaign_daily` tiene una fila por campaña y día, así que unos meses de histórico
  // pasan de las 1.000 filas que devuelve PostgREST como máximo. Sin paginar, el gasto y las
  // impresiones del embudo salían recortados sin ningún aviso — más bajos que los reales.
  const ids = campaignIds && campaignIds.length > 0 ? campaignIds : null
  const { rows: data, error } = await fetchAllRows<{
    impressions: number | null
    link_clicks: number | null
    reach: number | null
    spend: number | null
  }>(() => {
    let q = sb
      .from('campaign_daily')
      .select('impressions,link_clicks,reach,spend,date')
      .eq('tenant_id', tenantId)
      .gte('date', range.from)
      .lte('date', range.to)
      .not('date', 'is', null)
    // Con asignaciones manuales, las etapas Meta de la familia cuentan SOLO esas campañas.
    // Sin asignación (null) se mantiene el total del tenant: no convertir "sin clasificar" en 0.
    if (ids) q = q.in('campaign_id', ids)
    // Y SOLO campañas de las cuentas elegidas en Integraciones: el gasto de cuentas históricas
    // deseleccionadas no es del negocio que se está mirando.
    if (cuentasAds.length > 0) q = q.in('account_id', cuentasAds)
    return q
  })
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
  eventMap: EventMap = {},
  // Cuentas de ads seleccionadas en Integraciones (vacío = todas, el convenio de la app).
  cuentasAds: string[] = []
): Promise<{ counts: Record<string, MetricValue>; inversion: number | null }> {
  const stages = stagesOf(family)
  const needsCrm = stages.some((s) => s.source === 'crm')
  const needsMeta = stages.some((s) => s.source === 'meta')
  const needsGa4 = stages.some((s) => s.source === 'ga4')

  // Cada fuente se envuelve individualmente: si Meta falla, CRM y GA4 siguen disponibles.
  // Antes, un throw en cualquiera de las tres causaba Promise.all rechazado → 500 en el endpoint
  // y el funnel entero desaparecía. Con esto, cada fuente devuelve null si falla y el loop de
  // abajo la marca 'error_fuente' en sus etapas.
  const crmSafe = async () => {
    if (!needsCrm) return null
    try {
      return await crmStages(sb, tenantId, range)
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Error al leer CRM' } as const
    }
  }
  const metaSafe = async () => {
    if (!needsMeta) return null
    try {
      const ids = await campanasAsignadas(sb, tenantId, family)
      return await metaStages(sb, tenantId, range, ids, cuentasAds)
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Error al leer Meta' } as const
    }
  }
  const ga4Safe = async () => {
    if (!needsGa4) return null
    try {
      return await ga4Stages(sb, tenantId, range)
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Error al leer GA4' } as const
    }
  }
  const [crm, meta, ga4] = await Promise.all([crmSafe(), metaSafe(), ga4Safe()])

  // Helpers: los wrappers devuelven { error } cuando fallan. El loop necesita distinguir
  // entre "no se pidió" (null), "falló" ({ error }) y "funcionó" (objeto con leads/agendas/...).
  const isSourceError = (v: unknown): v is { error: string } =>
    v !== null && typeof v === 'object' && 'error' in v && typeof (v as { error: unknown }).error === 'string'

  type CrmStages = { leads: MetricValue; agendas: MetricValue; llamadas: MetricValue; cierres: MetricValue }
  type Ga4Stages = { sesiones: MetricValue }
  type MetaStages = { impresiones: MetricValue; clics: MetricValue; alcance: MetricValue; inversion: number | null }

  const counts: Record<string, MetricValue> = {}
  for (const stage of stages) {
    if (stage.source === 'crm') {
      if (isSourceError(crm)) {
        counts[stage.id] = errorFuente('crm', crm.error)
      } else if (crm) {
        const c = crm as unknown as CrmStages
        if (stage.id === 'leads') counts[stage.id] = c.leads
        else if (stage.id === 'agendas') counts[stage.id] = c.agendas
        else if (stage.id === 'llamadas') counts[stage.id] = c.llamadas
        else if (stage.id === 'cierres') counts[stage.id] = c.cierres
        else
          counts[stage.id] = noConfigurada(
            'crm',
            `La etapa "${stage.label}" necesita distinguir este subconjunto de contactos y todavía no hay ese criterio en base.`
          )
      } else {
        counts[stage.id] = noConfigurada('crm', 'CRM no solicitado para esta familia.')
      }
      continue
    }
    if (stage.source === 'ga4') {
      if (isSourceError(ga4)) {
        counts[stage.id] = errorFuente('ga4', ga4.error)
      } else if (ga4) {
        const g = ga4 as unknown as Ga4Stages
        counts[stage.id] =
          stage.id === 'sesiones' ? g.sesiones : noConfigurada('ga4', `GA4 no aporta "${stage.label}".`)
      } else {
        counts[stage.id] = noConfigurada('ga4', 'GA4 no solicitado para esta familia.')
      }
      continue
    }
    if (stage.source === 'meta') {
      if (isSourceError(meta)) {
        counts[stage.id] = errorFuente('meta', meta.error)
      } else if (meta) {
        const m = meta as unknown as MetaStages
        if (stage.id === 'impresiones') counts[stage.id] = m.impresiones
        else if (stage.id === 'clics') counts[stage.id] = m.clics
        else if (stage.id === 'alcance') counts[stage.id] = m.alcance
        else
          counts[stage.id] = noConfigurada(
            'meta',
            `Meta no expone "${stage.label}" en las columnas que se sincronizan hoy.`
          )
      } else {
        counts[stage.id] = noConfigurada('meta', 'Meta no solicitado para esta familia.')
      }
      continue
    }
    if (stage.source === 'vsl') {
      // Cada etapa VSL se envuelve en su propio try-catch: si una falla (vsl_sessions no
      // existe, service_role_key ausente), las demás etapas VSL se resuelven normalmente.
      try {
        const names = namesFor(eventMap, family, stage.id)
        if (names.length > 0) {
          counts[stage.id] = await vslStage(sb, tenantId, range, names)
          continue
        }
        const sesion = await vslSessionStage(sb, tenantId, range, stage.id)
        counts[stage.id] = sesion ?? noConfigurada('vsl', NOT_READY.vsl)
      } catch (e) {
        counts[stage.id] = errorFuente('vsl', e instanceof Error ? e.message : 'Error al leer VSL')
      }
      continue
    }
    counts[stage.id] = noConfigurada(stage.source, NOT_READY[stage.source] ?? 'Fuente sin configurar.')
  }

  // inversion solo se extrae si meta funcionó (no si devolvió { error }).
  const inversion = meta && !isSourceError(meta) ? (meta as unknown as MetaStages).inversion : null
  return { counts, inversion }
}

// ── Etapas de VSL desde vsl_sessions (tracking propio del player) ──────────
//
// Mapeo de etapas de las familias a columnas reales de vsl_sessions:
//   visitas   → sesiones creadas en el rango (una sesión = una carga del player)
//   registros → sesiones identificadas (lead_email) en el rango; para la familia webinar
//               es lo más cercano a "registro" sin inventar una tabla nueva
//
// vsl_sessions usa Postgres directo con tenant_id explícito (mismo aviso que lib/vsl/db):
// la consulta por rango usa created_at/updated_at con casting seguro. Devuelve null cuando
// la tabla no existe todavía en algún entorno (migración pendiente): la etapa queda
// 'no_configurada' con ese motivo, no un error rojo ni un 0.
async function vslSessionStage(
  sb: SupabaseClient,
  tenantId: string,
  range: DateRange,
  stageId: string
): Promise<MetricValue | null> {
  // Supabase JS no expone vsl_sessions con columnas seguras vía REST tipado si RLS lo bloquea;
  // el acceso real del módulo VSL es Postgres directo, y desde aquí lo canónico es la REST:
  // si el rol del endpoint (service role) no puede leerla, es que la tabla no está expuesta,
  // y eso se declara. countRows ya devuelve rows:null con el error — lo aprovechamos.
  if (stageId !== 'visitas' && stageId !== 'registros') return null
  const dateCol = stageId === 'visitas' ? 'created_at' : 'updated_at'
  // "Registro" = sesión que dejó correo. La condición es lead_email NOT NULL.
  const extra = stageId === 'registros' ? { column: 'lead_email' } : undefined
  const res = await countVslSessions(sb, tenantId, dateCol, range, extra)
  return res
}

async function countVslSessions(
  sb: SupabaseClient,
  tenantId: string,
  dateColumn: string,
  range: DateRange,
  extra?: { column: string }
): Promise<MetricValue> {
  try {
    // El builder de supabase-js con nombres de columna dinámicos satura la inferencia (TS2589).
    // Solo se necesita el COUNT exacto: se construye el querystring a mano contra la REST, que es
    // lo mismo que hace PostgREST por debajo, sin la magia de tipos. La validez de columnas la
    // da el servidor; los errores se traducen abajo.
    const restUrl = new URL(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/vsl_sessions`)
    restUrl.searchParams.set('select', 'id')
    restUrl.searchParams.set('tenant_id', `eq.${tenantId}`)
    restUrl.searchParams.set(dateColumn, `gte.${range.from}`)
    // Un solo gte no basta para acotar por ambos lados; PostgREST acepta dos filtros sobre la
    // misma columna ANDados si van como parámetros separados. El 'lte' añade el segundo.
    restUrl.searchParams.append(dateColumn, `lte.${range.to}`)
    // EL 400 QUE DEVOLVÍA ESTA CONSULTA (auditoría F25): el operador va en el VALOR del filtro, no
    // en el nombre de la columna. `not.lead_email=is.null` le pide a PostgREST una columna llamada
    // "not.lead_email", que no existe; la forma correcta es `lead_email=not.is.null`. La pantalla
    // enseñaba "HTTP 400" en la etapa de registros — correctamente distinto de cero, pero sin dato.
    //
    // El filtro de no-nulo sobre la columna de fecha se retira por redundante: una fila con fecha
    // nula no puede satisfacer el gte/lte de arriba.
    if (extra) restUrl.searchParams.append(extra.column, 'not.is.null')
    restUrl.searchParams.set('limit', '0')
    const res = await fetch(restUrl, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
      cache: 'no-store',
    })
    if (!res.ok) {
      const body = await res.text()
      // 404/400 con "Could not find the table" → la tabla no está expuesta: no configurada.
      if (/Could not find|does not exist|relation .* does not exist/i.test(body)) {
        return noConfigurada('vsl', 'El tracking de sesiones VSL no está disponible en esta base todavía.')
      }
      return errorFuente('vsl', `vsl_sessions: HTTP ${res.status}`)
    }
    const cr = res.headers.get('content-range') // '*/N' con limit 0
    const total = cr ? Number(cr.split('/')[1]) : null
    return fromCount(Number.isFinite(total as number) ? (total as number) : null, 'vsl')
  } catch (err) {
    return errorFuente('vsl', err instanceof Error ? err.message : 'No se pudo leer vsl_sessions')
  }
}
