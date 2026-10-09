import { NextResponse } from 'next/server'
import { sql } from '@/lib/vsl/db'
import { syncContactWatchPct } from '@/lib/vsl/sync'
import { MinuteRateLimiter } from '@/lib/tracking/ingest'
import { sanitizeWatchIntervals, secondsFromIntervals } from '@/lib/vsl/tracking'

export const dynamic = 'force-dynamic'

// Rate limit por proceso (el mismo del pixel): un latido sano va cada ~3s, 20/min por IP
// cubre de sobra a varios viewers detrás de la misma IP (oficina/CGNAT).
const limiter = new MinuteRateLimiter()

const EVENT_TYPES: Record<string, string> = {
  ready: 'player_ready',
  play: 'video_play',
  resume: 'video_resume',
  pause: 'video_pause',
  seek: 'video_seek',
  beat: 'video_progress',
  unload: 'video_progress',
  ended: 'video_complete',
  cta_impression: 'video_cta_impression',
  cta: 'video_cta_click',
  buffer_start: 'video_buffer_start',
  buffer_end: 'video_buffer_end',
  error: 'video_error',
}

// Latido de tracking. El player manda, cada ~3s, los segundos NUEVOS vistos desde el último latido,
// la posición actual, la duración y el evento. Fusionamos watched_seconds de forma única en DB
// para obtener un heatmap real (detecta rebobinados y saltos).
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const sessionId: string | undefined = body.sessionId
    const playbackId: string | undefined = body.playbackId
    const intervals = sanitizeWatchIntervals(body.intervals)
    const seconds: number[] = Array.isArray(body.seconds) ? body.seconds : secondsFromIntervals(intervals)
    const position = Number(body.position) || 0
    const duration = Number(body.duration) || 0
    const event: string = body.event || 'beat'
    const eventType = EVENT_TYPES[event] || 'video_progress'
    const eventId = typeof body.eventId === 'string' ? body.eventId.slice(0, 160) : null
    const batchId = typeof body.batchId === 'string' ? body.batchId.slice(0, 160) : eventId
    const occurredAt = Number.isFinite(Date.parse(body.occurredAt)) ? body.occurredAt : new Date().toISOString()
    const playbackRate = Math.min(4, Math.max(0.25, Number(body.playbackRate) || 1))
    const visibilityState = body.visibilityState === 'hidden' ? 'hidden' : 'visible'

    if (!sessionId) return NextResponse.json({ error: 'sessionId requerido' }, { status: 400 })
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconocida'
    if (!limiter.allow(`vsl-track:${ip}`, 120)) {
      return NextResponse.json({ error: 'Demasiadas peticiones' }, { status: 429 })
    }

    // Sanea: enteros >= 0 y acotados a una duración razonable (evita basura).
    const clean = Array.from(
      new Set(seconds.map((s) => Math.floor(Number(s))).filter((s) => Number.isFinite(s) && s >= 0 && s < 86_400))
    )

    const reachedEnd = event === 'ended' || (duration > 0 && position >= duration - 1.5)
    const isPlay = event === 'play'

    const [sess] = await sql`
      UPDATE vsl_sessions SET
        watched_seconds = (
          SELECT COALESCE(array_agg(DISTINCT e ORDER BY e), '{}')
          FROM unnest(watched_seconds || ${sql.array(clean)}::int[]) AS e
        ),
        max_position  = GREATEST(max_position, ${position}),
        duration      = GREATEST(duration, ${duration}),
        plays         = plays + ${isPlay ? 1 : 0},
        reached_end   = reached_end OR ${reachedEnd},
        first_play_at = COALESCE(first_play_at, ${isPlay ? sql`now()` : null}),
        last_beat_at  = now(),
        updated_at    = now()
      WHERE id = ${sessionId}
      RETURNING lead_email, max_position, duration
    `

    // Dual-write: la sesión legacy sigue alimentando los paneles existentes, mientras la capa
    // canónica recibe eventos idempotentes e intervalos realmente reproducidos. El playback se
    // valida contra la sesión legacy: un cliente no puede escribir sobre otra reproducción.
    if (playbackId && eventId && batchId) {
      const [context] = await sql`
        UPDATE vsl_playback_sessions
        SET last_event_at = now(), ended_at = CASE WHEN ${reachedEnd} THEN COALESCE(ended_at, now()) ELSE ended_at END
        WHERE playback_id = ${playbackId} AND legacy_session_id = ${sessionId}
        RETURNING tenant_id
      `
      if (context) {
        await sql`
          INSERT INTO vsl_tracking_events (
            tenant_id, playback_id, event_id, event_type, occurred_at, playhead_seconds,
            duration_seconds, playback_rate, visibility_state
          ) VALUES (
            ${context.tenant_id}, ${playbackId}, ${eventId}, ${eventType}, ${occurredAt}, ${position},
            ${duration}, ${playbackRate}, ${visibilityState}
          )
          ON CONFLICT (tenant_id, event_id) DO NOTHING
        `
        if (intervals.length > 0) {
          const intervalJson = intervals.map((interval, sequenceNumber) => ({
            sequence_number: sequenceNumber,
            start_second: interval.start,
            end_second: interval.end,
            playback_rate: interval.rate,
          }))
          await sql`
            INSERT INTO vsl_watch_intervals (
              tenant_id, playback_id, batch_id, sequence_number, start_second, end_second,
              playback_rate, occurred_at
            )
            SELECT ${context.tenant_id}, ${playbackId}, ${batchId}, row.sequence_number,
                   row.start_second, row.end_second, row.playback_rate, ${occurredAt}::timestamptz
            FROM jsonb_to_recordset(${sql.json(intervalJson)}::jsonb) AS row(
              sequence_number integer, start_second numeric, end_second numeric, playback_rate numeric
            )
            ON CONFLICT (tenant_id, playback_id, batch_id, sequence_number) DO NOTHING
          `
        }
      }
    }

    // Copia el % exacto visto al contacto (por email) para que el cold caller lo vea en Leads.
    // En try/catch aislado: si faltan las columnas vsl_* en algún entorno, el tracking NO debe fallar.
    await syncContactWatchPct(sess)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[vsl/track]', e)
    return NextResponse.json({ error: 'Error al registrar' }, { status: 500 })
  }
}
