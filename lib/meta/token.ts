import crypto from 'crypto'

import { graphUrl, META_API_VERSION } from '@/lib/meta/api-version'

// INSPECCIÓN DEL TOKEN DE META (`/debug_token`).
//
// POR QUÉ EXISTE. Hasta ahora la app solo se enteraba de que un token había muerto cuando una
// sincronización fallaba con un 190. Con un token de usuario de corta duración eso son horas de
// gasto sin entrar y una pantalla que dice «conectada pero sin sincronizar» sin explicar por qué. Meta
// permite preguntar de antemano si el token es válido, de qué tipo es, cuándo caduca y qué permisos
// tiene realmente concedidos: es lo que convierte «no funciona» en «este token caduca en 2 horas, usa
// uno de System User» o «te falta ads_read».
//
// NUNCA SE DEVUELVE EL TOKEN, ni parte de él: solo lo que Meta cuenta sobre él.
//
// UN FALLO AL INSPECCIONAR NO ES UN FALLO DEL TOKEN. Si `/debug_token` no responde o no admite este
// tipo de token, el resultado es `no_disponible` y la comprobación de salud sigue valiendo lo que valía:
// no se puede empeorar un veredicto por no haber podido añadirle información.

export type InfoToken = {
  valido: boolean
  /** `usuario`, `system_user`, `pagina`, `app` o `desconocido`, según lo que declare Meta. */
  tipo: 'usuario' | 'system_user' | 'pagina' | 'app' | 'desconocido'
  /** `true` SOLO si Meta dijo explícitamente `expires_at: 0`: lo que se espera de un token de System User. */
  duradero: boolean
  /** Fecha de caducidad; `null` si no caduca O si Meta no la dijo (distínguelo con `duradero`). */
  caducaEl: string | null
  /** Horas que le quedan; `null` si no caduca o ya caducó. */
  horasRestantes: number | null
  /** Meta pone el acceso a datos de un token de usuario a 90 días aunque el token siga vivo. */
  accesoADatosHasta: string | null
  ambitos: string[]
  /** Motivo que da Meta cuando `valido` es falso (token revocado, contraseña cambiada…). */
  motivo: string | null
}

export type ResultadoInspeccion = { estado: 'ok'; info: InfoToken } | { estado: 'no_disponible'; motivo: string }

type DebugTokenBody = {
  data?: {
    is_valid?: boolean
    type?: string
    expires_at?: number
    data_access_expires_at?: number
    scopes?: string[]
    error?: { message?: string }
  }
  error?: { message?: string }
}

const aIso = (segundos: number | undefined): string | null =>
  typeof segundos === 'number' && segundos > 0 ? new Date(segundos * 1000).toISOString() : null

function normalizarTipo(t: string | undefined): InfoToken['tipo'] {
  const v = (t ?? '').toLowerCase().replace(/[\s-]+/g, '_')
  if (v === 'system_user') return 'system_user'
  if (v === 'user') return 'usuario'
  if (v === 'page') return 'pagina'
  if (v === 'app') return 'app'
  return 'desconocido'
}

/**
 * PURO. Convierte la respuesta de `/debug_token` en algo con significado. `ahora` es un parámetro para
 * poder probar «le quedan 2 horas» sin depender del reloj.
 */
export function interpretarDebugToken(body: unknown, ahora: number = Date.now()): InfoToken | null {
  const d = (body as DebugTokenBody | null)?.data
  if (!d || typeof d !== 'object') return null
  const caduca = aIso(d.expires_at)
  const finMs = caduca ? Date.parse(caduca) : null
  return {
    valido: d.is_valid === true,
    tipo: normalizarTipo(d.type),
    // `expires_at: 0` es el valor que Meta usa para «no caduca». Un campo ausente NO es lo mismo: se
    // trata como desconocido para no prometer que un token no caduca sin que Meta lo haya dicho.
    duradero: d.expires_at === 0,
    caducaEl: caduca,
    horasRestantes: finMs && finMs > ahora ? Math.round(((finMs - ahora) / 3_600_000) * 10) / 10 : null,
    accesoADatosHasta: aIso(d.data_access_expires_at),
    ambitos: Array.isArray(d.scopes) ? d.scopes.filter((x): x is string => typeof x === 'string') : [],
    motivo: d.error?.message ?? null,
  }
}

/** ¿Este token está pensado para durar? `true` solo si Meta dijo explícitamente `expires_at: 0`. */
export function noCaduca(body: unknown): boolean {
  return (body as DebugTokenBody | null)?.data?.expires_at === 0
}

type Opciones = {
  version?: string
  /** App Secret guardado: firma la llamada (`appsecret_proof`) para las apps que lo exigen. */
  appSecret?: string
  /** Id de la app: con él se usa un token de aplicación, que inspecciona cualquier tipo de token. */
  appId?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export async function inspeccionarToken(token: string, opts: Opciones = {}): Promise<ResultadoInspeccion> {
  const t = token.trim()
  if (!t) return { estado: 'no_disponible', motivo: 'No hay token que inspeccionar.' }
  const secreto = opts.appSecret?.trim()
  const appId = opts.appId?.trim()
  // Con App ID + App Secret se inspecciona con el token de la aplicación (`id|secreto`), que vale para
  // cualquier tipo de token. Sin ellos, el token se inspecciona a sí mismo, que Meta admite para los
  // tokens de usuario y de System User de la propia app.
  const acceso = appId && secreto ? `${appId}|${secreto}` : t
  const proof = !(appId && secreto) && secreto ? crypto.createHmac('sha256', secreto).update(t).digest('hex') : ''
  const url =
    graphUrl(opts.version || META_API_VERSION, 'debug_token') +
    `?input_token=${encodeURIComponent(t)}&access_token=${encodeURIComponent(acceso)}` +
    (proof ? `&appsecret_proof=${proof}` : '')
  try {
    const r = await (opts.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) })
    const body = (await r.json().catch(() => null)) as DebugTokenBody | null
    const info = interpretarDebugToken(body)
    if (!info) {
      return { estado: 'no_disponible', motivo: body?.error?.message || `Meta respondió ${r.status} al inspeccionar.` }
    }
    return { estado: 'ok', info }
  } catch {
    return { estado: 'no_disponible', motivo: 'Meta no respondió a tiempo al inspeccionar el token.' }
  }
}
