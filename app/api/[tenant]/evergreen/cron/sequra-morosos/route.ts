import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { syncSequraDelinquents } from '@/lib/sequra/syncDelinquents'
import { getTenantConfigWithFallback } from '@/lib/config'
import { recordSyncRun, SyncBusyError, SyncOmitidaError } from '@/lib/integrations/sync-runs'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const maxDuration = 60

// Sincroniza morosos reales de sequra hacia sequra_delinquent_customers.
// Auth: header Bearer CRON_SECRET (GitHub Actions, 08:00 UTC de los lunes) o sesión de
// admin/director/cobros (botón manual).
//
// El patrón es el mismo que cron/meta-ads: Vercel Cron y GitHub Actions pegan a una única URL
// estática, así que el disparo por CRON_SECRET recorre TODAS las subcuentas activas y corre la
// sync una vez por cada una. La sincronización de CADA subcuenta se ejecuta y registra dentro de
// recordSyncRun: una que falla no impide las demás, y una sin credenciales de SeQura es una
// omisión declarada (no una avería ni un 500 global — antes, una subcuenta sin configurar tiraba
// abajo el cron de todas con 500).
async function isCronAuthorized(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization')
  return !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
}

// El botón manual queda acotado a la subcuenta de la URL y usa la sesión.
function svc(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function handle(req: NextRequest, tenantSlug: string) {
  const sb = svc()
  if (await isCronAuthorized(req)) {
    const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
    if (tenantsErr) throw new Error(tenantsErr.message)

    const perTenant: Record<string, unknown> = {}
    for (const tn of tenants || []) {
      // Configuración EXPLÍCITA por subcuenta: la de una no puede sincronizar el comercio de otra.
      const cfg = await getTenantConfigWithFallback(tn.id, true)
      try {
        perTenant[tn.slug] = await recordSyncRun(
          sb,
          {
            tenantId: tn.id,
            provider: 'sequra',
            job: 'sequra-morosos',
            trigger: 'cron',
            secrets: [cfg.SEQURA_MCP_TOKEN],
            // Sin credenciales de SeQura no se ejecuta NI se registra: una subcuenta que no usa el
            // proveedor está sin configurar, no averiada (S0.7 §3.5).
            requiere: { claves: ['SEQURA_MCP_TOKEN', 'SEQURA_MERCHANT_REFERENCE'], cfg },
          },
          () => syncSequraDelinquents(tn.id, cfg),
          (r) => ({ rowsWritten: r.upserted, detail: { checked: r.checked, recuperados: r.recovered } })
        )
      } catch (e) {
        // Una subcuenta que falla no puede impedir que se sincronicen las demás. El motivo queda
        // guardado en integration_sync_runs y el panel de esa subcuenta lo muestra.
        perTenant[tn.slug] = {
          error: e instanceof Error ? e.message : 'Error al sincronizar',
          omitida: e instanceof SyncBusyError || e instanceof SyncOmitidaError,
        }
      }
    }
    return NextResponse.json({ ok: true, tenants: perTenant })
  }

  // Sesión de admin/director/cobros para el botón manual de Integraciones.
  try {
    const cookieStore = await cookies()
    const anon = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {},
      },
    })
    const {
      data: { user },
    } = await anon.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const { data } = await sb.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (data?.roles as { key?: string } | null)?.key
    if (!(role === 'admin' || role === 'director' || role === 'cobros')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const t = await requireTenant(tenantSlug)
    if ('error' in t) return t.error
    const cfg = await getTenantConfigWithFallback(t.tenantId, true)
    try {
      const result = await recordSyncRun(
        sb,
        {
          tenantId: t.tenantId,
          provider: 'sequra',
          job: 'sequra-morosos',
          trigger: 'manual',
          secrets: [cfg.SEQURA_MCP_TOKEN],
          requiere: { claves: ['SEQURA_MCP_TOKEN', 'SEQURA_MERCHANT_REFERENCE'], cfg },
        },
        () => syncSequraDelinquents(t.tenantId, cfg),
        (r) => ({ rowsWritten: r.upserted, detail: { checked: r.checked, recuperados: r.recovered } })
      )
      return NextResponse.json({ ok: true, ...result })
    } catch (e) {
      if (e instanceof SyncBusyError) {
        return NextResponse.json({ error: e.message }, { status: 409 })
      }
      if (e instanceof SyncOmitidaError) {
        return NextResponse.json({ error: e.message }, { status: 400 })
      }
      const msg = e instanceof Error ? e.message : 'Error al sincronizar'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  return handle(req, tenant)
}
