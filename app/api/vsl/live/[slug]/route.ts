import { NextResponse } from 'next/server'
import { sql } from '@/lib/vsl/db'

export const dynamic = 'force-dynamic'

// Contador REAL de prueba social para un VSL:
//   - watching: sesiones con un latido en los últimos ~15s (viendo ahora mismo)
//   - watched : sesiones que han reproducido de verdad (max_position > 0)
// Público (lo llama el reproductor embebido). Ver PUBLIC_PATHS /api/vsl en middleware.
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  try {
    const { slug } = params
    const [row] = await sql`
      SELECT
        count(*) FILTER (WHERE s.last_beat_at > now() - interval '15 seconds')::int AS watching,
        count(*) FILTER (WHERE s.max_position > 0)::int                              AS watched
      FROM vsl_sessions s
      JOIN vsl_videos v ON v.id = s.video_id
      WHERE v.slug = ${slug}
    `
    return NextResponse.json(
      { watching: Number(row?.watching) || 0, watched: Number(row?.watched) || 0 },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    console.error('[vsl/live]', e)
    return NextResponse.json({ watching: 0, watched: 0 }, { status: 200 })
  }
}
