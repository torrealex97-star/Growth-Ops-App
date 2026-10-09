import type { SupabaseClient } from '@supabase/supabase-js'

// ATRIBUCIÓN DE UN CONTACTO: de dónde vino, y de dónde vino la PRIMERA vez.
//
// EL ESTADO REAL, comprobado en producción antes de escribir esto:
//   · `contact_attributions` está a 0 filas. La tabla existe, con first_utm_* y last_utm_*, y nada escribe.
//   · `contacts.campaign_id` y `set_source`: 0 de 956.
//   · `appointments.utm_source`: 0 de 559.
//   · Y los payloads de los webhooks NO TRAEN NINGÚN BLOQUE DE TRACKING: ni `tracking.utm_source`, ni
//     UTMs en la raíz. Nada.
//
// ESO ÚLTIMO ES LO IMPORTANTE, y hay que decirlo claro: la atribución no está rota en el código, está
// rota ANTES. Los enlaces de reserva no llevan parámetros UTM, así que Calendly no tiene nada que
// reportar y ningún código puede atribuir lo que nunca se capturó. Arreglarlo es configuración: poner
// UTMs en los enlaces de los anuncios, o instalar el snippet de tracking en la landing.
//
// QUÉ HACE ENTONCES ESTE MÓDULO. Deja el camino de escritura puesto y probado para el día en que los
// UTMs empiecen a llegar, y con la regla que de verdad importa:
//
//   EL PRIMER TOQUE NO SE SOBRESCRIBE NUNCA. Si alguien llega por un anuncio de Meta y dos semanas
//   después vuelve por un email, el anuncio es quien lo trajo. Machacar el primer toque con el último
//   hace que el canal que cierra se lleve el mérito del canal que capta, y con eso se decide el
//   presupuesto: se acabaría apagando lo que trae gente para reforzar lo que solo la remata.
//
//   Lo mismo vale para el COLABORADOR (migración 20260918150000): el primer colaborador válido que
//   atribuye un contacto se queda (first-collaborator-wins); los toques posteriores no lo roban.
//   Corregirlo es tarea de un admin CON motivo y auditoría (ruta colaboradores/attribution).

/** Lo que se puede saber del origen en una entrega. Todo opcional: casi nunca viene completo. */
export type ToqueAtribucion = {
  source?: string | null
  funnel?: string | null
  landingUrl?: string | null
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmContent?: string | null
  utmTerm?: string | null
  utmId?: string | null
  utmSourcePlatform?: string | null
  gclid?: string | null
  gbraid?: string | null
  wbraid?: string | null
  fbclid?: string | null
  ttclid?: string | null
  msclkid?: string | null
  gaClientId?: string | null
  gaSessionId?: string | null
  adId?: string | null
  adName?: string | null
  adSetId?: string | null
  adGroupId?: string | null
  referrer?: string | null
  /** De dónde procede la evidencia; no es el canal de marketing. */
  evidenceSource?: 'provider_first' | 'provider_last' | 'booking' | 'flat_payload' | 'browser'
  /**
   * UUID del collaborator_profile cuando el toque viene de un enlace de
   * colaborador (?ref=CODIGO resuelto server-side a id, nunca el código como
   * identidad). La relación canónica contacto↔colaborador vive ESTRUCTURADA en
   * contact_attributions.collaborator_id; utm_content sigue llenándose para el
   * reporting/interoperabilidad, pero las comisiones no dependen de texto.
   */
  colaboradorId?: string | null
  /** Momento del toque. Por defecto, ahora. */
  enEl?: string
}

/** ¿Trae este toque algo que merezca guardarse? Un toque vacío no se escribe. */
export function toqueTieneDatos(t: ToqueAtribucion): boolean {
  return Boolean(
    t.utmSource ||
    t.utmMedium ||
    t.utmCampaign ||
    t.utmContent ||
    t.utmTerm ||
    t.utmId ||
    t.utmSourcePlatform ||
    t.gclid ||
    t.gbraid ||
    t.wbraid ||
    t.fbclid ||
    t.ttclid ||
    t.msclkid ||
    t.gaClientId ||
    t.gaSessionId ||
    t.adId ||
    t.adName ||
    t.adSetId ||
    t.adGroupId ||
    t.source ||
    t.landingUrl ||
    t.referrer ||
    t.colaboradorId
  )
}

export type TrayectoriaAtribucion = {
  first: ToqueAtribucion | null
  /** Solo existe si el proveedor entrega una segunda interacción cronológica real. */
  second: ToqueAtribucion | null
  last: ToqueAtribucion | null
  booking: ToqueAtribucion | null
}

/** Snapshot sin IP ni user-agent para explicar la atribución de una agenda. */
export function serializarToque(t: ToqueAtribucion | null): Record<string, string> | null {
  if (!t || !toqueTieneDatos(t)) return null
  const values: Record<string, string | null | undefined> = {
    source: t.source,
    landing_url: t.landingUrl,
    referrer: t.referrer,
    utm_source: t.utmSource,
    utm_medium: t.utmMedium,
    utm_campaign: t.utmCampaign,
    utm_content: t.utmContent,
    utm_term: t.utmTerm,
    utm_id: t.utmId,
    utm_source_platform: t.utmSourcePlatform,
    gclid: t.gclid,
    gbraid: t.gbraid,
    wbraid: t.wbraid,
    fbclid: t.fbclid,
    ttclid: t.ttclid,
    msclkid: t.msclkid,
    ga_client_id: t.gaClientId,
    ga_session_id: t.gaSessionId,
    ad_id: t.adId,
    ad_name: t.adName,
    ad_set_id: t.adSetId,
    ad_group_id: t.adGroupId,
    evidence_source: t.evidenceSource,
  }
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])))
}

const texto = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s
}

/**
 * Lee los UTMs de donde suelen venir, sin dar por hecho una forma concreta.
 *
 * Calendly los pone bajo `tracking`, GHL a veces en la raíz y a veces en `contact`, y una landing propia
 * los manda como quiera. Se prueban las rutas conocidas en orden y se devuelve lo primero que haya, en
 * vez de exigir un formato: exigirlo significaría perder la atribución de cualquier proveedor nuevo.
 */
export function leerToque(payload: unknown): ToqueAtribucion {
  if (!payload || typeof payload !== 'object') return {}
  const p = payload as Record<string, unknown>
  const candidatos: Record<string, unknown>[] = []
  for (const ruta of ['tracking', 'contact', 'payload']) {
    const sub = p[ruta]
    if (sub && typeof sub === 'object') candidatos.push(sub as Record<string, unknown>)
  }
  candidatos.push(p)

  const buscar = (...claves: string[]): string | null => {
    for (const c of candidatos) {
      for (const clave of claves) {
        const v = texto(c[clave])
        if (v) return v
      }
    }
    return null
  }

  return {
    utmSource: buscar('utm_source', 'utmSource'),
    utmMedium: buscar('utm_medium', 'utmMedium'),
    utmCampaign: buscar('utm_campaign', 'utmCampaign'),
    utmContent: buscar('utm_content', 'utmContent'),
    utmTerm: buscar('utm_term', 'utmTerm'),
    utmId: buscar('utm_id', 'utmId', 'campaignId'),
    utmSourcePlatform: buscar('utm_source_platform', 'utmSourcePlatform'),
    gclid: buscar('gclid'),
    gbraid: buscar('gbraid'),
    wbraid: buscar('wbraid'),
    fbclid: buscar('fbclid'),
    ttclid: buscar('ttclid'),
    msclkid: buscar('msclkid'),
    gaClientId: buscar('ga_client_id', 'gaClientId'),
    gaSessionId: buscar('ga_session_id', 'gaSessionId'),
    adId: buscar('ad_id', 'adId'),
    adName: buscar('ad_name', 'adName'),
    adSetId: buscar('adset_id', 'ad_set_id', 'adSetId'),
    adGroupId: buscar('ad_group_id', 'adGroupId'),
    landingUrl: buscar('landing_url', 'landingUrl', 'page_url', 'url'),
    referrer: buscar('referrer'),
    source: buscar('source', 'sessionSource', 'utm_source', 'utmSource'),
    evidenceSource: 'flat_payload',
  }
}

function leerObjetoProveedor(
  value: unknown,
  evidenceSource: ToqueAtribucion['evidenceSource']
): ToqueAtribucion | null {
  if (!value || typeof value !== 'object') return null
  const toque = leerToque(value)
  toque.evidenceSource = evidenceSource
  return toqueTieneDatos(toque) ? toque : null
}

/**
 * Normaliza la trayectoria que realmente declara el proveedor.
 *
 * GHL envía `attributionSource` (primer toque) y `lastAttributionSource` (último toque).
 * Calendly envía `tracking`, que es evidencia del toque de reserva. `last` NO se renombra como
 * `second`: una segunda interacción solo existe cuando llega explícitamente como tal.
 */
export function leerTrayectoria(payload: unknown): TrayectoriaAtribucion {
  if (!payload || typeof payload !== 'object') return { first: null, second: null, last: null, booking: null }
  const p = payload as Record<string, unknown>
  const first = leerObjetoProveedor(p.attributionSource ?? p.firstAttributionSource, 'provider_first')
  const second = leerObjetoProveedor(p.secondAttributionSource, 'provider_first')
  const last = leerObjetoProveedor(p.lastAttributionSource, 'provider_last')
  const booking = leerObjetoProveedor(p.tracking, 'booking')
  const flat = leerToque(p)
  return {
    first,
    second,
    last,
    booking: booking ?? (toqueTieneDatos(flat) ? { ...flat, evidenceSource: 'flat_payload' } : null),
  }
}

export type ResultadoAtribucion =
  { ok: true; accion: 'creada' | 'actualizada' | 'sin_datos' } | { ok: false; error: string }

/**
 * Registra un toque de atribución conservando el primero.
 *
 * Se hace en dos pasos (leer y luego escribir) y no en un upsert ciego a propósito: un upsert que
 * escribiera `first_utm_*` sobrescribiría el primer toque en cada visita, que es justo lo que no puede
 * pasar. La ventana entre leer y escribir puede duplicar un toque en una carrera, y eso es inofensivo
 * comparado con perder el origen.
 */
export async function registrarToque(
  sb: SupabaseClient,
  tenantId: string,
  contactId: string,
  toque: ToqueAtribucion
): Promise<ResultadoAtribucion> {
  if (!toqueTieneDatos(toque)) return { ok: true, accion: 'sin_datos' }
  const ahora = toque.enEl ?? new Date().toISOString()

  const { data: existente, error: errorLectura } = await sb
    .from('contact_attributions')
    // Se leen también el último toque y los first_* actuales: el update decide con ellos si
    // rellena huecos del origen y si el toque entrante puede presentarse como el último.
    .select(
      'id, first_touch_at, last_touch_at, collaborator_id, source, funnel, first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content, first_utm_term'
    )
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .eq('is_primary', true)
    .maybeSingle()

  if (errorLectura) return { ok: false, error: errorLectura.message }

  const previo = {
    last_utm_source: toque.utmSource ?? null,
    last_utm_medium: toque.utmMedium ?? null,
    last_utm_campaign: toque.utmCampaign ?? null,
    last_utm_content: toque.utmContent ?? null,
    last_utm_term: toque.utmTerm ?? null,
    last_touch_at: ahora,
    // Las columnas sin prefijo son el toque vigente, que es el último conocido.
    utm_source: toque.utmSource ?? null,
    utm_medium: toque.utmMedium ?? null,
    utm_campaign: toque.utmCampaign ?? null,
    utm_content: toque.utmContent ?? null,
    utm_term: toque.utmTerm ?? null,
    landing_url: toque.landingUrl ?? null,
    updated_at: ahora,
  }

  if (existente) {
    // Y aquí NO va `collaborator_id` en el update: FIRST VALID COLLABORATOR
    // ATTRIBUTION WINS — si el contacto ya tiene colaborador, un toque posterior
    // de otro enlace JAMÁS lo roba (la comisión de alguien no cambia en silencio).
    //
    // `first_*` SOLO se RELLENA si estaba vacío (null no es un toque: rellenar el hueco no
    // es sobrescribir el origen — con valor, jamás). Es lo que permite a la sync por pull
    // (cron calendly-ghl, history-sync, barrido histórico) atribuir el primer toque de
    // contactos importados ANTES de que existiera este módulo (ghl_import sin UTMs).
    //
    // Toque ANTIGUO (la sync relee histórico): si llega con fecha anterior al último
    // registrado, no puede presentarse como último — machacar last_* con un releo viejo
    // haría que la pasada de hoy apareciera como el origen de un lead de hace semanas.
    // En ese caso solo se rellenan huecos y last_* queda como estaba.
    const filas = existente as unknown as {
      first_touch_at: string | null
      last_touch_at: string | null
      source: string | null
      funnel: string | null
      first_utm_source: string | null
      first_utm_medium: string | null
      first_utm_campaign: string | null
      first_utm_content: string | null
      first_utm_term: string | null
    }
    const esAnterior = !!filas.last_touch_at && new Date(ahora).getTime() < new Date(filas.last_touch_at).getTime()
    const huecos: Record<string, string> = {}
    if (!filas.first_utm_source && toque.utmSource) huecos.first_utm_source = toque.utmSource
    if (!filas.first_utm_medium && toque.utmMedium) huecos.first_utm_medium = toque.utmMedium
    if (!filas.first_utm_campaign && toque.utmCampaign) huecos.first_utm_campaign = toque.utmCampaign
    if (!filas.first_utm_content && toque.utmContent) huecos.first_utm_content = toque.utmContent
    if (!filas.first_utm_term && toque.utmTerm) huecos.first_utm_term = toque.utmTerm
    if (!filas.source && toque.source) huecos.source = toque.source
    if (!filas.funnel && toque.funnel) huecos.funnel = toque.funnel
    if (!filas.first_touch_at) huecos.first_touch_at = ahora
    const ultimos = esAnterior ? huecos : { ...previo, ...huecos }
    if (Object.keys(ultimos).length > 0) {
      const { error } = await sb.from('contact_attributions').update(ultimos).eq('id', existente.id)
      if (error) return { ok: false, error: error.message }
    }

    // Relleno solo si estaba VACÍO (NULL = "Directo / Sin colaborador" es un
    // estado válido, y el primer colaborador válido se queda). El cambio queda
    // en audit_logs: quién/qué/cuándo, para poder explicar comisiones futuras.
    const colaboradorEntrante = toque.colaboradorId ?? null
    const colaboradorActual = (existente as { collaborator_id: string | null }).collaborator_id ?? null
    if (colaboradorEntrante && !colaboradorActual) {
      const { error: errorFill } = await sb
        .from('contact_attributions')
        .update({ collaborator_id: colaboradorEntrante })
        .eq('id', existente.id)
        .is('collaborator_id', null) // guard: si otra entrega lo llenó mientras tanto, no pisa
      if (errorFill) return { ok: false, error: errorFill.message }
      const { error: errorAudit } = await sb.from('audit_logs').insert({
        tenant_id: tenantId,
        entity_type: 'contact_attribution',
        entity_id: existente.id,
        action: 'collaborator_attribution',
        old_values: { collaborator_id: null },
        new_values: { collaborator_id: colaboradorEntrante, via: 'referral_touch' },
      })
      if (errorAudit) return { ok: false, error: errorAudit.message }
    }
    return { ok: true, accion: 'actualizada' }
  }

  const { error } = await sb.from('contact_attributions').insert({
    tenant_id: tenantId,
    contact_id: contactId,
    is_primary: true,
    collaborator_id: toque.colaboradorId ?? null,
    source: toque.source ?? null,
    funnel: toque.funnel ?? null,
    first_utm_source: toque.utmSource ?? null,
    first_utm_medium: toque.utmMedium ?? null,
    first_utm_campaign: toque.utmCampaign ?? null,
    first_utm_content: toque.utmContent ?? null,
    first_utm_term: toque.utmTerm ?? null,
    first_touch_at: ahora,
    ...previo,
  })
  return error ? { ok: false, error: error.message } : { ok: true, accion: 'creada' }
}

/**
 * Toque desde un payload de SYNC (cron calendly-ghl, history-sync, barrido histórico).
 *
 * La sync por pull es la vía principal por la que entran las citas — el webhook de Calendly no
 * está configurado y las citas llegaban sin UTM aunque sus payloads los traían. Este helper lee
 * el toque con las mismas rutas que el webhook (leerToque) y lo registra con la semántica de
 * arriba: rellena el primer toque si faltaba, nunca lo sobrescribe, y un toque con fecha
 * antigua nunca se presenta como el último. Sin datos en el payload no se escribe NADA (un
 * hueco no es un cero) y sin llamada a la base: toque vacío ⇒ cero consultas.
 */
export async function atribuirDesdePayload(
  sb: SupabaseClient,
  tenantId: string,
  contactId: string,
  payload: unknown,
  meta: { source?: string | null; enEl?: string | null } = {}
): Promise<{ toque: ToqueAtribucion; resultado: ResultadoAtribucion }> {
  const leido = leerToque(payload)
  // El chequeo de "hay datos" se hace sobre lo que TRAE el payload, sin el source del
  // proveedor: si no, todo payload sin UTMs produciría un toque con solo source=proveedor —
  // filas de atribución vacías y, peor, un update que machacaría last_utm_* con nulls.
  if (!toqueTieneDatos(leido)) return { toque: leido, resultado: { ok: true, accion: 'sin_datos' } }
  const toque: ToqueAtribucion = {
    ...leido,
    source: leido.source ?? meta.source ?? null,
    enEl: meta.enEl ?? undefined,
  }
  const resultado = await registrarToque(sb, tenantId, contactId, toque)
  return { toque, resultado }
}
