// Adapters de la capa de investigación externa (brief §6).
//
// Cada adapter traduce en las dos direcciones: nuestro input normalizado → input del Actor del
// proveedor, y la salida cruda del dataset → nuestros modelos normalizados (social_profiles /
// social_posts). NO acoplados a un Actor concreto (§5): se apoyan en claves candidatas porque los
// Actors cambian de esquema entre versiones; el JSON crudo queda en social_raw_payloads (§11) y la
// app NUNCA depende del esquema del Actor.
//
// Fichero sin imports de runtime a propósito: lógica pura, testeable directo desde los tests.

import type {
  NormalizedPost,
  NormalizedProfile,
  NormalizedResult,
  ResearchInput,
  SocialJobType,
  SocialPlatform,
} from './types'

type FilaJson = Record<string, unknown>

const num = (v: unknown): number | undefined => {
  if (v == null) return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  // '12.345' con formato de miles europeo es 12345, no 12.345. Los Actors devuelven números,
  // pero algunos campos llegan como string con separadores: se desambigua antes de parsear.
  const s = String(v).trim().replace(/\s/g, '')
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''))
  const n = Number(s.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : undefined
}
const str = (v: unknown): string | undefined => {
  if (v == null || v === '') return undefined
  return String(v)
}

/** Lee la primera clave candidata de un objeto; acepta rutas punteadas ('author.uniqueId'). */
export function firstOf(o: FilaJson, keys: string[]): unknown {
  for (const k of keys) {
    let v: unknown = o
    for (const part of k.split('.')) {
      if (v && typeof v === 'object') v = (v as FilaJson)[part]
      else {
        v = undefined
        break
      }
    }
    if (v != null && v !== '') return v
  }
  return undefined
}

export type ActorAdapter = {
  /** Nuestro input normalizado → input del Actor. */
  buildInput: (input: ResearchInput, resultsLimit: number) => FilaJson
  /** Salida cruda del dataset → filas normalizadas. Tolerante a claves que cambian. */
  normalize: (items: FilaJson[], usernames: string[]) => NormalizedResult
}

/** Registra un perfil de los normalizados sin duplicar username (los datasets repiten autor). */
function pushProfileOnce(
  profiles: NormalizedProfile[],
  seen: Set<string>,
  username: string,
  extra?: Partial<NormalizedProfile>
) {
  const clean = username.replace(/^@/, '').trim()
  if (!clean || seen.has(clean.toLowerCase())) return
  seen.add(clean.toLowerCase())
  profiles.push({ username: clean, ...extra })
}

/**
 * Perfil: normalización tolerante a envoltorios habituales ({ profile: … }, { user: … }) y a filas
 * de error del Actor. Algunos Actors traen además latestPosts: se normalizan si vienen.
 */
export const InstagramProfileAdapter: ActorAdapter = {
  buildInput: (input, resultsLimit) => ({ usernames: input.usernames, resultsLimit }),
  normalize: (items) => {
    const profiles: NormalizedProfile[] = []
    const posts: NormalizedPost[] = []
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const row = it as FilaJson
      if (row.error && !row.username && !row.id) continue
      const inner = (row.profile as FilaJson) || (row.user as FilaJson) || row
      const username = str(firstOf(inner, ['username', 'handle', 'user', 'ownerUsername']))
      if (!username) continue
      const clean = username.replace(/^@/, '')
      profiles.push({
        username: clean,
        externalId: str(firstOf(inner, ['id', 'userId', 'profileId'])),
        displayName: str(firstOf(inner, ['fullName', 'name', 'displayName', 'title'])),
        biography: str(firstOf(inner, ['biography', 'bio', 'description'])),
        profileUrl: str(firstOf(inner, ['url', 'profileUrl'])) || `https://www.instagram.com/${clean}/`,
        avatarUrl: str(firstOf(inner, ['profilePicUrl', 'profilePicture', 'avatar', 'imageUrl'])),
        followersCount: num(firstOf(inner, ['followersCount', 'followers', 'followerCount'])),
        followingCount: num(firstOf(inner, ['followingCount', 'followsCount', 'following'])),
        postsCount: num(firstOf(inner, ['postsCount', 'mediaCount', 'posts'])),
        verified: Boolean(firstOf(inner, ['verified', 'isVerified'])) || undefined,
        metadata: inner,
      })
      // Algunos Actors de perfil traen además los últimos posts: se normalizan si vienen,
      // estén en la fila raíz o dentro del envoltorio ({ user: { latestPosts: … } }).
      const latest =
        (inner.latestPosts as FilaJson[]) ||
        (inner.posts as FilaJson[]) ||
        (row.latestPosts as FilaJson[]) ||
        (row.posts as FilaJson[]) ||
        []
      for (const p of latest) {
        const post = InstagramReelsAdapter.normalize([p], [clean]).posts[0]
        if (post) posts.push(post)
      }
    }
    return { profiles, posts }
  },
}

export const InstagramReelsAdapter: ActorAdapter = {
  buildInput: (input, resultsLimit) => ({ usernames: input.usernames, resultsLimit }),
  normalize: (items, usernames) => {
    const posts: NormalizedPost[] = []
    const profiles: NormalizedProfile[] = []
    const seen = new Set<string>()
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const row = it as FilaJson
      const username = (str(firstOf(row, ['ownerUsername', 'username', 'owner'])) || usernames[0] || '').replace(
        /^@/,
        ''
      )
      const shortcode = str(firstOf(row, ['shortCode', 'shortcode', 'id']))
      if (!shortcode) continue
      posts.push({
        externalId: shortcode,
        username: username || undefined,
        contentType: str(firstOf(row, ['type', 'mediaType', 'productType'])) || 'reel',
        caption: str(firstOf(row, ['caption', 'text', 'description'])),
        postUrl:
          str(firstOf(row, ['url', 'postUrl'])) ||
          (username ? `https://www.instagram.com/reel/${shortcode}/` : undefined),
        mediaUrl: str(firstOf(row, ['videoUrl', 'mediaUrl', 'displayUrl'])),
        thumbnailUrl: str(firstOf(row, ['thumbnailUrl', 'displayUrl', 'coverUrl'])),
        publishedAt: str(firstOf(row, ['timestamp', 'publishedAt', 'takenAt'])) || undefined,
        viewsCount: num(firstOf(row, ['videoViewCount', 'viewCount', 'playCount', 'views'])),
        likesCount: num(firstOf(row, ['likesCount', 'likes', 'likeCount'])),
        commentsCount: num(firstOf(row, ['commentsCount', 'comments', 'commentCount'])),
        sharesCount: num(firstOf(row, ['videoShareCount', 'shareCount', 'shares'])),
        durationSeconds: num(firstOf(row, ['videoDuration', 'duration', 'durationSeconds'])),
        metadata: row,
      })
      pushProfileOnce(profiles, seen, username)
    }
    return { profiles, posts }
  },
}

export const TikTokAdapter: ActorAdapter = {
  buildInput: (input, resultsLimit) => ({ profiles: input.usernames, resultsPerPage: resultsLimit }),
  normalize: (items, usernames) => {
    const posts: NormalizedPost[] = []
    const profiles: NormalizedProfile[] = []
    const seen = new Set<string>()
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const row = it as FilaJson
      const author = (row.author as FilaJson) || {}
      const username = (
        str(firstOf(row, ['authorMeta.name', 'author.uniqueId'])) ||
        str(author.uniqueId) ||
        usernames[0] ||
        ''
      ).replace(/^@/, '')
      const id = str(firstOf(row, ['id', 'videoId', 'awemeId']))
      if (!id) continue
      posts.push({
        externalId: id,
        username: username || undefined,
        contentType: 'video',
        caption: str(firstOf(row, ['text', 'description', 'caption'])),
        postUrl: str(firstOf(row, ['webVideoUrl', 'url'])) || undefined,
        mediaUrl: str(firstOf(row, ['videoUrl', 'playUrl'])) || undefined,
        thumbnailUrl: str(firstOf(row, ['coverUrl', 'thumbnail'])) || undefined,
        publishedAt: str(firstOf(row, ['createTimeISO', 'createTime'])) || undefined,
        viewsCount: num(firstOf(row, ['playCount', 'views'])),
        likesCount: num(firstOf(row, ['diggCount', 'likes'])),
        commentsCount: num(firstOf(row, ['commentCount', 'comments'])),
        sharesCount: num(firstOf(row, ['shareCount', 'shares'])),
        durationSeconds: num(firstOf(row, ['video.duration', 'duration'])),
        metadata: row,
      })
      pushProfileOnce(profiles, seen, username)
    }
    return { profiles, posts }
  },
}

export const YouTubeAdapter: ActorAdapter = {
  buildInput: (input, resultsLimit) => ({ channels: input.usernames, maxResults: resultsLimit }),
  normalize: (items, usernames) => {
    const posts: NormalizedPost[] = []
    const profiles: NormalizedProfile[] = []
    const seen = new Set<string>()
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const row = it as FilaJson
      const id = str(firstOf(row, ['id', 'videoId']))
      if (!id) continue
      const channel = (row.channel as FilaJson) || (row.author as FilaJson) || {}
      const username = (
        str(firstOf(row, ['channel.handle', 'author.handle'])) ||
        str(channel.handle) ||
        usernames[0] ||
        ''
      ).replace(/^@/, '')
      posts.push({
        externalId: id,
        username: username || undefined,
        contentType: 'video',
        caption: str(firstOf(row, ['title', 'text'])),
        postUrl: str(firstOf(row, ['url'])) || `https://www.youtube.com/watch?v=${id}`,
        thumbnailUrl: str(firstOf(row, ['thumbnail', 'image'])) || undefined,
        publishedAt: str(firstOf(row, ['publishedAt', 'dateText'])) || undefined,
        viewsCount: num(firstOf(row, ['viewCount', 'views'])),
        likesCount: num(firstOf(row, ['likeCount', 'likes'])),
        commentsCount: num(firstOf(row, ['commentCount', 'commentsCount'])),
        durationSeconds: num(firstOf(row, ['durationSeconds', 'duration'])),
        metadata: row,
      })
      pushProfileOnce(profiles, seen, username)
    }
    return { profiles, posts }
  },
}

/** Adapter por plataforma/tipo — punto único para añadir plataformas y tipos nuevos. */
export function adapterFor(platform: SocialPlatform, jobType: SocialJobType): ActorAdapter | null {
  if (platform === 'instagram') {
    if (jobType === 'reels') return InstagramReelsAdapter
    return InstagramProfileAdapter
  }
  if (platform === 'tiktok') return TikTokAdapter
  if (platform === 'youtube') return YouTubeAdapter
  return null
}
