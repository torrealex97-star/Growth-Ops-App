import { NextResponse } from 'next/server'
import { sql } from '@/lib/vsl/db'
import { syncContactWatchPct } from '@/lib/vsl/sync'

export const dynamic = 'force-dynamic'

// Latido de tracking. El player manda, cada ~3s, los segundos NUEVOS vistos desde el último latido,
// la posición actual, la duración y el evento. Fusionamos watched_seconds de forma única en DB
// para obtener un heatmap real (detecta rebobinados y saltos).
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const sessionId: string | undefined = body.sessionId
    const seconds: number[] = Array.isArray(body.seconds) ? body.seconds : []
    const position = Number(body.position) || 0
    const duration = Number(body.duration) || 0
    const event: string = body.event || 'beat'

    if (!sessionId) return NextResponse.json({ error: 'sessionId requerido' }, { status: 400 })

    // Sanea: enteros >= 0 y acotados a una duración razonable (evita basura).
    const clean = Array.from(
      new Set(
        seconds
          .map((s) => Math.floor(Number(s)))
          .filter((s) => Number.isFinite(s) && s >= 0 && s < 86_400)
      )
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

    // Copia el % exacto visto al contacto (por email) para que el cold caller lo vea en Leads.
    // En try/catch aislado: si faltan las columnas vsl_* en algún entorno, el tracking NO debe fallar.
    await syncContactWatchPct(sess)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[vsl/track]', e)
    return NextResponse.json({ error: 'Error al registrar' }, { status: 500 })
  }
}
