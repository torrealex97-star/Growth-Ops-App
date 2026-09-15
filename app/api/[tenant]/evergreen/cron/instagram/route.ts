import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runInstagramSync } from '@/lib/instagram/sync'
import { getTenantConfigWithFallback } from '@/lib/config'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'

export const runtime = 'nodejs'
export const maxDuration = 60

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
      // Config EXPLÍCITA por subcuenta: ensureConfig() volcaba las credenciales en process.env y no
      // borraba las anteriores, así que en este mismo bucle una subcuenta sin token de Instagram
      // heredaba el de la anterior y se llenaba con SU contenido, estampado con su propio tenant_id.
      const cfg = await getTenantConfigWithFallback(tn.id, true)
      try {
        perTenant[tn.slug] = await recordSyncRun(
          sb,
          {
            tenantId: tn.id,
            provider: 'instagram',
            job: 'instagram',
            trigger: 'cron',
            secrets: [cfg.INSTAGRAM_ACCESS_TOKEN, cfg.META_ACCESS_TOKEN, cfg.META_APP_SECRET],
          },
          () => runInstagramSync(sb, tn.id, cfg, { mediaLimit: 25, light: true }),
          (r) => ({
            rowsWritten: r.mediaSynced,
            failures: r.failures,
            detail: { fbReels: r.fbReelsSynced, seguidores: r.followers, youtube: r.youtubeUploaded },
          })
        )
      } catch (e) {
        perTenant[tn.slug] = {
          error: e instanceof Error ? e.message : 'Error al sincronizar',
          omitida: e instanceof SyncBusyError,
        }
      }
    }
    return NextResponse.json({ ok: true, tenants: perTenant })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al sincronizar con Instagram'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
