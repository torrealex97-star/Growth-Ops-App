// Historial de ejecuciones de las sincronizaciones: quién corrió, cuándo, con qué resultado y —
// sobre todo — con qué error si falló.
//
// POR QUÉ EXISTE. El panel mandaba "revisa el último error del sync" y ese error no se guardaba en
// ningún sitio: una sync de Meta que fallaba por credenciales dejaba `campaigns` vacía y el panel
// solo sabía decir "está vacía". Con esto, "vacía" pasa a tener causa: nunca se ejecutó, falló con
// este mensaje, o corrió bien y el proveedor no devolvió nada.
//
// Dos reglas duras:
//   · Nada de credenciales en el historial. `redactSecrets` limpia el mensaje ANTES de guardarlo.
//   · Si la tabla no existe (migración sin aplicar), la sync NO se cae: se ejecuta sin historial.
import type { SupabaseClient } from '@supabase/supabase-js'

type SyncRunStatus = 'running' | 'ok' | 'error' | 'timeout'
export type SyncTrigger = 'cron' | 'manual' | 'historico'

export type SyncRunSummary = {
  job: string
  provider: string
  status: SyncRunStatus
  trigger: SyncTrigger
  startedAt: string
  finishedAt: string | null
  rowsWritten: number | null
  errorCode: string | null
  errorMessage: string | null
}

/** Una ejecución "en curso" más vieja que esto se da por muerta (la lambda se cortó). */
const STALE_RUN_MS = 15 * 60 * 1000

/** Códigos por los que MERECE la pena reintentar: el fallo es del transporte, no de la petición. */
const RETRYABLE_CODES = new Set(['limite_de_uso', 'red', 'timeout'])

export function isRetryableCode(code: string | undefined | null): boolean {
  return !!code && RETRYABLE_CODES.has(code)
}

/**
 * Borra del texto cualquier credencial que se le pase, además de los patrones que delatan un token
 * incrustado en una URL. Un mensaje de error es lo más fácil de filtrar a un log: la Graph API pone
 * el `access_token` en el query string, así que cualquier error que arrastre la URL lo lleva dentro.
 */
export function redactSecrets(message: string, secrets: Array<string | undefined | null> = []): string {
  let out = message ?? ''
  for (const s of secrets) {
    const value = (s ?? '').trim()
    if (value.length < 8) continue // un valor cortísimo no es una credencial y borrarlo destrozaría el texto
    out = out.split(value).join('[oculto]')
  }
  // Credenciales en query string o cabeceras, incluso si no nos las pasaron.
  out = out.replace(
    /(access_token|appsecret_proof|api_key|apikey|token|secret|authorization)=[^&\s"']+/gi,
    '$1=[oculto]'
  )
  out = out.replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{6,}/g, '[oculto]')
  out = out.replace(/\bBearer\s+[A-Za-z0-9._\-]{8,}/gi, 'Bearer [oculto]')
  return out
}

/** Lo que una sync reporta de sí misma al terminar. `failures` = fallos parciales (no todo o nada). */
export type SyncOutcome = {
  rowsWritten?: number | null
  failures?: string[]
  detail?: Record<string, unknown>
}

export class SyncBusyError extends Error {
  readonly code = 'ya_en_curso'
  constructor(job: string) {
    super(`Ya hay una sincronización de ${job} en curso. Espera a que termine.`)
    this.name = 'SyncBusyError'
  }
}

function codeOf(err: unknown): string | null {
  const code = (err as { code?: unknown })?.code
  return typeof code === 'string' ? code : null
}

/** Cierra las ejecuciones colgadas para que el cerrojo no bloquee para siempre. */
async function reclaimStaleRuns(sb: SupabaseClient, tenantId: string, job: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString()
  await sb
    .from('integration_sync_runs')
    .update({
      status: 'timeout',
      finished_at: new Date().toISOString(),
      error_code: 'timeout',
      error_message: 'La ejecución se cortó antes de terminar (se agotó el tiempo de la función).',
    })
    .eq('tenant_id', tenantId)
    .eq('job', job)
    .eq('status', 'running')
    .lt('started_at', cutoff)
}

/**
 * Ejecuta `work` dejando constancia de la ejecución. Devuelve lo que devuelva `work`.
 *
 * · Si ya hay otra ejecución del mismo job en curso, lanza `SyncBusyError` sin ejecutar nada.
 * · Si `work` lanza, guarda el error (redactado) y vuelve a lanzar: quien llama decide el HTTP.
 * · Si `work` devuelve fallos parciales, la ejecución queda como 'error' PERO no se pierde lo escrito.
 */
export async function recordSyncRun<T>(
  sb: SupabaseClient,
  spec: {
    tenantId: string
    provider: string
    job: string
    trigger: SyncTrigger
    /** Credenciales a redactar de cualquier mensaje antes de guardarlo. */
    secrets?: Array<string | undefined | null>
  },
  work: () => Promise<T>,
  outcome?: (result: T) => SyncOutcome
): Promise<T> {
  const scrub = (msg: string) => redactSecrets(msg, spec.secrets).slice(0, 2000)
  await reclaimStaleRuns(sb, spec.tenantId, spec.job).catch(() => {})

  const { data: started, error: startErr } = await sb
    .from('integration_sync_runs')
    .insert({
      tenant_id: spec.tenantId,
      provider: spec.provider,
      job: spec.job,
      status: 'running',
      trigger: spec.trigger,
    })
    .select('id')
    .single()

  // 23505 = violación de unique → el cerrojo: ya hay una ejecución en curso.
  if (startErr?.code === '23505') throw new SyncBusyError(spec.job)
  // Cualquier otro fallo al abrir el historial (tabla sin migrar, permisos) NO debe impedir la
  // sincronización: se ejecuta sin registro y se deja constancia en el log del servidor.
  const runId = started?.id as string | undefined
  if (!runId) {
    if (startErr) console.warn(`[sync-runs] no se pudo registrar la ejecución de ${spec.job}: ${startErr.message}`)
    return work()
  }

  const finish = async (fields: Record<string, unknown>) => {
    await sb
      .from('integration_sync_runs')
      .update({ finished_at: new Date().toISOString(), ...fields })
      .eq('id', runId)
      .then(
        () => undefined,
        () => undefined
      )
  }

  try {
    const result = await work()
    const summary = outcome?.(result) ?? {}
    const failures = summary.failures ?? []
    await finish({
      status: failures.length > 0 ? 'error' : 'ok',
      rows_written: summary.rowsWritten ?? null,
      error_code: failures.length > 0 ? 'escritura_parcial' : null,
      error_message: failures.length > 0 ? scrub(failures[0]) : null,
      detail: { ...(summary.detail ?? {}), fallos: failures.length ? failures.slice(0, 20).map(scrub) : undefined },
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    await finish({ status: 'error', error_code: codeOf(err), error_message: scrub(message) })
    throw err
  }
}

type RunRow = {
  job: string
  provider: string
  status: SyncRunStatus
  trigger: SyncTrigger
  started_at: string
  finished_at: string | null
  rows_written: number | null
  error_code: string | null
  error_message: string | null
}

function toSummary(row: RunRow): SyncRunSummary {
  return {
    job: row.job,
    provider: row.provider,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    rowsWritten: row.rows_written,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  }
}

/** Última ejecución de cada job de una subcuenta. `{}` si la tabla todavía no existe. */
export async function lastRunsByJob(
  sb: SupabaseClient,
  tenantId: string
): Promise<Record<string, SyncRunSummary | null>> {
  const { data, error } = await sb
    .from('integration_sync_runs')
    .select('job,provider,status,trigger,started_at,finished_at,rows_written,error_code,error_message')
    .eq('tenant_id', tenantId)
    .order('started_at', { ascending: false })
    .limit(300)
  if (error || !data) return {}
  const out: Record<string, SyncRunSummary | null> = {}
  for (const row of data as RunRow[]) {
    if (!out[row.job]) out[row.job] = toSummary(row)
  }
  return out
}
