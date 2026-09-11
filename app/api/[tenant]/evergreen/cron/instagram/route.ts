import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runInstagramSync } from '@/lib/instagram/sync'

export const runtime = 'nodejs'
export const maxDuration = 300

// Cron diario → sincroniza el Instagram orgánico. Se dispara por Supabase pg_cron
// (Vercel es Hobby = solo crons diarios), igual que el cron de Meta.
// Inyecta Authorization: Bearer CRON_SECRET.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    // Vercel Hobby corta a 60s: en el cron sincronizamos solo los media recientes
    // (los antiguos ya están backfilleados y sus métricas apenas cambian) y en modo
    // light (FB solo views, sin summaries por reel). Snapshot de cuenta + demografía
    // se refrescan siempre. El backfill completo se hace en local.
    const result = await runInstagramSync(sb, { mediaLimit: 25, light: true })
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al sincronizar con Instagram'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
