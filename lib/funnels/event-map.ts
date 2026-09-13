// Mapeo entre las etapas de Funnels que salen de tracking y los nombres de evento REALES de cada
// subcuenta.
//
// POR QUÉ ES CONFIGURABLE Y NO UNA CONSTANTE. `canonical_events.event_name` es texto libre: no hay
// en base ningún vocabulario declarado que diga qué nombre significa "visita a la landing". Un
// diccionario inventado aquí ('page_view', 'vsl_play', 'landing_view'…) habría producido números
// creíbles y falsos — y peor: distintos por subcuenta según qué nombres usara su tracking, sin que
// la pantalla lo dijera. Así que lo mapea quien conoce su propio tracking, y hasta entonces la etapa
// sigue saliendo como 'no_configurada'.
//
// Persistencia: `integration_settings` (clave FUNNEL_EVENT_MAP, no secreta, una fila por subcuenta).
// No hace falta tabla nueva: es configuración por subcuenta, que es exactamente lo que guarda esa
// tabla, y así se lee con el mismo `getTenantConfig` que el resto.
import { FUNNEL_DEFS, FUNNEL_FAMILIES, type FunnelFamily } from '@/lib/funnels/definitions'

export const EVENT_MAP_KEY = 'FUNNEL_EVENT_MAP'

/** Clave de etapa → nombres de evento. La clave es `familia.etapa`. */
export type EventMap = Record<string, string[]>

/**
 * La clave incluye la familia a propósito. 'visitas' existe en el funnel de VSL y en el de webinar y
 * NO son el mismo evento: la landing de un VSL y la página de registro de un webinar son dos
 * páginas distintas. Una clave solo con el id de etapa las habría fundido en silencio.
 */
export function stageKey(family: FunnelFamily, stageId: string): string {
  return `${family}.${stageId}`
}

/** Las etapas que este mapeo puede alimentar: las que declaran la fuente 'vsl' (tracking propio). */
export function mappableStages(): { key: string; family: FunnelFamily; familyLabel: string; label: string }[] {
  const out: { key: string; family: FunnelFamily; familyLabel: string; label: string }[] = []
  for (const family of FUNNEL_FAMILIES) {
    const def = FUNNEL_DEFS[family]
    for (const stage of def.stages) {
      if (stage.source === 'vsl') {
        out.push({ key: stageKey(family, stage.id), family, familyLabel: def.label, label: stage.label })
      }
    }
  }
  return out
}

export const MAX_NAMES_PER_STAGE = 20
export const MAX_NAME_LENGTH = 200

/**
 * Lee el mapeo guardado. Tolerante por diseño: lo que hay guardado puede ser de una versión
 * anterior, de una etapa que ya no existe o directamente basura, y en ese caso la etapa tiene que
 * seguir saliendo como 'no_configurada' — nunca reventar la pantalla entera del funnel.
 */
export function parseEventMap(raw: string | null | undefined): EventMap {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const valid = new Set(mappableStages().map((s) => s.key))
  const out: EventMap = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!valid.has(key) || !Array.isArray(value)) continue
    const names = cleanNames(value)
    if (names.length > 0) out[key] = names
  }
  return out
}

export function serializeEventMap(map: EventMap): string {
  // Claves ordenadas para que guardar dos veces el mismo mapeo no produzca dos valores distintos en
  // base (y por tanto dos entradas de auditoría que parecen un cambio sin serlo).
  const ordered: EventMap = {}
  for (const key of Object.keys(map).sort()) ordered[key] = map[key]
  return JSON.stringify(ordered)
}

/** Nombres mapeados a una etapa, o `[]` si no hay ninguno. */
export function namesFor(map: EventMap, family: FunnelFamily, stageId: string): string[] {
  return map[stageKey(family, stageId)] ?? []
}

/**
 * Valida lo que llega del cliente. Devuelve el mapa limpio o el primer error, nunca un mapa a
 * medias: guardar la mitad de un cambio dejaría el funnel contando cosas que el usuario no eligió.
 */
export function validateEventMap(input: unknown): { map: EventMap } | { error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'El mapeo tiene que ser un objeto de etapa → lista de nombres de evento' }
  }
  const valid = new Set(mappableStages().map((s) => s.key))
  const map: EventMap = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!valid.has(key)) return { error: `Etapa desconocida: ${key}` }
    if (!Array.isArray(value)) return { error: `La etapa ${key} tiene que traer una lista de nombres` }
    if (value.some((v) => typeof v !== 'string')) return { error: `La etapa ${key} tiene nombres que no son texto` }
    if (value.some((v) => (v as string).length > MAX_NAME_LENGTH)) {
      return { error: `La etapa ${key} tiene un nombre de más de ${MAX_NAME_LENGTH} caracteres` }
    }
    const names = cleanNames(value)
    if (names.length > MAX_NAMES_PER_STAGE) {
      return { error: `La etapa ${key} no puede tener más de ${MAX_NAMES_PER_STAGE} nombres` }
    }
    // Una etapa sin nombres se borra del mapa en vez de guardarse como lista vacía: así "desmapear"
    // y "nunca mapeado" son el mismo estado y no hay que distinguir dos formas de lo mismo.
    if (names.length > 0) map[key] = names
  }
  return { map }
}

function cleanNames(value: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const name = raw.trim()
    // Los nombres se comparan tal cual contra event_name: sin normalizar a minúsculas, porque en
    // base 'PageView' y 'pageview' son dos eventos distintos y decidir que son el mismo sería otra
    // suposición.
    if (!name || name.length > MAX_NAME_LENGTH || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}
