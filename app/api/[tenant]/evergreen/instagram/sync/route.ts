import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { runInstagramSync } from '@/lib/instagram/sync'
import { getTenantConfigWithFallback } from '@/lib/config'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'

export const runtime = 'nodejs'
export const maxDuration = 300

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing']

// Sincroniza el Instagram orgánico (cuenta de la subcuenta) hacia ig_media / ig_account_daily / ig_audience.
// Auth: sesión (admin/director/manager/marketing) O Bearer CRON_SECRET.
//
// BUGFIX (regresión de la migración multi-tenant, no hardening rutinario): runInstagramSync ahora
// exige tenantId — filtra/estampa tenant_id en ig_media/ig_account_daily/ig_audience/fb_media/
// ig_conversations_daily, que son NOT NULL en esas tablas. ensureConfig también exige tenantId
// (antes era una caché global de 30s compartida entre subcuentas) — se resuelve el tenant PRIMERO
// y se llama a ensureConfig(tenantId) antes de leer credenciales de Instagram de process.env.
async function handle(req: NextRequest, tenantSlug: string) {
  const auth = req.headers.get('authorization')
  const bearerOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  let tenantId: string
  if (bearerOk) {
    // Cron (pg_net) sin sesión de usuario: resuelve el tenant directamente por slug.
    const { data: tenantRow } = await sb
      .from('tenants')
      .select('id, status')
      .eq('slug', tenantSlug)
      .eq('status', 'active')
      .maybeSingle()
    if (!tenantRow) return NextResponse.json({ error: 'Subcuenta no encontrada' }, { status: 404 })
    tenantId = tenantRow.id as string
  } else {
    const t = await requireTenant(tenantSlug)
    if ('error' in t) return t.error
    const role = t.role
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    tenantId = t.tenantId
  }

  const cfg = await getTenantConfigWithFallback(tenantId, true)
  try {
    const result = await recordSyncRun(
      sb,
      {
        tenantId,
        provider: 'instagram',
        job: 'instagram',
        trigger: 'manual',
        secrets: [cfg.INSTAGRAM_ACCESS_TOKEN, cfg.META_ACCESS_TOKEN, cfg.META_APP_SECRET],
      },
      () => runInstagramSync(sb, tenantId, cfg),
      (r) => ({ rowsWritten: r.mediaSynced, failures: r.failures, detail: { fbReels: r.fbReelsSynced } })
    )
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof SyncBusyError) return NextResponse.json({ error: e.message }, { status: 409 })
    const msg = e instanceof Error ? e.message : 'Error al sincronizar con Instagram'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  return handle(req, tenant)
}
