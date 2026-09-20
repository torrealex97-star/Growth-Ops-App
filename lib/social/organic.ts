// CAPA SEMÁNTICA ORGÁNICA — prototipo de la capa de adquisición orgánica del dashboard.
//
// QUÉ ES: agregación PURA de social_profiles/social_posts (datos ya normalizados por la capa
// de investigación externa) en KPIs por plataforma. La UI consume esto; NUNCA llama a Apify por
// pantalla (§16 del brief de captación: external APIs → sync → datos normalizados → dashboard).
//
// QUÉ NO ES: atribución publicitaria. Esto describe la realidad operacional del CONTENIDO de las
// cuentas del negocio (seguidores, publicaciones, engagement) con datos PÚBLICOS traídos por un
// proveedor externo (Apify). La cuenta conectada no participa (§1/§16-17): al Actor solo van
// handles públicos, nunca credenciales. Cada número declara su fuente en la UI.
//
// HONESTIDAD (§15): solo se muestran métricas que el dato público da. Instagram público no da
// alcance/impresiones (eso vive en la API oficial, en "Mi cuenta"); TikTok público da views por
// vídeo. El engagement se calcula con lo disponible y se etiqueta cómo se calculó.

import type { SocialPlatform } from './types'

export type FilaPerfil = {
  platform: string
  username?: string
  followers_count?: number | null
  posts_count?: number | null
  collected_at?: string | null
}

export type FilaPost = {
  platform: string
  username?: string | null
  content_type?: string | null
  published_at?: string | null
  views_count?: number | null
  likes_count?: number | null
  comments_count?: number | null
  shares_count?: number | null
  collected_at?: string | null
  post_url?: string | null
}

export type OrganicoPlataforma = {
  platform: SocialPlatform
  handle?: string
  /** Snapshot del perfil (última recolección). */
  followers?: number
  postsCount?: number
  lastCollectedAt?: string
  /** Actividad del perfil DENTRO del periodo seleccionado. */
  postsPeriodo: number
  likesPeriodo: number
  commentsPeriodo: number
  sharesPeriodo?: number
  viewsPeriodo?: number
  /** Cómo se calculó el engagement — la UI lo muestra junto al número (§15). */
  engagementRate?: number
  engagementFormula?: 'likes+comments / views' | 'likes+comments / followers'
  /** Top 3 contenidos del periodo por views (o likes si no hay views). */
  topContenidos: { url?: string; views?: number; likes?: number }[]
}

export type RangoOrganico = { desde?: string; hasta?: string }

const DENTRO = (iso: string | null | undefined, r: RangoOrganico): boolean => {
  if (!iso) return false
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return false
  if (r.desde && t < Date.parse(r.desde)) return false
  if (r.hasta && t > Date.parse(r.hasta)) return false
  return true
}

const ratio = (a: number, b: number): number | undefined => (b > 0 ? a / b : undefined)

/**
 * Agrega los filas normalizados en un resumen por plataforma. Solo plataformas con perfil
 * snapshot aparecen; sin filas no se inventan ceros (§15: nada de falsas métricas).
 */
export function agregarOrganico(
  perfiles: FilaPerfil[],
  posts: FilaPost[],
  rango: RangoOrganico = {}
): OrganicoPlataforma[] {
  const porPlataforma = new Map<SocialPlatform, OrganicoPlataforma>()

  // Perfil: el snapshot más reciente por plataforma (collected_at máx).
  for (const p of perfiles) {
    const platform = p.platform as SocialPlatform
    if (!porPlataforma.has(platform) && !['instagram', 'tiktok', 'youtube'].includes(platform)) continue
    const actual = porPlataforma.get(platform)
    const collected = p.collected_at || ''
    if (actual?.lastCollectedAt && actual.lastCollectedAt >= collected) continue
    porPlataforma.set(platform, {
      platform,
      handle: p.username,
      followers: p.followers_count ?? undefined,
      postsCount: p.posts_count ?? undefined,
      lastCollectedAt: p.collected_at || undefined,
      postsPeriodo: 0,
      likesPeriodo: 0,
      commentsPeriodo: 0,
      topContenidos: [],
    })
  }

  // Posts del periodo: se suman por plataforma y se guardan los top por views/likes.
  for (const post of posts) {
    const platform = post.platform as SocialPlatform
    const resumen = porPlataforma.get(platform)
    if (!resumen) continue
    if (!DENTRO(post.published_at, rango)) continue
    resumen.postsPeriodo += 1
    resumen.likesPeriodo += post.likes_count ?? 0
    resumen.commentsPeriodo += post.comments_count ?? 0
    if (post.views_count != null) resumen.viewsPeriodo = (resumen.viewsPeriodo ?? 0) + post.views_count
    if (post.shares_count != null) resumen.sharesPeriodo = (resumen.sharesPeriodo ?? 0) + post.shares_count
    resumen.topContenidos.push({
      url: post.post_url || undefined,
      views: post.views_count ?? undefined,
      likes: post.likes_count ?? undefined,
    })
  }

  const resultado: OrganicoPlataforma[] = []
  for (const resumen of porPlataforma.values()) {
    resumen.topContenidos.sort((a, b) => (b.views ?? b.likes ?? 0) - (a.views ?? a.likes ?? 0))
    resumen.topContenidos = resumen.topContenidos.slice(0, 3)
    const interacciones = resumen.likesPeriodo + resumen.commentsPeriodo
    if (resumen.viewsPeriodo) {
      // TikTok: las views públicas permiten engagement sobre alcance real.
      resumen.engagementRate = ratio(interacciones, resumen.viewsPeriodo)
      resumen.engagementFormula = 'likes+comments / views'
    } else if (resumen.followers) {
      // Instagram público no da impresiones: engagement sobre seguidores (convención del sector).
      resumen.engagementRate = ratio(interacciones, resumen.followers)
      resumen.engagementFormula = 'likes+comments / followers'
    }
    resultado.push(resumen)
  }
  return resultado.sort((a, b) => a.platform.localeCompare(b.platform))
}
