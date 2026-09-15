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
  /** Momento del toque. Por defecto, ahora. */
  enEl?: string
}

/** ¿Trae este toque algo que merezca guardarse? Un toque vacío no se escribe. */
export function toqueTieneDatos(t: ToqueAtribucion): boolean {
  return Boolean(t.utmSource || t.utmMedium || t.utmCampaign || t.utmContent || t.utmTerm || t.source || t.landingUrl)
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
    landingUrl: buscar('landing_url', 'landingUrl', 'page_url', 'url'),
    source: buscar('source', 'utm_source'),
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
    .select('id, first_touch_at')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .eq('is_primary', true)
    .maybeSingle()

  if (errorLectura) return { ok: false, error: errorLectura.message }

  const ultimos = {
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
    // OJO: aquí NO van los `first_*`. Es la línea que protege el origen.
    const { error } = await sb.from('contact_attributions').update(ultimos).eq('id', existente.id)
    return error ? { ok: false, error: error.message } : { ok: true, accion: 'actualizada' }
  }

  const { error } = await sb.from('contact_attributions').insert({
    tenant_id: tenantId,
    contact_id: contactId,
    is_primary: true,
    source: toque.source ?? null,
    funnel: toque.funnel ?? null,
    first_utm_source: toque.utmSource ?? null,
    first_utm_medium: toque.utmMedium ?? null,
    first_utm_campaign: toque.utmCampaign ?? null,
    first_utm_content: toque.utmContent ?? null,
    first_utm_term: toque.utmTerm ?? null,
    first_touch_at: ahora,
    ...ultimos,
  })
  return error ? { ok: false, error: error.message } : { ok: true, accion: 'creada' }
}
