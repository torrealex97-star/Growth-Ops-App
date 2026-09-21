// ApifyService — implementación EXTERNA de la capa de investigación (brief §4, §5, §7, §9).
//
// Reglas que este fichero aplica:
//  §4  Token por `Authorization: Bearer` (nunca en la URL), timeouts, retries controlados,
//      logging sin secretos, validación de conexión.
//  §5  NADA acoplado a un Actor concreto: el actorId viene de configuración y los adapters
//      (lib/social/normalize.ts) traducen nuestro modelo al esquema del Actor y su salida al nuestro.
//  §7  Ejecución asíncrona: runActor responde enseguida; el resultado entra por webhook.
//  §9  Datasets paginados — no se asume que quepan en una petición.
//  §17 Jamás se envían credenciales de la cuenta propia al Actor.
//  §23 Logs estructurados sin secretos.

import { randomUUID } from 'crypto'
import { adapterFor } from './normalize'
import {
  RESEARCH_LIMITS,
  type NormalizedEnv,
  type ResearchInput,
  type SocialJobType,
  type SocialPlatform,
} from './types'

const APIFY_API = 'https://api.apify.com/v2'
// Timeout de petición HTTP a Apify (no confundir con la duración del run, que es asíncrona).
const APIFY_TIMEOUT_MS = RESEARCH_LIMITS.requestTimeoutMs

export class ApifyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly type?: string
  ) {
    super(message)
    this.name = 'ApifyError'
  }
}

type FilaJson = Record<string, unknown>

/** GET/POST contra la API v2 con Bearer, timeout y UN reintento ante 429/5xx (backoff corto). */
async function apifyApi<T = FilaJson>(
  path: string,
  token: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown }
): Promise<T> {
  const call = async (): Promise<Response> => {
    const res = await fetch(`${APIFY_API}${path}`, {
      method: init?.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(APIFY_TIMEOUT_MS),
    })
    return res
  }
  let res: Response
  try {
    res = await call()
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 800))
      res = await call()
    }
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new ApifyError('Apify no respondió a tiempo (timeout)')
    }
    throw err
  }
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { type?: string; message?: string } }
  if (!res.ok || json.error) {
    throw new ApifyError(json.error?.message || `Apify respondió ${res.status}`, res.status, json.error?.type)
  }
  return json.data as T
}

export type ApifyRun = {
  id: string
  status: string
  defaultDatasetId?: string
  finishedAt?: string | null
  startedAt?: string | null
  statusMessage?: string | null
}

export const ApifyService = {
  /** §4: valida conexión sin gastar dinero — lee los datos de usuario del token. */
  async validateConnection(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
    try {
      const me = await apifyApi<{ username?: string }>('/users/me', token)
      return { ok: true, username: me?.username }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'error desconocido' }
    }
  },

  /** §7: ejecución asíncrona — responde enseguida con el run; el resultado llega por webhook. */
  async runActor(actorId: string, input: FilaJson, token: string): Promise<ApifyRun> {
    return apifyApi<ApifyRun>(`/actors/${encodeURIComponent(actorId)}/runs`, token, {
      method: 'POST',
      body: input,
    })
  },

  async getRun(runId: string, token: string): Promise<ApifyRun> {
    return apifyApi<ApifyRun>(`/actor-runs/${encodeURIComponent(runId)}`, token)
  },

  /** §9: descarga los items de un dataset paginando (offset/limit) con techo duro.
   *  OJO: el endpoint /datasets/{id}/items devuelve un ARRAY pelado, no { data: [...] } —
   *  por eso no pasa por apifyApi() (que hace unwrap de .data y devolvería undefined).
   *  Destapado en la primera sync real 21-sep: el job acababa completed con 0 records
   *  porque un array sobre el que se lee .data es undefined. */
  async fetchDatasetItems(datasetId: string, token: string, maxItems = 5000): Promise<FilaJson[]> {
    const out: FilaJson[] = []
    const limit = 1000
    let offset = 0
    while (out.length < maxItems) {
      const res = await fetch(
        `${APIFY_API}/datasets/${encodeURIComponent(datasetId)}/items?limit=${limit}&offset=${offset}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(APIFY_TIMEOUT_MS),
        }
      )
      if (!res.ok) throw new ApifyError(`Apify respondió ${res.status} al leer el dataset`, res.status)
      const batch = (await res.json().catch(() => [])) as unknown
      const items = Array.isArray(batch) ? (batch as FilaJson[]) : []
      out.push(...items)
      if (items.length < limit) break
      offset += items.length
    }
    return out.slice(0, maxItems)
  },
}

// ---------------------------------------------------------------------------
// Config por tenant (token + actorIds). Vive en Integraciones (integration_settings cifrada)
// con fallback a process.env del despliegue. §25: sin token la capa queda desactivada.
// ---------------------------------------------------------------------------

export type ApifyConfig = {
  token: string
  actors: Partial<Record<'instagram_reels' | 'instagram_profile' | 'tiktok' | 'youtube', string>>
  resultsLimit: number
  maxProfilesPerRun: number
}

export function getApifyConfig(env: NormalizedEnv): ApifyConfig | null {
  const token = env.APIFY_API_TOKEN?.trim()
  if (!token) return null
  const clampInt = (raw: string | undefined, def: number, max: number) => {
    const n = Number.parseInt(raw || '', 10)
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def
  }
  return {
    token,
    actors: {
      instagram_reels: env.APIFY_INSTAGRAM_REELS_ACTOR_ID?.trim() || undefined,
      instagram_profile: env.APIFY_INSTAGRAM_PROFILE_ACTOR_ID?.trim() || undefined,
      tiktok: env.APIFY_TIKTOK_ACTOR_ID?.trim() || undefined,
      youtube: env.APIFY_YOUTUBE_ACTOR_ID?.trim() || undefined,
    },
    resultsLimit: clampInt(
      env.APIFY_RESULTS_LIMIT,
      RESEARCH_LIMITS.defaultResultsPerProfile,
      RESEARCH_LIMITS.maxResultsPerProfile
    ),
    maxProfilesPerRun: clampInt(
      env.APIFY_MAX_PROFILES_PER_RUN,
      RESEARCH_LIMITS.maxProfilesPerRun,
      RESEARCH_LIMITS.maxProfilesPerRun
    ),
  }
}

export function isApifyEnabled(env: NormalizedEnv): boolean {
  return !!getApifyConfig(env)
}

/** Actor necesario para un jobType/plataforma — sin hardcodear nombres (§5). */
export function actorFor(platform: SocialPlatform, jobType: SocialJobType, cfg: ApifyConfig): string | null {
  if (platform === 'instagram') {
    if (jobType === 'reels') return cfg.actors.instagram_reels || null
    return cfg.actors.instagram_profile || null
  }
  if (platform === 'tiktok') return cfg.actors.tiktok || null
  return cfg.actors.youtube || null
}

export type CreateResearchResult =
  | { ok: true; jobId: string; runId: string; datasetId?: string }
  | { ok: false; error: string; code: 'sin_configurar' | 'sin_actor' | 'limites' | 'proveedor_error' }

/**
 * Crea el job de investigación y lanza el Actor de forma ASÍNCRONA (§7). La petición HTTP no
 * espera al run: el resultado entra por webhook (`/api/webhooks/apify`). §24 aplica los topes
 * internos (perfiles por run, resultados, concurrencia) y genera una idempotency_key para frenar
 * submits duplicados del frontend.
 */
export async function createResearchJob(
  sb: any, // SupabaseClient con service-role
  tenantId: string,
  platform: SocialPlatform,
  input: ResearchInput,
  cfg: ApifyConfig
): Promise<CreateResearchResult> {
  const adapter = adapterFor(platform, input.jobType)
  if (!adapter) return { ok: false, error: 'Tipo de investigación no soportado', code: 'sin_actor' }
  const actorId = actorFor(platform, input.jobType, cfg)
  if (!actorId) return { ok: false, error: 'No hay Actor configurado para esta investigación', code: 'sin_actor' }

  // §24: topes duros, independientes de lo que pida el frontend.
  const usernames = [...new Set(input.usernames.map((u) => u.trim().replace(/^@/, '')).filter(Boolean))].slice(
    0,
    cfg.maxProfilesPerRun
  )
  if (!usernames.length) return { ok: false, error: 'Falta el username a investigar', code: 'limites' }
  const resultsLimit = Math.min(Math.max(1, input.resultsLimit), RESEARCH_LIMITS.maxResultsPerProfile)

  // §24: no más de N jobs en marcha a la vez para este tenant.
  const { count: enMarcha } = await sb
    .from('social_research_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'processing'])
  if ((enMarcha ?? 0) >= RESEARCH_LIMITS.maxConcurrentJobs) {
    return { ok: false, error: 'Ya hay investigaciones en curso: espera a que terminen', code: 'limites' }
  }

  const normalizedInput: ResearchInput = { usernames, resultsLimit, jobType: input.jobType }
  const idempotencyKey = randomUUID()

  const { data: job, error: jobErr } = await sb
    .from('social_research_jobs')
    .insert({
      tenant_id: tenantId,
      platform,
      provider: 'apify',
      job_type: input.jobType,
      actor_id: actorId,
      status: 'pending',
      input_json: normalizedInput,
      idempotency_key: idempotencyKey,
    })
    .select('id')
    .single()
  if (jobErr || !job)
    return { ok: false, error: jobErr?.message || 'No se pudo crear el trabajo', code: 'proveedor_error' }

  try {
    // §17: al Actor SOLO va el input público (usernames/limit). Nunca tokens ni cookies.
    const run = await ApifyService.runActor(actorId, adapter.buildInput(normalizedInput, resultsLimit), cfg.token)
    await sb
      .from('social_research_jobs')
      .update({
        status: 'processing',
        provider_run_id: run.id,
        provider_dataset_id: run.defaultDatasetId || null,
        started_at: new Date().toISOString(),
      })
      .eq('id', job.id)
    console.log(
      JSON.stringify({
        evt: 'social_research.created',
        tenantId,
        platform,
        jobType: input.jobType,
        jobId: job.id,
        runId: run.id,
        datasetId: run.defaultDatasetId || null,
        profiles: usernames.length,
        resultsLimit,
      })
    )
    return { ok: true, jobId: job.id, runId: run.id, datasetId: run.defaultDatasetId }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error del proveedor'
    await sb
      .from('social_research_jobs')
      .update({ status: 'failed', error_message: msg, completed_at: new Date().toISOString() })
      .eq('id', job.id)
    return { ok: false, error: msg, code: 'proveedor_error' }
  }
}

/**
 * Procesa el resultado de un run: descarga el dataset, normaliza con el adapter, guarda raw
 * + normalizado y marca el job (§8 pasos 4-9). IDEMPOTENTE: el unique (provider, provider_run_id)
 * y los upsert por external_id hacen que procesar dos veces el mismo webhook no duplique nada.
 */
export async function processRunResults(
  sb: any,
  cfg: ApifyConfig,
  runId: string,
  opts?: { finalStatus?: 'completed' | 'failed' | 'aborted'; errorMessage?: string }
): Promise<{ ok: boolean; jobId?: string; records?: number; error?: string }> {
  const { data: job } = await sb
    .from('social_research_jobs')
    .select('id, tenant_id, platform, job_type, actor_id, input_json, status, provider_dataset_id')
    .eq('provider', 'apify')
    .eq('provider_run_id', runId)
    .maybeSingle()
  if (!job) return { ok: false, error: 'run desconocido' }
  if (job.status === 'completed') return { ok: true, jobId: job.id, records: 0 } // ya procesado

  const t0 = Date.now()
  const final = opts?.finalStatus || 'completed'
  if (final !== 'completed') {
    await sb
      .from('social_research_jobs')
      .update({ status: final, error_message: opts?.errorMessage || null, completed_at: new Date().toISOString() })
      .eq('id', job.id)
    return { ok: true, jobId: job.id, records: 0 }
  }

  try {
    // El run puede rellenar defaultDatasetId tras crearse: si el job no lo tiene, se lee del run.
    let datasetId: string | undefined = job.provider_dataset_id || undefined
    if (!datasetId) {
      const run = await ApifyService.getRun(runId, cfg.token)
      datasetId = run.defaultDatasetId
      if (!datasetId) return { ok: false, error: 'el run no tiene dataset', jobId: job.id }
    }

    const items = await ApifyService.fetchDatasetItems(datasetId, cfg.token)
    const adapter = adapterFor(job.platform as SocialPlatform, job.job_type as SocialJobType)
    const input = (job.input_json || {}) as ResearchInput
    const usernames: string[] = Array.isArray(input.usernames) ? input.usernames : []
    const normalized = adapter ? adapter.normalize(items, usernames) : { profiles: [], posts: [] }

    // Raw (§11): para debugging; la app nunca lee de aquí.
    if (items.length) {
      await sb.from('social_raw_payloads').insert({ tenant_id: job.tenant_id, job_id: job.id, payload: items })
    }

    // Upsert de perfiles → mapa username→id para atar los posts.
    const profileIds = new Map<string, string>()
    for (const p of normalized.profiles) {
      const row = {
        tenant_id: job.tenant_id,
        platform: job.platform,
        external_id: p.externalId || null,
        username: p.username,
        display_name: p.displayName || null,
        profile_url: p.profileUrl || null,
        avatar_url: p.avatarUrl || null,
        followers_count: p.followersCount ?? null,
        following_count: p.followingCount ?? null,
        posts_count: p.postsCount ?? null,
        verified: p.verified ?? false,
        biography: p.biography || null,
        metadata_json: p.metadata || null,
        collected_at: new Date().toISOString(),
        source: 'apify',
        job_id: job.id,
      }
      const { data: up, error: upErr } = await sb
        .from('social_profiles')
        .upsert(row, { onConflict: 'tenant_id,platform,username' })
        .select('id, username')
        .single()
      if (!upErr && up) profileIds.set(String(up.username).toLowerCase(), up.id)
    }

    // Upsert de posts (unique tenant+platform+external_id → webhook doble no duplica).
    let processed = 0
    for (const p of normalized.posts) {
      const row = {
        tenant_id: job.tenant_id,
        platform: job.platform,
        external_id: p.externalId,
        profile_id: p.username ? profileIds.get(p.username.toLowerCase()) || null : null,
        content_type: p.contentType || null,
        caption: p.caption || null,
        post_url: p.postUrl || null,
        media_url: p.mediaUrl || null,
        thumbnail_url: p.thumbnailUrl || null,
        published_at: p.publishedAt || null,
        views_count: p.viewsCount ?? null,
        likes_count: p.likesCount ?? null,
        comments_count: p.commentsCount ?? null,
        shares_count: p.sharesCount ?? null,
        duration_seconds: p.durationSeconds ?? null,
        metadata_json: p.metadata || null,
        collected_at: new Date().toISOString(),
        source: 'apify',
        job_id: job.id,
      }
      const { error: upErr } = await sb
        .from('social_posts')
        .upsert(row, { onConflict: 'tenant_id,platform,external_id' })
      if (!upErr) processed++
    }

    await sb
      .from('social_research_jobs')
      .update({
        status: 'completed',
        records_processed: processed,
        completed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', job.id)

    console.log(
      JSON.stringify({
        evt: 'social_research.completed',
        jobId: job.id,
        runId,
        datasetId,
        platform: job.platform,
        jobType: job.job_type,
        records: processed,
        profiles: normalized.profiles.length,
        duracionMs: Date.now() - t0,
      })
    )
    return { ok: true, jobId: job.id, records: processed }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error procesando el dataset'
    await sb
      .from('social_research_jobs')
      .update({ status: 'failed', error_message: msg, completed_at: new Date().toISOString() })
      .eq('id', job.id)
    return { ok: false, error: msg, jobId: job.id }
  }
}
