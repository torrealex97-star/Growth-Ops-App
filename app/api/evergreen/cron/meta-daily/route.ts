import { NextRequest, NextResponse } from 'next/server'
import { ensureConfig } from '@/lib/config'
import { createClient } from '@supabase/supabase-js'
import { runMetaDailySync } from '@/lib/meta/sync'

export const runtime = 'nodejs'
export const maxDuration = 60

// Cron (cada 6 h vía pg_cron) → sincroniza el GASTO DIARIO por campaña hacia `campaign_daily`.
// Bajo /api/evergreen/cron/* el middleware NO exige sesión: se autentica con Bearer CRON_SECRET.
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
    const result = await runMetaDailySync(sb)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al sincronizar el gasto diario de Meta'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
