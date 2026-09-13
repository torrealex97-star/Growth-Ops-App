// Cliente único de la API de Stripe: autenticación, timeout, errores traducidos y PAGINACIÓN.
//
// POR QUÉ EXISTE. Había cuatro `fetch` a Stripe escritos a mano (conciliación, base de clientes,
// informe de backfill, registro de ventas) y solo uno paginaba. Los otros pedían `limit=100` y se
// quedaban con las 100 más recientes: la base de clientes "estaba completa" mientras se dejaba fuera
// todo lo anterior, sin un solo error por medio. Truncar en silencio es peor que fallar.
//
// Además traduce el error a un código estable (los mismos que usa el panel para proponer el arreglo)
// en vez de propagar el texto de Stripe tal cual.

export type StripeAuth = {
  secretKey: string
  /** Cuenta conectada (Stripe Connect), si la hay. */
  accountId?: string | null
}

export type StripeErrorInfo = { code: string; message: string }

export class StripeError extends Error {
  readonly code: string
  constructor(info: StripeErrorInfo) {
    super(info.message)
    this.name = 'StripeError'
    this.code = info.code
  }
}

/** Traduce la respuesta de error de Stripe a una causa con arreglo conocido. */
export function classifyStripeError(status: number, body: unknown): StripeErrorInfo {
  const err = (body as { error?: { message?: string; code?: string; type?: string } } | null)?.error
  const detalle = err?.message || ''
  if (status === 401) {
    return {
      code: 'token_invalido',
      message:
        `Stripe no acepta la clave secreta: está mal copiada, es de otro entorno o fue revocada. ${detalle}`.trim(),
    }
  }
  if (status === 403) {
    return {
      code: 'sin_permisos',
      message: `La clave de Stripe es válida pero no tiene permiso para esto. ${detalle}`.trim(),
    }
  }
  if (status === 429) {
    return { code: 'limite_de_uso', message: `Stripe ha limitado temporalmente las peticiones. ${detalle}`.trim() }
  }
  if (status >= 500) {
    return { code: 'red', message: `Stripe está devolviendo un error temporal. ${detalle}`.trim() }
  }
  return { code: 'respuesta_inesperada', message: detalle || `Stripe respondió ${status}.` }
}

const API = 'https://api.stripe.com/v1'
const TIMEOUT_MS = 20_000

function headers(auth: StripeAuth): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.secretKey}`,
    ...(auth.accountId ? { 'Stripe-Account': auth.accountId } : {}),
  }
}

/** Una petición GET a Stripe. Lanza `StripeError` con código si no responde bien. */
export async function stripeGet<T>(path: string, params: URLSearchParams, auth: StripeAuth): Promise<T> {
  const qs = params.toString()
  let res: Response
  try {
    res = await fetch(`${API}/${path}${qs ? `?${qs}` : ''}`, {
      headers: headers(auth),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new StripeError({ code: 'timeout', message: 'Stripe tardó demasiado en responder.' })
    }
    throw new StripeError({ code: 'red', message: 'No se pudo conectar con Stripe.' })
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: unknown }
  if (!res.ok) throw new StripeError(classifyStripeError(res.status, json))
  return json
}

type StripeListPage<T> = { data?: T[]; has_more?: boolean }

export type StripeListResult<T> = {
  items: T[]
  /** `true` = Stripe tiene más páginas y se paró por presupuesto, NO porque se acabaran los datos. */
  truncated: boolean
  pages: number
}

/**
 * Recorre una lista paginada de Stripe siguiendo `starting_after`.
 *
 * `maxPages` y `deadline` existen porque una lambda tiene 60 s: al agotarlos se devuelve
 * `truncated: true` para que quien llama pueda DECIRLO, en vez de presentar media lista como si
 * fuera toda.
 */
export async function stripeList<T extends { id: string }>(
  path: string,
  params: URLSearchParams,
  auth: StripeAuth,
  opts: { maxPages?: number; deadline?: number } = {}
): Promise<StripeListResult<T>> {
  const maxPages = opts.maxPages ?? 40
  const items: T[] = []
  let startingAfter: string | undefined
  let pages = 0
  let truncated = false

  while (pages < maxPages) {
    if (opts.deadline && Date.now() > opts.deadline) {
      truncated = true
      break
    }
    const query = new URLSearchParams(params)
    if (startingAfter) query.set('starting_after', startingAfter)
    const page = await stripeGet<StripeListPage<T>>(path, query, auth)
    const batch = page.data ?? []
    items.push(...batch)
    pages++
    if (!page.has_more || batch.length === 0) return { items, truncated: false, pages }
    startingAfter = batch[batch.length - 1].id
  }
  return { items, truncated: truncated || pages >= maxPages, pages }
}
