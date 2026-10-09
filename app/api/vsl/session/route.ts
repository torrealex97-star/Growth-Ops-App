import { NextResponse } from 'next/server'
import { sql } from '@/lib/vsl/db'
import { MinuteRateLimiter } from '@/lib/tracking/ingest'
import { resolvePublicVsl } from '@/lib/vsl/public-video'

export const dynamic = 'force-dynamic'

// Rate limit (auditoría §riesgos): la ruta es pública y crea filas; el limitador por proceso
// (el mismo del pixel) frena inflado de impresiones sin infraestructura nueva.
const limiter = new MinuteRateLimiter()

function detectDevice(ua: string): string {
  const s = (ua || '').toLowerCase()
  if (/ipad|tablet|playbook|silk/.test(s)) return 'tablet'
  if (/mobi|android|iphone|ipod/.test(s)) return 'mobile'
  return 'desktop'
}

// Crea (o recupera) la sesión de visionado para un anon_id + vídeo.
export async function POST(req: Request) {
  try {
    const { slug, tenant, anonId, referrer } = await req.json()
    if (!slug || !anonId) {
      return NextResponse.json({ error: 'slug y anonId requeridos' }, { status: 400 })
    }
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconocida'
    if (!limiter.allow(`vsl-session:${ip}`, 60)) {
      return NextResponse.json({ error: 'Demasiadas peticiones' }, { status: 429 })
    }

    const ua = req.headers.get('user-agent') || ''
    const country = req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || null
    const device = detectDevice(ua)

    const resolution = await resolvePublicVsl(slug, typeof tenant === 'string' ? tenant : null)
    if (resolution.status === 'ambiguous') {
      return NextResponse.json({ error: 'El embed debe indicar la subcuenta' }, { status: 409 })
    }
    if (resolution.status === 'not_found') {
      return NextResponse.json({ error: 'Vídeo no encontrado' }, { status: 404 })
    }
    const { video } = resolution
    const provider = video.source_url?.includes('.b-cdn.net/') ? 'bunny' : 'external'

    const result = await sql.begin(async (tx) => {
      const [row] = await tx`
        INSERT INTO vsl_sessions (video_id, anon_id, referrer, device, country, user_agent)
        VALUES (${video.id}, ${anonId}, ${referrer || null}, ${device}, ${country}, ${ua})
        ON CONFLICT (video_id, anon_id)
        DO UPDATE SET updated_at = now(), referrer = COALESCE(vsl_sessions.referrer, EXCLUDED.referrer)
        RETURNING id, tenant_id
      `

      // Serializa el alta/cambio de versión por vídeo. Un source_url nuevo cierra la versión
      // anterior; conocer más tarde la duración solo completa la versión activa.
      await tx`SELECT id FROM vsl_videos WHERE id = ${video.id} AND tenant_id = ${row.tenant_id} FOR UPDATE`
      const [activeVersion] = await tx`
        SELECT id, source_url
        FROM vsl_video_versions
        WHERE tenant_id = ${row.tenant_id} AND video_id = ${video.id} AND replaced_at IS NULL
        ORDER BY version_number DESC LIMIT 1
      `
      let version: { id: string } | null = activeVersion ? { id: String(activeVersion.id) } : null
      if (activeVersion && activeVersion.source_url !== video.source_url) {
        await tx`
          UPDATE vsl_video_versions SET replaced_at = now()
          WHERE tenant_id = ${row.tenant_id} AND id = ${activeVersion.id}
        `
        version = null
      }
      if (!version) {
        const insertedVersions = await tx`
          INSERT INTO vsl_video_versions (
            tenant_id, video_id, version_number, provider, source_url, duration_seconds
          )
          SELECT ${row.tenant_id}, ${video.id}, COALESCE(max(version_number), 0) + 1,
                 ${provider}, ${video.source_url}, ${Number(video.duration_seconds) || 0}
          FROM vsl_video_versions
          WHERE tenant_id = ${row.tenant_id} AND video_id = ${video.id}
          RETURNING id
        `
        const insertedVersion = insertedVersions[0]
        if (!insertedVersion) throw new Error('No se pudo crear la versión VSL')
        version = { id: String(insertedVersion.id) }
      } else {
        await tx`
          UPDATE vsl_video_versions
          SET duration_seconds = GREATEST(duration_seconds, ${Number(video.duration_seconds) || 0})
          WHERE tenant_id = ${row.tenant_id} AND id = ${version.id}
        `
      }
      if (!version) throw new Error('No se pudo resolver la versión VSL')

      // playback_id sí es nuevo en cada carga para no mezclar replays del mismo visitante.
      const [playback] = await tx`
        INSERT INTO vsl_playback_sessions (
          tenant_id, video_id, video_version_id, legacy_session_id, viewer_id, started_at, last_event_at
        ) VALUES (
          ${row.tenant_id}, ${video.id}, ${version.id}, ${row.id}, ${anonId}, now(), now()
        )
        RETURNING playback_id
      `
      await tx`
        INSERT INTO vsl_tracking_events (
          tenant_id, playback_id, event_id, event_type, occurred_at, visibility_state
        ) VALUES (
          ${row.tenant_id}, ${playback.playback_id}, ${`impression:${playback.playback_id}`},
          'player_impression', now(), 'visible'
        )
        ON CONFLICT (tenant_id, event_id) DO NOTHING
      `
      return { sessionId: row.id, playbackId: playback.playback_id }
    })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[vsl/session]', e)
    return NextResponse.json({ error: 'Error al crear sesión' }, { status: 500 })
  }
}
