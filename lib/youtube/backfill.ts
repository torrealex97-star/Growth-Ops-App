import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshOwnMediaUrl, type IgConfig } from '@/lib/instagram/client'
import { isYoutubeConfigured, uploadReelToYoutube, fetchVideoStats } from './client'

type PendingMedia = { caption: string | null; permalink: string | null; media_url: string | null; published_at: string | null }
type PendingRow = { ig_media_external_id: string; ig_media: PendingMedia | null }

// Encola (status='pending') cualquier reel propio que aún no tenga fila en youtube_uploads.
async function enqueuePendingReels(sb: SupabaseClient): Promise<void> {
  const { data: allReels } = await sb
    .from('ig_media')
    .select('external_id')
    .eq('media_product_type', 'REELS')
    .not('media_url', 'is', null)
  const { data: known } = await sb.from('youtube_uploads').select('ig_media_external_id')
  const knownSet = new Set((known ?? []).map((r) => r.ig_media_external_id))
  const toEnqueue = (allReels ?? [])
    .filter((r) => !knownSet.has(r.external_id))
    .map((r) => ({ ig_media_external_id: r.external_id, status: 'pending' }))
  if (toEnqueue.length) await sb.from('youtube_uploads').insert(toEnqueue)
}

async function loadPendingRows(sb: SupabaseClient): Promise<PendingRow[]> {
  const { data: pendingUploads } = await sb.from('youtube_uploads').select('ig_media_external_id').eq('status', 'pending')
  if (!pendingUploads?.length) return []
  const { data: pendingMedia } = await sb
    .from('ig_media')
    .select('external_id, caption, permalink, media_url, published_at')
    .in('external_id', pendingUploads.map((r) => r.ig_media_external_id))
  const mediaByExternalId = new Map((pendingMedia ?? []).map((m) => [m.external_id, m]))
  return pendingUploads.map((r) => ({ ig_media_external_id: r.ig_media_external_id, ig_media: mediaByExternalId.get(r.ig_media_external_id) ?? null }))
}

async function uploadOne(sb: SupabaseClient, cfg: IgConfig, row: PendingRow): Promise<boolean> {
  const media = row.ig_media
  if (!media) return false
  try {
    // media_url de IG expira; la refrescamos justo antes de descargar por si el reel es de hace días.
    const freshUrl = (await refreshOwnMediaUrl(cfg, row.ig_media_external_id)) || media.media_url
    if (!freshUrl) throw new Error('Sin media_url disponible')
    const caption = media.caption || ''
    const title = caption.split('\n')[0]?.slice(0, 90) || 'Nuevo Reel'
    const result = await uploadReelToYoutube(freshUrl, title, `${caption}\n\nOriginal: ${media.permalink ?? ''}`)
    await sb.from('youtube_uploads')
      .update({ youtube_video_id: result.videoId, status: 'uploaded', error: null, updated_at: new Date().toISOString() })
      .eq('ig_media_external_id', row.ig_media_external_id)
    return true
  } catch (err) {
    await sb.from('youtube_uploads')
      .update({ status: 'failed', error: err instanceof Error ? err.message : String(err), updated_at: new Date().toISOString() })
      .eq('ig_media_external_id', row.ig_media_external_id)
    return false
  }
}

// Refresca views/likes/comments de los vídeos ya publicados, para poder mostrarlas en la app.
export async function refreshYoutubeStats(sb: SupabaseClient): Promise<void> {
  if (!isYoutubeConfigured()) return
  try {
    const { data: uploadedRows } = await sb.from('youtube_uploads').select('youtube_video_id').eq('status', 'uploaded').not('youtube_video_id', 'is', null)
    const ids = (uploadedRows ?? []).map((r) => r.youtube_video_id as string)
    if (!ids.length) return
    const stats = await fetchVideoStats(ids)
    const syncedAt = new Date().toISOString()
    for (const s of stats) {
      await sb.from('youtube_uploads')
        .update({ views: s.views, likes: s.likes, comments: s.comments, stats_synced_at: syncedAt })
        .eq('youtube_video_id', s.videoId)
    }
  } catch { /* refresco de métricas opcional */ }
}

// Espeja a YouTube (Shorts) los reels propios de Instagram. Dos flujos independientes:
// - Reels NUEVOS (publicados después de activar la función, marca en app_settings): se suben
//   siempre, sin límite, cada vez que corre el sync de Instagram (cada 6h) — salen a ritmo de
//   ~1/día, así que nunca compiten por cupo.
// - Reels ANTIGUOS (backfill, ya publicados antes de activar la función): se procesan del más
//   reciente al más antiguo, como máximo `backfillLimit` por llamada. Para repartirlos a lo largo
//   del día (mañana/mediodía/noche) en vez de subirlos todos de golpe, se llama con backfillLimit=1
//   desde un cron dedicado programado 3 veces al día (ver /api/${tenant}/evergreen/cron/youtube-backfill).
// Best-effort: un fallo en un reel no tumba el resto; queda marcado 'failed' con su error para
// poder revisarlo sin reintentar los que ya se subieron bien.
export async function runYoutubeSync(sb: SupabaseClient, cfg: IgConfig, opts: { backfillLimit: number }): Promise<number> {
  if (!isYoutubeConfigured()) return 0

  const { data: marker } = await sb.from('app_settings').select('value').eq('key', 'youtube_sync_started_at').single()
  const startedAt = (marker?.value as string) || new Date().toISOString()

  await enqueuePendingReels(sb)
  const rows = await loadPendingRows(sb)
  if (!rows.length) return 0

  const isNew = (r: PendingRow) => (r.ig_media?.published_at ?? '') >= startedAt
  const newOnes = rows.filter(isNew)
  const backfillOnes = rows
    .filter((r) => !isNew(r))
    .sort((a, b) => (b.ig_media?.published_at ?? '').localeCompare(a.ig_media?.published_at ?? '')) // más recientes primero
    .slice(0, Math.max(0, opts.backfillLimit))

  let uploaded = 0
  for (const row of [...newOnes, ...backfillOnes]) {
    if (await uploadOne(sb, cfg, row)) uploaded++
  }

  await refreshYoutubeStats(sb)
  return uploaded
}
