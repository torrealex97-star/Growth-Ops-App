import { NextRequest, NextResponse } from 'next/server'
import { getTenantConfigWithFallback } from '@/lib/config'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { runMetaDailySync } from '@/lib/meta/sync'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'

export const runtime = 'nodejs'
export const maxDuration = 60

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing']

// Sincroniza el GASTO DIARIO por campaña (serie temporal) hacia `campaign_daily`.
// Es lo que permite filtrar el gasto por rango real (este mes / trimestre / año). Cuentas en
// paralelo para caber en 60s. Auth: sesión (rol permitido) O Bearer CRON_SECRET. GET = cron, POST = botón.
//
// BUGFIX (regresión de la migración multi-tenant, no hardening rutinario): runMetaDailySync ahora
// exige tenantId — filtra/estampa tenant_id en cada tabla que toca. ensureConfig también exige
// tenantId (antes era una caché global de 30s compartida entre subcuentas) — se resuelve el
// tenant PRIMERO y se llama a ensureConfig(tenantId) antes de leer nada de process.env.
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

  // Config explícita (la guardada en ESTA subcuenta) en vez de volcarla a process.env: así lo que
  // se sincroniza es lo que hay guardado, y borrar un campo surte efecto de verdad.
  const cfg = await getTenantConfigWithFallback(tenantId, true)
  try {
    const result = await recordSyncRun(
      sb,
      {
        tenantId,
        provider: 'meta',
        job: 'meta-daily',
        trigger: bearerOk ? 'cron' : 'manual',
        secrets: [cfg.META_ACCESS_TOKEN, cfg.META_APP_SECRET],
      },
      () => runMetaDailySync(sb, tenantId, cfg),
      (r) => ({ rowsWritten: r.daysSynced, failures: r.failures, detail: { cuentas: r.accounts } })
    )
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof SyncBusyError) return NextResponse.json({ error: e.message }, { status: 409 })
    const msg = e instanceof Error ? e.message : 'Error al sincronizar el gasto diario de Meta'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  return handle(req, tenant)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  return handle(req, tenant)
}
