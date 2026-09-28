import { NextResponse } from 'next/server'
import { requirePantalla } from '@/lib/auth/requirePantalla'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// RESUMEN VSL DE LA SUBCUENTA — los KPIs agregados de todos los vídeos, para el dashboard de
// VSL (y consumibles por otros paneles de marketing). Misma protección que las métricas por
// vídeo: el cliente service-role se salta RLS, así que el filtro tenant_id explícito es la barrera.
// Es SOLO lectura y ligera (una pasada por agregados de vsl_sessions).
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requirePantalla(tenant, '/marketing/adquisicion/vsl')
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: videos, error: videosError } = await sb
      .from('vsl_videos')
      .select('id')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
    if (videosError) throw videosError
    const videoIds = (videos ?? []).map((video) => video.id)
    const { data: sessions, error: sessionsError } = videoIds.length
      ? await sb.from('vsl_sessions').select('max_position, duration, reached_end, lead_email').in('video_id', videoIds)
      : { data: [], error: null }
    if (sessionsError) throw sessionsError

    const rows = sessions ?? []
    const impressions = rows.length
    const played = rows.filter((session) => Number(session.max_position) > 0)
    const plays = played.length
    const completed = rows.filter((session) => session.reached_end).length
    const avgRatio = played.length
      ? played.reduce(
          (sum, session) => sum + Math.min(Number(session.max_position) / Math.max(Number(session.duration), 1), 1),
          0
        ) / played.length
      : 0

    // Idéntico criterio que las métricas por vídeo: "play" = hubo reproducción real
    // (max_position > 0), no el evento discreto que autoplay puede perder.
    return NextResponse.json({
      videos: videoIds.length,
      impressions,
      plays,
      completed,
      identified: rows.filter((session) => session.lead_email).length,
      playRate: impressions > 0 ? Math.round((plays / impressions) * 100) : 0,
      completionRate: plays > 0 ? Math.round((completed / plays) * 100) : 0,
      avgPercent: Math.round(avgRatio * 100),
    })
  } catch (e) {
    console.error('[vsl/resumen]', e)
    return NextResponse.json({ error: 'Error al calcular el resumen' }, { status: 500 })
  }
}
