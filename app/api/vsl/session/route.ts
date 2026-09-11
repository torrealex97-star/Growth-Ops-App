import { NextResponse } from 'next/server'
import { sql } from '@/lib/vsl/db'

export const dynamic = 'force-dynamic'

function detectDevice(ua: string): string {
  const s = (ua || '').toLowerCase()
  if (/ipad|tablet|playbook|silk/.test(s)) return 'tablet'
  if (/mobi|android|iphone|ipod/.test(s)) return 'mobile'
  return 'desktop'
}

// Crea (o recupera) la sesión de visionado para un anon_id + vídeo.
export async function POST(req: Request) {
  try {
    const { slug, anonId, referrer } = await req.json()
    if (!slug || !anonId) {
      return NextResponse.json({ error: 'slug y anonId requeridos' }, { status: 400 })
    }

    const ua = req.headers.get('user-agent') || ''
    const country = req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || null
    const device = detectDevice(ua)

    const [video] = await sql`
      SELECT id FROM vsl_videos WHERE slug = ${slug} LIMIT 1
    `
    if (!video) return NextResponse.json({ error: 'Vídeo no encontrado' }, { status: 404 })

    const [row] = await sql`
      INSERT INTO vsl_sessions (video_id, anon_id, referrer, device, country, user_agent)
      VALUES (${video.id}, ${anonId}, ${referrer || null}, ${device}, ${country}, ${ua})
      ON CONFLICT (video_id, anon_id)
      DO UPDATE SET updated_at = now(), referrer = COALESCE(vsl_sessions.referrer, EXCLUDED.referrer)
      RETURNING id
    `
    return NextResponse.json({ sessionId: row.id })
  } catch (e) {
    console.error('[vsl/session]', e)
    return NextResponse.json({ error: 'Error al crear sesión' }, { status: 500 })
  }
}
