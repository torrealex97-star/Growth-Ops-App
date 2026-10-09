import { leerTrayectoria, leerToque, toqueTieneDatos } from '@/lib/contacts/atribucion'

type Json = Record<string, unknown>

const ATTRIBUTION_KEYS = [
  'attributionSource',
  'firstAttributionSource',
  'secondAttributionSource',
  'lastAttributionSource',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
  'utm_source_first',
  'utm_medium_first',
  'utm_campaign_first',
  'utm_content_first',
  'utm_term_first',
  'utm_source_last',
  'utm_medium_last',
  'utm_campaign_last',
  'utm_content_last',
  'utm_term_last',
] as const

/** Solo considera evidencia de marketing real; `source=ghl` por sí solo no cuenta. */
export function tieneEvidenciaAtribucionGhl(payload: Json): boolean {
  const trayectoria = leerTrayectoria(payload)
  if (trayectoria.first || trayectoria.second || trayectoria.last || trayectoria.booking) return true
  const toque = leerToque(payload)
  return toqueTieneDatos({ ...toque, source: null })
}

/**
 * Completa exclusivamente los campos de atribución ausentes en el evento.
 * Los identificadores, fechas y estado de la cita siempre siguen perteneciendo al evento.
 */
export function combinarAtribucionGhl(evento: Json, contacto: Json): Json {
  const combinado = { ...evento }
  for (const key of ATTRIBUTION_KEYS) {
    const actual = combinado[key]
    const entrante = contacto[key]
    if ((actual === undefined || actual === null || actual === '') && entrante !== undefined && entrante !== null) {
      combinado[key] = entrante
    }
  }
  return combinado
}

/**
 * GHL suele enviar el evento de calendario sin atribución, aunque la ficha del contacto sí la
 * conserva. Se consulta solo cuando falta evidencia, con timeout y fallback: una caída de GHL no
 * debe impedir crear la agenda.
 */
export async function enriquecerAtribucionDesdeContactoGhl(
  payload: Json,
  contactId: string | null,
  token: string | null | undefined,
  fetcher: typeof fetch = fetch
): Promise<{ payload: Json; contacto: Json | null; enriquecido: boolean }> {
  if (!contactId || !token || tieneEvidenciaAtribucionGhl(payload)) {
    return { payload, contacto: null, enriquecido: false }
  }
  try {
    const response = await fetcher(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return { payload, contacto: null, enriquecido: false }
    const body = (await response.json().catch(() => ({}))) as { contact?: Json }
    if (!body.contact) return { payload, contacto: null, enriquecido: false }
    const combinado = combinarAtribucionGhl(payload, body.contact)
    return {
      payload: combinado,
      contacto: body.contact,
      enriquecido: tieneEvidenciaAtribucionGhl(combinado) && !tieneEvidenciaAtribucionGhl(payload),
    }
  } catch {
    return { payload, contacto: null, enriquecido: false }
  }
}
