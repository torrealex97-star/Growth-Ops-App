import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getInstagramConfig,
  resolveIgUserId,
  fetchIgProfile,
  fetchIgMedia,
  fetchMediaInsights,
  fetchAccountInsights,
  fetchFollowerDemographics,
  resolveFbPageId,
  getPageAccessToken,
  fetchFacebookReels,
  fetchConversationStats,
  refreshOwnMediaUrl,
  type IgConfig,
} from './client'
import { runYoutubeSync } from '@/lib/youtube/backfill'

const today = (): string => new Date().toISOString().slice(0, 10)
const round2 = (n: number) => Math.round(n * 100) / 100

export type InstagramSyncResult = {
  ok: true
  igUserId: string
  username?: string
  followers: number
  mediaSynced: number
  demographicsRows: number
  fbReelsSynced: number
  conversations: number | null
  youtubeUploaded: number
  at: string
}

// Núcleo de la sincronización orgánica de Instagram. Lo usan el botón manual
// (/api/${tenant}/evergreen/instagram/sync) y el cron diario (/api/${tenant}/evergreen/cron/instagram).
// Requiere Supabase con service-role (salta RLS). No toca transcript/ai_analysis:
// esos los rellena la transcripción bajo demanda, así que re-sincronizar NO los borra.
export async function runInstagramSync(
  sb: SupabaseClient,
  tenantId: string,
  opts?: { mediaLimit?: number; light?: boolean }
): Promise<InstagramSyncResult> {
  const cfg = getInstagramConfig()
  if (!cfg) {
    throw new Error(
      'Faltan credenciales de Instagram. Configura INSTAGRAM_ACCESS_TOKEN (o META_ACCESS_TOKEN) en Vercel.'
    )
  }

  const { id: igUserId } = await resolveIgUserId(cfg)
  const at = new Date().toISOString()
  const mediaLimit = opts?.mediaLimit ?? 100

  // 1) Perfil + insights de cuenta → snapshot diario (crecimiento)
  const [profile, acc] = await Promise.all([fetchIgProfile(cfg, igUserId), fetchAccountInsights(cfg, igUserId)])

  await sb.from('ig_account_daily').upsert(
    {
      tenant_id: tenantId,
      snapshot_date: today(),
      followers_count: profile.followers_count,
      media_count: profile.media_count,
      reach: acc.reach,
      profile_views: acc.profile_views,
      new_follows: acc.new_follows,
      unfollows: acc.unfollows,
      reach_followers: acc.reach_followers,
      reach_non_followers: acc.reach_non_followers,
      synced_at: at,
    },
    // NOTA: el índice único original es solo (snapshot_date), global. Con varias
    // subcuentas sincronizando Instagram el mismo día colisionarían entre sí.
    // Ver migración supabase/migrations/20260911160000_fix_cron_unique_constraints.sql
    // (pendiente de aplicar) que lo sustituye por (tenant_id, snapshot_date).
    { onConflict: 'tenant_id,snapshot_date', ignoreDuplicates: false }
  )

  // 2) Demografía de la audiencia (país/ciudad/edad/género) → snapshot vigente
  let demographicsRows = 0
  try {
    const demo = await fetchFollowerDemographics(cfg, igUserId)
    if (demo.length) {
      const rows = demo.map((d) => ({
        tenant_id: tenantId,
        dimension: d.dimension,
        bucket: d.bucket,
        value: d.value,
        captured_at: at,
      }))
      // NOTA: mismo caso que ig_account_daily — el índice único original era (dimension, bucket)
      // global; ver la migración pendiente que lo cambia a (tenant_id, dimension, bucket).
      await sb.from('ig_audience').upsert(rows, { onConflict: 'tenant_id,dimension,bucket', ignoreDuplicates: false })
      demographicsRows = rows.length
    }
  } catch {
    /* demografía requiere >=100 seguidores; si falla, seguimos */
  }

  // 3) Medias (reels + posts) con sus insights. Upsert por external_id SIN tocar
  //    las columnas de transcripción/IA (no van en el payload → se conservan).
  const medias = await fetchIgMedia(cfg, igUserId, mediaLimit)
  let mediaSynced = 0
  for (const m of medias) {
    let ins
    try {
      ins = await fetchMediaInsights(cfg, m)
    } catch {
      continue // un media que no da insights no rompe el resto
    }
    const engagement = ins.reach > 0 ? round2((ins.total_interactions / ins.reach) * 100) : 0
    const row = {
      tenant_id: tenantId,
      external_id: m.id,
      media_type: m.media_type ?? null,
      media_product_type: m.media_product_type ?? null,
      caption: m.caption ?? null,
      permalink: m.permalink ?? null,
      thumbnail_url: m.thumbnail_url ?? null,
      media_url: m.media_url ?? null,
      published_at: m.timestamp ?? null,
      reach: ins.reach,
      views: ins.views,
      likes: ins.likes,
      comments: ins.comments,
      shares: ins.shares,
      saved: ins.saved,
      total_interactions: ins.total_interactions,
      avg_watch_time: ins.avg_watch_time,
      reach_followers: ins.reach_followers,
      reach_non_followers: ins.reach_non_followers,
      follows: ins.follows,
      engagement_rate: engagement,
      synced_at: at,
    }
    const { error } = await sb.from('ig_media').upsert(row, { onConflict: 'external_id', ignoreDuplicates: false })
    if (!error) mediaSynced++
  }

  // 4) Facebook: reels cross-posteados a la página vinculada (métricas propias de FB)
  //    y conversaciones (DMs) del día. Todo best-effort: si la página no resuelve o
  //    no hay page token, seguimos sin romper el sync de Instagram.
  let fbReelsSynced = 0
  let conversations: number | null = null
  try {
    const pageId = await resolveFbPageId(cfg, igUserId)
    if (pageId) {
      const pat = await getPageAccessToken(cfg, pageId)
      if (pat) {
        // Reels de FB. En modo light no pedimos likes/comments por reel (más
        // rápido) y no pisamos los valores ya guardados por el backfill.
        try {
          const reels = await fetchFacebookReels(cfg, pageId, pat, opts?.mediaLimit ?? 40, !opts?.light)
          for (const r of reels) {
            const row: Record<string, unknown> = {
              tenant_id: tenantId,
              external_id: r.external_id,
              description: r.description ?? null,
              permalink: r.permalink ?? null,
              created_time: r.created_time ?? null,
              views: r.views,
              synced_at: at,
            }
            if (!opts?.light) {
              row.likes = r.likes
              row.comments = r.comments
            }
            const { error } = await sb
              .from('fb_media')
              .upsert(row, { onConflict: 'external_id', ignoreDuplicates: false })
            if (!error) fbReelsSynced++
          }
        } catch {
          /* reels de FB no disponibles */
        }

        // Conversaciones (DMs) — snapshot del día. Requiere ACCESO AVANZADO a
        // instagram_manage_messages (App Review): con acceso estándar, una cuenta
        // con muchos DMs da timeout/error #1. Gate por env hasta tener el permiso.
        if (process.env.IG_ENABLE_DM_SYNC === '1')
          try {
            const stats = await fetchConversationStats(cfg, pageId, pat)
            await sb.from('ig_conversations_daily').upsert(
              {
                tenant_id: tenantId,
                snapshot_date: today(),
                total_conversations: stats.total_conversations,
                unread_conversations: stats.unread_conversations,
                total_messages: stats.total_messages,
                unique_people: stats.unique_people,
                synced_at: at,
              },
              // NOTA: mismo caso que ig_account_daily — ver migración pendiente que cambia el
              // índice único de (snapshot_date) a (tenant_id, snapshot_date).
              { onConflict: 'tenant_id,snapshot_date', ignoreDuplicates: false }
            )
            conversations = stats.total_conversations
          } catch {
            /* conversaciones no disponibles */
          }
      }
    }
  } catch {
    /* FB/conversaciones opcional */
  }

  // 5) Espejo a YouTube de los reels propios nuevos (opcional, solo si hay credenciales configuradas).
  let youtubeUploaded = 0
  try {
    // Solo reels nuevos aquí (backfillLimit 0): el backfill de reels antiguos va por su propio
    // cron 3 veces al día (mañana/mediodía/noche), ver /api/${tenant}/evergreen/cron/youtube-backfill.
    youtubeUploaded = await runYoutubeSync(sb, cfg, tenantId, { backfillLimit: 0 })
  } catch {
    /* YouTube opcional: un fallo aquí no debe romper el sync de Instagram */
  }

  return {
    ok: true,
    igUserId,
    username: profile.username,
    followers: profile.followers_count,
    mediaSynced,
    demographicsRows,
    fbReelsSynced,
    conversations,
    youtubeUploaded,
    at,
  }
}
