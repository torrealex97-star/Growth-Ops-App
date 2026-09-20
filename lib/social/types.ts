// Modelo de la capa de INVESTIGACIÓN EXTERNA (brief §19, §10, §6).
//
// Separación estricta con la cuenta propia (§1, §16): esto NUNCA toca la cuenta de Instagram
// conectada (esa va solo por la API oficial de Meta en lib/instagram/*). Aquí viven perfiles y
// contenido PÚBLICO de terceros traídos por un proveedor externo (hoy Apify).
//
// Multicanal desde el día 1: Instagram hoy, TikTok/YouTube con la misma abstracción.

export const SOCIAL_PLATFORMS = ['instagram', 'tiktok', 'youtube'] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export const SOCIAL_JOB_TYPES = ['profile', 'reels', 'posts', 'videos'] as const
export type SocialJobType = (typeof SOCIAL_JOB_TYPES)[number]

export type SocialJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'aborted'

export function isSocialPlatform(v: unknown): v is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(String(v))
}

export function isSocialJobType(v: unknown): v is SocialJobType {
  return (SOCIAL_JOB_TYPES as readonly string[]).includes(String(v))
}

/** Límite configurable del tenant; acotado siempre por los topes internos (§24). */
export const RESEARCH_LIMITS = {
  maxResultsPerProfile: 100,
  defaultResultsPerProfile: 30,
  maxProfilesPerRun: 10,
  maxConcurrentJobs: 2,
  requestTimeoutMs: 20_000,
  maxRetries: 2,
} as const

/** Input normalizado NUESTRO — independiente del proveedor y del Actor (§6). */
export type ResearchInput = {
  usernames: string[]
  resultsLimit: number
  jobType: SocialJobType
}

/** Filas normalizadas que produce un adapter — el formato de `social_profiles`/`social_posts`. */
export type NormalizedProfile = {
  username: string
  externalId?: string
  displayName?: string
  profileUrl?: string
  avatarUrl?: string
  followersCount?: number
  followingCount?: number
  postsCount?: number
  verified?: boolean
  biography?: string
  metadata?: Record<string, unknown>
}

export type NormalizedPost = {
  externalId: string
  username?: string
  contentType?: string
  caption?: string
  postUrl?: string
  mediaUrl?: string
  thumbnailUrl?: string
  publishedAt?: string
  viewsCount?: number
  likesCount?: number
  commentsCount?: number
  sharesCount?: number
  durationSeconds?: number
  metadata?: Record<string, unknown>
}

export type NormalizedResult = {
  profiles: NormalizedProfile[]
  posts: NormalizedPost[]
}

export type NormalizedEnv = {
  APIFY_API_TOKEN?: string
  APIFY_INSTAGRAM_REELS_ACTOR_ID?: string
  APIFY_INSTAGRAM_PROFILE_ACTOR_ID?: string
  APIFY_TIKTOK_ACTOR_ID?: string
  APIFY_YOUTUBE_ACTOR_ID?: string
  APIFY_RESULTS_LIMIT?: string
  APIFY_MAX_PROFILES_PER_RUN?: string
}

export const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
}

/** Origen visible del dato en la UI (§16): el usuario siempre sabe de dónde viene. */
export const SOURCE_LABEL = {
  official: 'Fuente: API oficial',
  external: 'Fuente: investigación externa',
} as const
