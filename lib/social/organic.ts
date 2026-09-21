// CAPA ORGÁNICA — MÉTRICAS OFICIALES de las cuentas del negocio.
//
// Principio (brief del 21-sep): las métricas de las cuentas PROPIAS se traen por las APIs
// OFICIALES de cada plataforma (Instagram Graph API aquí; TikTok/YouTube por su sync oficial
// cuando exista). Apify queda para lo que puede costar baneos: investigación de TERCEROS.
// Cero llamadas a Apify en este camino: es puro Supabase sobre los datos que el sync oficial
// ya guardó (ig_media / ig_account_daily, poblados por lib/instagram/sync.ts → Graph API con
// appsecret_proof). El dashboard NUNCA llama ni a Apify ni a Meta por render (§16).
//
// Métricas oficiales que el público no da: reach real, impresiones, shares, saved y watch time.

export type FilaPerfilOficial = {
  platform: string
  username?: string | null
  followers_count?: number | null
  posts_count?: number | null
  collected_at?: string | null
}

export type FilaPostOficial = {
  media_type?: string | null
  published_at?: string | null
  likes?: number | null
  comments?: number | null
  views?: number | null
  reach?: number | null
  shares?: number | null
  saved?: number | null
  engagement_rate?: number | null
  permalink?: string | null
  synced_at?: string | null
}

export type FilaSnapshotsOficial = {
  snapshot_date: string
  followers_count?: number | null
  reach?: number | null
  profile_views?: number | null
  new_follows?: number | null
  unfollows?: number | null
}

export type ResumenOficial = {
  platform: 'instagram'
  handle?: string
  followers?: number
  postsCount?: number
  lastSyncedAt?: string
  postsPeriodo: number
  likesPeriodo: number
  commentsPeriodo: number
  viewsPeriodo?: number
  reachPeriodo?: number
  sharesPeriodo?: number
  savedPeriodo?: number
  engagementRate?: number
  engagementFormula: string
  topContenidos: { url?: string; views?: number; likes?: number }[]
}

const suma = (xs: (number | null | undefined)[]) =>
  xs.reduce<number>((a, x) => a + (typeof x === 'number' && Number.isFinite(x) ? x : 0), 0)

const enRango = (iso: string | null | undefined, r: { desde?: string; hasta?: string }) => {
  if (!iso) return false
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return false
  if (r.desde && t < Date.parse(r.desde)) return false
  if (r.hasta && t > Date.parse(r.hasta)) return false
  return true
}

/**
 * Resumen de la cuenta PROPIA de Instagram desde los datos OFICIALES ya sincronizados.
 * Engagement = interacciones / reach (métrica oficial de Graph API, no estimación pública).
 */
export function agregarOrganicoOficial(
  perfil: FilaPerfilOficial | null | undefined,
  medias: FilaPostOficial[],
  snapshots: FilaSnapshotsOficial[],
  rango: { desde?: string; hasta?: string } = {}
): ResumenOficial | null {
  if (!perfil) return null
  const delPeriodo = medias.filter((m) => enRango(m.published_at, rango))
  const likes = suma(delPeriodo.map((m) => m.likes))
  const comments = suma(delPeriodo.map((m) => m.comments))
  const shares = suma(delPeriodo.map((m) => m.shares))
  const saved = suma(delPeriodo.map((m) => m.saved))
  const views = suma(delPeriodo.map((m) => m.views))
  const reach = suma(delPeriodo.map((m) => m.reach))
  const snap = [...snapshots].sort((a, b) => (a.snapshot_date < b.snapshot_date ? 1 : -1))[0]
  const lastSyncedAt =
    medias
      .map((m) => m.synced_at)
      .filter(Boolean)
      .sort()
      .at(-1) || undefined
  // reach por media se solapa entre posts; el reach de CUENTA del snapshot diario es el válido.
  const reachCuenta = typeof snap?.reach === 'number' ? snap.reach : undefined
  const base = reachCuenta ?? (views > 0 ? views : undefined)
  // Con 0 posts del periodo el engagement no es calculable: no se divide nada entre nada.
  const engagementRate =
    delPeriodo.length > 0 && base && base > 0 ? (likes + comments + shares + saved) / base : undefined
  return {
    platform: 'instagram',
    handle: perfil.username || undefined,
    followers: perfil.followers_count ?? snap?.followers_count ?? undefined,
    postsCount: perfil.posts_count ?? undefined,
    lastSyncedAt,
    postsPeriodo: delPeriodo.length,
    likesPeriodo: likes,
    commentsPeriodo: comments,
    viewsPeriodo: views > 0 ? views : undefined,
    reachPeriodo: reachCuenta,
    sharesPeriodo: shares > 0 ? shares : undefined,
    savedPeriodo: saved > 0 ? saved : undefined,
    engagementRate,
    engagementFormula: 'interacciones / reach (Graph API)',
    topContenidos: delPeriodo
      .map((m) => ({ url: m.permalink || undefined, views: m.views ?? 0, likes: m.likes ?? 0 }))
      .sort((a, b) => b.views - a.views || b.likes - a.likes)
      .slice(0, 3),
  }
}
