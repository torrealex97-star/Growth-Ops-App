import { NextRequest, NextResponse } from 'next/server'
import { ensureConfig } from '@/lib/config'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { runMetaSync } from '@/lib/meta/sync'

export const runtime = 'nodejs'
export const maxDuration = 60

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing']

// Sincroniza las campañas de Meta hacia la tabla `campaigns`.
// Auth: sesión (rol admin/director/manager/marketing) O Bearer CRON_SECRET.
//
// NOTA multi-tenant: las credenciales de Meta (resolveMetaConfigs) y el upsert de
// runMetaSync hacia `campaigns` siguen siendo globales (token único, onConflict por
// provider+external_id sin tenant_id), heredado de la era single-tenant. Aquí solo podemos
// verificar que el slug resuelve a un tenant activo antes de lanzar el sync; el aislamiento
// real por tenant de esos datos requiere tocar lib/meta/sync.ts y lib/meta/client.ts, fuera
// del alcance de este lote.
async function handle(req: NextRequest, tenantSlug: string) {
  const auth = req.headers.get('authorization')
  const bearerOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  if (bearerOk) {
    // Cron (pg_net) sin sesión de usuario: resuelve el tenant directamente por slug.
    const { data: tenantRow } = await sb.from('tenants').select('id, status').eq('slug', tenantSlug).eq('status', 'active').maybeSingle()
    if (!tenantRow) return NextResponse.json({ error: 'Subcuenta no encontrada' }, { status: 404 })
  } else {
    const t = await requireTenant(tenantSlug)
    if ('error' in t) return t.error
    const { data: row } = await sb.from('users').select('roles(key)').eq('id', t.userId).single()
    const role = (row?.roles as { key?: string } | null)?.key
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
  }

  try {
    const result = await runMetaSync(sb)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al sincronizar con Meta'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  await ensureConfig()
  const { tenant } = await params
  return handle(req, tenant)
}
