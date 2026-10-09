import { NextResponse } from 'next/server'
import { sql, mergeConfig } from '@/lib/vsl/db'
import { requirePantalla } from '@/lib/auth/requirePantalla'
import { PERMISSIONS, type AppRole } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'

// Métricas agregadas de un VSL: play rate, % medio, completado, curva de retención,
// puntos de caída, reparto por dispositivo y lista de leads con su % visto.
// NOTA: este módulo usa el cliente `postgres` directo (POSTGRES_URL), que bypassa RLS igual
// que el service-role de Supabase, así que el filtro `tenant_id` explícito en cada consulta
// es la única protección contra fugas cruzadas de tenant.
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string; slug: string }> }) {
  try {
    const { tenant, slug } = await params
    // Este módulo habla con `postgres` directo, que se salta RLS igual que el service-role: el
    // filtro por tenant evita la fuga entre subcuentas, pero no dice QUIÉN puede pedir estas
    // métricas. Se exige el mismo acceso que a la pantalla de VSL (auditoría F02).
    const t = await requirePantalla(tenant, '/marketing/adquisicion/vsl')
    if ('error' in t) return t.error
    const tenantId = t.tenantId
    // La lista de personas identificadas es dato personal (correo y nombre), no una métrica. Se
    // entrega solo a quien ya puede ver contactos en el CRM; el resto recibe las mismas cifras sin
    // la lista. Antes viajaba a cualquiera que abriera la pantalla, incluido un editor de contenido.
    const puedeVerPersonas = t.isSuperAdmin || PERMISSIONS.canViewContacts((t.role ?? 'editor') as AppRole)

    const [video] = await sql`
      SELECT id, slug, name, source_url, poster_url, duration_seconds, config
      FROM vsl_videos WHERE slug = ${slug} AND tenant_id = ${tenantId} LIMIT 1
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
      FROM vsl_sessions WHERE video_id = ${videoId} AND tenant_id = ${tenantId}
    `

    const duration = Math.max(Number(video.duration_seconds) || 0, Number(tot.max_duration) || 0)
    const plays = Number(tot.plays) || 0

    // La capa nueva mide intervalos reproducidos de verdad. Se mantiene el fallback legacy para
    // histórico: no fingimos precisión para sesiones anteriores a la instrumentación.
    const [precisionTotals] = await sql`
      WITH watched AS (
        SELECT p.playback_id,
               count(DISTINCT second_seen.sec)::int AS unique_seconds,
               sum(i.end_second - i.start_second) AS total_seconds,
               GREATEST(max(vv.duration_seconds), 0) AS duration_seconds
        FROM vsl_playback_sessions p
        INNER JOIN vsl_video_versions vv
          ON vv.tenant_id = p.tenant_id AND vv.id = p.video_version_id
        INNER JOIN vsl_watch_intervals i
          ON i.tenant_id = p.tenant_id AND i.playback_id = p.playback_id
        CROSS JOIN LATERAL generate_series(
          floor(i.start_second)::int,
          GREATEST(floor(i.start_second)::int, ceil(i.end_second)::int - 1)
        ) AS second_seen(sec)
        WHERE p.video_id = ${videoId} AND p.tenant_id = ${tenantId}
        GROUP BY p.playback_id
      )
      SELECT count(*)::int AS playbacks,
             COALESCE(avg(LEAST(unique_seconds / NULLIF(duration_seconds, 0), 1)), 0) AS avg_ratio,
             COALESCE(sum(total_seconds), 0) AS total_seconds
      FROM watched
    `
    const precisionPlaybacks = Number(precisionTotals.playbacks) || 0

    // Hitos de visión (paridad de reporting de Vidalytics/Wistia): % de sesiones que alcanzaron
    // cada tramo del vídeo. Derivado de max_position — sin migración ni columnas nuevas. El 100%
    // es el completado (reached_end), que no depende del último segundo exacto registrado.
    const [hitos] = await sql`
      SELECT
        count(*) FILTER (WHERE duration > 0 AND max_position >= duration * 0.25)::int AS h25,
        count(*) FILTER (WHERE duration > 0 AND max_position >= duration * 0.50)::int AS h50,
        count(*) FILTER (WHERE duration > 0 AND max_position >= duration * 0.75)::int AS h75,
        count(*) FILTER (WHERE duration > 0 AND max_position >= duration * 0.95)::int AS h95
      FROM vsl_sessions
      WHERE video_id = ${videoId} AND tenant_id = ${tenantId} AND max_position > 0
    `
    const pctDe = (n: number) => (plays > 0 ? Math.round((n / plays) * 100) : 0)
    const milestones = [
      { pct: 25, sessions: Number(hitos.h25), rate: pctDe(Number(hitos.h25)) },
      { pct: 50, sessions: Number(hitos.h50), rate: pctDe(Number(hitos.h50)) },
      { pct: 75, sessions: Number(hitos.h75), rate: pctDe(Number(hitos.h75)) },
      { pct: 95, sessions: Number(hitos.h95), rate: pctDe(Number(hitos.h95)) },
      { pct: 100, sessions: Number(tot.completed), rate: pctDe(Number(tot.completed)) },
    ]

    // Curva de retención: cuántas sesiones alcanzaron cada segundo
    const legacyRows = await sql`
      SELECT e AS sec, count(*)::int AS viewers
      FROM vsl_sessions v, unnest(v.watched_seconds) AS e
      WHERE v.video_id = ${videoId} AND v.tenant_id = ${tenantId}
      GROUP BY e ORDER BY e
    `
    const precisionRows = await sql`
      SELECT second_seen.sec::int AS sec, count(DISTINCT p.playback_id)::int AS viewers
      FROM vsl_playback_sessions p
      INNER JOIN vsl_watch_intervals i
        ON i.tenant_id = p.tenant_id AND i.playback_id = p.playback_id
      CROSS JOIN LATERAL generate_series(
        floor(i.start_second)::int,
        GREATEST(floor(i.start_second)::int, ceil(i.end_second)::int - 1)
      ) AS second_seen(sec)
      WHERE p.video_id = ${videoId} AND p.tenant_id = ${tenantId}
      GROUP BY second_seen.sec ORDER BY second_seen.sec
    `
    const rows = precisionPlaybacks > 0 ? precisionRows : legacyRows
    const viewersBySec = new Map<number, number>()
    for (const r of rows) viewersBySec.set(Number(r.sec), Number(r.viewers))

    const total = Math.max(1, Math.floor(duration))
    const retention: { sec: number; viewers: number; pct: number }[] = []
    for (let s = 0; s <= total; s++) {
      const v = viewersBySec.get(s) || 0
      const denominator = precisionPlaybacks > 0 ? precisionPlaybacks : plays
      retention.push({ sec: s, viewers: v, pct: denominator > 0 ? Math.round((v / denominator) * 100) : 0 })
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
      FROM vsl_sessions WHERE video_id = ${videoId} AND tenant_id = ${tenantId}
      GROUP BY 1 ORDER BY n DESC
    `

    // Leads identificados
    const leadsRaw = await sql`
      SELECT lead_email, lead_name, max_position, duration, reached_end, updated_at
      FROM vsl_sessions
      WHERE video_id = ${videoId} AND tenant_id = ${tenantId} AND lead_email IS NOT NULL
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

    // Heatmaps recientes: detalle acotado y paginable en una fase posterior. Solo se expone PII
    // cuando el rol ya podía ver Contactos; los intervalos no contienen email ni IP.
    const intervalRows = await sql`
      WITH recent AS (
        SELECT p.playback_id, p.started_at, p.ended_at, p.viewer_id, p.legacy_session_id,
               vv.duration_seconds
        FROM vsl_playback_sessions p
        INNER JOIN vsl_video_versions vv
          ON vv.tenant_id = p.tenant_id AND vv.id = p.video_version_id
        WHERE p.video_id = ${videoId} AND p.tenant_id = ${tenantId}
          AND EXISTS (
            SELECT 1 FROM vsl_watch_intervals wi
            WHERE wi.tenant_id = p.tenant_id AND wi.playback_id = p.playback_id
          )
        ORDER BY p.started_at DESC
        LIMIT 20
      )
      SELECT recent.playback_id, recent.started_at, recent.ended_at, recent.viewer_id,
             recent.duration_seconds, legacy.lead_email, legacy.lead_name,
             interval.start_second, interval.end_second
      FROM recent
      LEFT JOIN vsl_sessions legacy ON legacy.id = recent.legacy_session_id
      INNER JOIN vsl_watch_intervals interval ON interval.playback_id = recent.playback_id
      ORDER BY recent.started_at DESC, interval.start_second
    `
    const heatmapByPlayback = new Map<
      string,
      {
        playbackId: string
        viewer: string
        startedAt: string
        duration: number
        intervals: { start: number; end: number }[]
      }
    >()
    for (const row of intervalRows) {
      const playbackId = String(row.playback_id)
      const current = heatmapByPlayback.get(playbackId) ?? {
        playbackId,
        viewer:
          puedeVerPersonas && row.lead_email
            ? String(row.lead_name || row.lead_email)
            : `Anónimo · ${String(row.viewer_id).slice(-6)}`,
        startedAt: String(row.started_at),
        duration: Number(row.duration_seconds) || duration,
        intervals: [],
      }
      current.intervals.push({ start: Number(row.start_second), end: Number(row.end_second) })
      heatmapByPlayback.set(playbackId, current)
    }
    const heatmaps = Array.from(heatmapByPlayback.values()).map((heatmap) => {
      const uniqueSeconds = new Set<number>()
      for (const interval of heatmap.intervals) {
        for (let second = Math.floor(interval.start); second < Math.ceil(interval.end); second += 1) {
          uniqueSeconds.add(second)
        }
      }
      return {
        ...heatmap,
        watchedPercent:
          heatmap.duration > 0 ? Math.min(100, Math.round((uniqueSeconds.size / heatmap.duration) * 100)) : 0,
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
        avgPercent: Math.round(Number(precisionPlaybacks > 0 ? precisionTotals.avg_ratio : tot.avg_ratio) * 100),
        completionRate: plays > 0 ? Math.round((Number(tot.completed) / plays) * 100) : 0,
      },
      retention,
      milestones,
      drops: drops.slice(0, 5),
      devices: devices.map((d) => ({ device: d.device, n: Number(d.n) })),
      leads: puedeVerPersonas ? leads : [],
      // `null` diría "no hay"; esto dice "no te toca", que es distinto y la pantalla puede explicarlo.
      leadsOcultos: puedeVerPersonas ? 0 : leads.length,
      heatmaps,
      trackingHealth: {
        mode: precisionPlaybacks > 0 ? 'precise' : 'legacy',
        precisionPlaybacks,
        totalTimePlayed: Number(precisionTotals.total_seconds) || 0,
        note:
          precisionPlaybacks > 0
            ? 'Intervalos reales; los saltos no rellenan tiempo no visto.'
            : 'Histórico aproximado anterior al tracking por intervalos.',
      },
    })
  } catch (e) {
    console.error('[vsl/metrics]', e)
    return NextResponse.json({ error: 'Error al calcular métricas' }, { status: 500 })
  }
}
