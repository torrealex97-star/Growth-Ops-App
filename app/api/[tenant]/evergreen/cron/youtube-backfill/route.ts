import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getInstagramConfig } from '@/lib/instagram/client'
import { runYoutubeSync } from '@/lib/youtube/backfill'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'
export const maxDuration = 60

// Backfill de reels antiguos a YouTube, repartido en 3 pasadas al día (mañana/mediodía/noche)
// vía Supabase pg_cron, en vez de subir todo el cupo diario de golpe en una sola pasada del
// sync de Instagram. Cada llamada sube como máximo 1 reel antiguo (el más reciente pendiente).
// Se dispara con Authorization: Bearer CRON_SECRET.
//
// BUGFIX (regresión de la migración multi-tenant, no hardening rutinario): runYoutubeSync ahora
// exige tenantId — filtra/estampa tenant_id en youtube_uploads e ig_media, que son NOT NULL en
// esa tabla. Vercel Cron pega a una única URL estática, así que este handler recorre TODAS las
// subcuentas activas y corre el backfill una vez por cada una (mismo patrón que cron/monthly),
// cargando primero las credenciales de Instagram de ESA subcuenta vía ensureConfig(tenantId).
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
    if (tenantsErr) throw new Error(tenantsErr.message)

    const perTenant: Record<string, number | null> = {}
    for (const tn of tenants || []) {
      // Config explícita por subcuenta (ver cron/instagram): process.env no se limpia entre
      // iteraciones y la segunda subcuenta heredaba el token de la primera.
      const tenantEnv = await getTenantConfigWithFallback(tn.id, true)
      const cfg = getInstagramConfig(tenantEnv)
      if (!cfg) {
        perTenant[tn.slug] = null
        continue
      }
      perTenant[tn.slug] = await runYoutubeSync(sb, cfg, tn.id, tenantEnv, { backfillLimit: 1 })
    }
    return NextResponse.json({ ok: true, uploaded: perTenant, at: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error en backfill de YouTube' },
      { status: 500 }
    )
  }
}
