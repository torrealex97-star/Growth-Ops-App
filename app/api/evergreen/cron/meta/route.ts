import { NextRequest, NextResponse } from 'next/server'
import { ensureConfig } from '@/lib/config'
import { createClient } from '@supabase/supabase-js'
import { runMetaSync } from '@/lib/meta/sync'

export const runtime = 'nodejs'
export const maxDuration = 60

// Cron de Vercel (cada 30 min) → sincroniza Meta hacia `campaigns` y actualiza
// el gasto del mes en Finanzas/P&L. Vercel Cron inyecta Authorization: Bearer CRON_SECRET.
export async function GET(req: NextRequest) {
  await ensureConfig()
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const result = await runMetaSync(sb)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al sincronizar con Meta'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
