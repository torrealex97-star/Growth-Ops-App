import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runInstagramSync } from '@/lib/instagram/sync'
import { ensureConfig } from '@/lib/config'

export const runtime = 'nodejs'
export const maxDuration = 300

// Cron diario → sincroniza el Instagram orgánico. Se dispara por Supabase pg_cron
// (Vercel es Hobby = solo crons diarios), igual que el cron de Meta.
// Inyecta Authorization: Bearer CRON_SECRET.
//
// BUGFIX (regresión de la migración multi-tenant, no hardening rutinario): runInstagramSync
// ahora exige tenantId — filtra/estampa tenant_id en ig_media/ig_account_daily/ig_audience/
// fb_media/ig_conversations_daily/youtube_uploads, que son NOT NULL en esas tablas. Vercel Cron
// pega a una única URL estática, así que este handler recorre TODAS las subcuentas activas y
// corre la sync una vez por cada una (mismo patrón que cron/monthly), cargando primero las
// credenciales de Instagram de ESA subcuenta vía ensureConfig(tenantId).
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
    if (tenantsErr) throw new Error(tenantsErr.message)

    // Vercel Hobby corta a 60s: en el cron sincronizamos solo los media recientes
    // (los antiguos ya están backfilleados y sus métricas apenas cambian) y en modo
    // light (FB solo views, sin summaries por reel). Snapshot de cuenta + demografía
    // se refrescan siempre. El backfill completo se hace en local.
    const perTenant: Record<string, unknown> = {}
    for (const tn of tenants || []) {
      await ensureConfig(tn.id)
      perTenant[tn.slug] = await runInstagramSync(sb, tn.id, { mediaLimit: 25, light: true })
    }
    return NextResponse.json({ ok: true, tenants: perTenant })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al sincronizar con Instagram'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
