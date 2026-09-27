import { NextResponse } from 'next/server'
import { sql } from '@/lib/vsl/db'
import { requirePantalla } from '@/lib/auth/requirePantalla'

export const dynamic = 'force-dynamic'

// RESUMEN VSL DE LA SUBCUENTA — los KPIs agregados de todos los vídeos, para el dashboard de
// VSL (y consumibles por otros paneles de marketing). Misma protección que las métricas por
// vídeo: `postgres` directo se salta RLS, así que el filtro tenant_id explícito es la barrera.
// Es SOLO lectura y ligera (una pasada por agregados de vsl_sessions).
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requirePantalla(tenant, '/marketing/adquisicion/vsl')
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    const [tot] = await sql`
      SELECT
        (SELECT count(*)::int FROM vsl_videos
          WHERE tenant_id = ${tenantId} AND deleted_at IS NULL)                                   AS videos,
        (SELECT count(*)::int FROM vsl_sessions s
          JOIN vsl_videos v ON v.id = s.video_id
          WHERE v.tenant_id = ${tenantId} AND v.deleted_at IS NULL)                              AS impressions,
        (SELECT count(*)::int FROM vsl_sessions s
          JOIN vsl_videos v ON v.id = s.video_id
          WHERE v.tenant_id = ${tenantId} AND v.deleted_at IS NULL AND s.max_position > 0)       AS plays,
        (SELECT count(*)::int FROM vsl_sessions s
          JOIN vsl_videos v ON v.id = s.video_id
          WHERE v.tenant_id = ${tenantId} AND v.deleted_at IS NULL AND s.reached_end)            AS completed,
        (SELECT count(*)::int FROM vsl_sessions s
          JOIN vsl_videos v ON v.id = s.video_id
          WHERE v.tenant_id = ${tenantId} AND v.deleted_at IS NULL AND s.lead_email IS NOT NULL) AS identified,
        (SELECT COALESCE(avg(LEAST(s.max_position / NULLIF(s.duration, 0), 1)), 0)
          FROM vsl_sessions s
          JOIN vsl_videos v ON v.id = s.video_id
          WHERE v.tenant_id = ${tenantId} AND v.deleted_at IS NULL AND s.max_position > 0)       AS avg_ratio
    `

    const impressions = Number(tot.impressions) || 0
    const plays = Number(tot.plays) || 0
    const completed = Number(tot.completed) || 0

    // Idéntico criterio que las métricas por vídeo: "play" = hubo reproducción real
    // (max_position > 0), no el evento discreto que autoplay puede perder.
    return NextResponse.json({
      videos: Number(tot.videos) || 0,
      impressions,
      plays,
      completed,
      identified: Number(tot.identified) || 0,
      playRate: impressions > 0 ? Math.round((plays / impressions) * 100) : 0,
      completionRate: plays > 0 ? Math.round((completed / plays) * 100) : 0,
      avgPercent: Math.round(Number(tot.avg_ratio) * 100),
    })
  } catch (e) {
    console.error('[vsl/resumen]', e)
    return NextResponse.json({ error: 'Error al calcular el resumen' }, { status: 500 })
  }
}
