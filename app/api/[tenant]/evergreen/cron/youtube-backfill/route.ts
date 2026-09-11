import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getInstagramConfig } from '@/lib/instagram/client'
import { runYoutubeSync } from '@/lib/youtube/backfill'

export const runtime = 'nodejs'
export const maxDuration = 120

// Backfill de reels antiguos a YouTube, repartido en 3 pasadas al día (mañana/mediodía/noche)
// vía Supabase pg_cron, en vez de subir todo el cupo diario de golpe en una sola pasada del
// sync de Instagram. Cada llamada sube como máximo 1 reel antiguo (el más reciente pendiente).
// Se dispara con Authorization: Bearer CRON_SECRET.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const cfg = getInstagramConfig()
  if (!cfg) return NextResponse.json({ error: 'Faltan credenciales de Instagram' }, { status: 500 })

  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const uploaded = await runYoutubeSync(sb, cfg, { backfillLimit: 1 })
    return NextResponse.json({ ok: true, uploaded, at: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error en backfill de YouTube' }, { status: 500 })
  }
}
