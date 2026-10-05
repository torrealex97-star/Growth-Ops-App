/**
 * Techo de red para el cliente Supabase del navegador.
 *
 * PostgREST/Auth son lecturas cortas que nunca deben dejar una pantalla esperando
 * indefinidamente. Storage conserva un margen mayor porque puede transferir archivos.
 */
export const SUPABASE_REQUEST_TIMEOUT_MS = 15_000
export const SUPABASE_STORAGE_TIMEOUT_MS = 60_000

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  if (init?.signal) return init.signal
  return typeof Request !== 'undefined' && input instanceof Request ? input.signal : null
}

export async function fetchSupabaseWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const externalSignal = requestSignal(input, init)
  const controller = new AbortController()
  const timeoutMs = requestUrl(input).includes('/storage/v1/')
    ? SUPABASE_STORAGE_TIMEOUT_MS
    : SUPABASE_REQUEST_TIMEOUT_MS

  const abortFromCaller = () => controller.abort()
  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true })

  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortFromCaller)
  }
}
