import { NextResponse } from 'next/server'
import { sql, mergeConfig } from '@/lib/vsl/db'

export const dynamic = 'force-dynamic'

// Métricas agregadas de un VSL: play rate, % medio, completado, curva de retención,
// puntos de caída, reparto por dispositivo y lista de leads con su % visto.
export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  try {
    const { slug } = params
    const [video] = await sql`
      SELECT id, slug, name, source_url, poster_url, duration_seconds, config
      FROM vsl_videos WHERE slug = ${slug} LIMIT 1
    `
    if (!video) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const videoId = video.id

    // Totales
    // "play" = la sesión ha reproducido de verdad (tiene posición > 0). No dependemos del
    // evento 'play' discreto porque con autoplay puede perderse si la sesión aún no existía.
    const [tot] = await sql`
      SELECT
        count(*)::int                                            AS impressions,
        count(*) FILTER (WHERE max_position > 0)::int            AS plays,
        count(*) FILTER (WHERE reached_end)::int                 AS completed,
        count(*) FILTER (WHERE lead_email IS NOT NULL)::int      AS identified,
        COALESCE(avg(LEAST(max_position / NULLIF(duration,0), 1))
                 FILTER (WHERE max_position > 0), 0)             AS avg_ratio,
        COALESCE(max(duration), 0)                               AS max_duration
      FROM vsl_sessions WHERE video_id = ${videoId}
    `

    const duration = Math.max(Number(video.duration_seconds) || 0, Number(tot.max_duration) || 0)
    const plays = Number(tot.plays) || 0

    // Curva de retención: cuántas sesiones alcanzaron cada segundo
    const rows = await sql`
      SELECT e AS sec, count(*)::int AS viewers
      FROM vsl_sessions v, unnest(v.watched_seconds) AS e
      WHERE v.video_id = ${videoId}
      GROUP BY e ORDER BY e
    `
    const viewersBySec = new Map<number, number>()
    for (const r of rows) viewersBySec.set(Number(r.sec), Number(r.viewers))

    const total = Math.max(1, Math.floor(duration))
    const retention: { sec: number; viewers: number; pct: number }[] = []
    for (let s = 0; s <= total; s++) {
      const v = viewersBySec.get(s) || 0
      retention.push({ sec: s, viewers: v, pct: plays > 0 ? Math.round((v / plays) * 100) : 0 })
    }

    // Puntos de caída: mayores descensos entre segundos consecutivos
    const drops: { sec: number; from: number; to: number; delta: number }[] = []
    for (let i = 1; i < retention.length; i++) {
      const delta = retention[i - 1].pct - retention[i].pct
      if (delta > 0) drops.push({ sec: retention[i].sec, from: retention[i - 1].pct, to: retention[i].pct, delta })
    }
    drops.sort((a, b) => b.delta - a.delta)

    // Reparto por dispositivo
    const devices = await sql`
      SELECT COALESCE(device,'desconocido') AS device, count(*)::int AS n
      FROM vsl_sessions WHERE video_id = ${videoId}
      GROUP BY 1 ORDER BY n DESC
    `

    // Leads identificados
    const leadsRaw = await sql`
      SELECT lead_email, lead_name, max_position, duration, reached_end, updated_at
      FROM vsl_sessions
      WHERE video_id = ${videoId} AND lead_email IS NOT NULL
      ORDER BY updated_at DESC LIMIT 500
    `
    const leads = leadsRaw.map((l) => {
      const d = Number(l.duration) || duration
      const pct = d > 0 ? Math.min(100, Math.round((Number(l.max_position) / d) * 100)) : 0
      return {
        email: l.lead_email,
        name: l.lead_name,
        maxPosition: Number(l.max_position) || 0,
        pct,
        reachedEnd: l.reached_end,
        updatedAt: l.updated_at,
      }
    })

    return NextResponse.json({
      video: { ...video, config: mergeConfig(video.config), duration_seconds: duration },
      totals: {
        impressions: Number(tot.impressions) || 0,
        plays,
        completed: Number(tot.completed) || 0,
        identified: Number(tot.identified) || 0,
        playRate: Number(tot.impressions) > 0 ? Math.round((plays / Number(tot.impressions)) * 100) : 0,
        avgPercent: Math.round(Number(tot.avg_ratio) * 100),
        completionRate: plays > 0 ? Math.round((Number(tot.completed) / plays) * 100) : 0,
      },
      retention,
      drops: drops.slice(0, 5),
      devices: devices.map((d) => ({ device: d.device, n: Number(d.n) })),
      leads,
    })
  } catch (e) {
    console.error('[vsl/metrics]', e)
    return NextResponse.json({ error: 'Error al calcular métricas' }, { status: 500 })
  }
}
