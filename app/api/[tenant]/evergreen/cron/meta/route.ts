import { NextRequest, NextResponse } from 'next/server'
import { getTenantConfigWithFallback } from '@/lib/config'
import { createClient } from '@supabase/supabase-js'
import { runMetaSync } from '@/lib/meta/sync'
import { recordSyncRun, SyncBusyError, SyncOmitidaError } from '@/lib/integrations/sync-runs'

export const runtime = 'nodejs'
export const maxDuration = 60

// Cron de Vercel (cada 30 min) → sincroniza Meta hacia `campaigns` y actualiza
// el gasto del mes en Finanzas/P&L. Vercel Cron inyecta Authorization: Bearer CRON_SECRET.
//
// BUGFIX (regresión de la migración multi-tenant, no hardening rutinario): runMetaSync ahora
// exige tenantId — filtra integration_settings/contact_attributions/appointments/sales/campaigns
// por tenant y estampa tenant_id en cada fila nueva. Vercel Cron pega a una única URL estática,
// así que este handler recorre TODAS las subcuentas activas y corre la sync una vez por cada una.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
    if (tenantsErr) throw new Error(tenantsErr.message)

    const perTenant: Record<string, unknown> = {}
    for (const tn of tenants || []) {
      // Configuración EXPLÍCITA por subcuenta. Antes esto llamaba a ensureConfig(), que vuelca las
      // credenciales en process.env y no borra las anteriores: en este mismo bucle, la subcuenta sin
      // token propio heredaba el de la anterior y se llenaba con SUS campañas.
      const cfg = await getTenantConfigWithFallback(tn.id, true)
      try {
        perTenant[tn.slug] = await recordSyncRun(
          sb,
          {
            tenantId: tn.id,
            provider: 'meta',
            job: 'meta',
            trigger: 'cron',
            secrets: [cfg.META_ACCESS_TOKEN, cfg.META_APP_SECRET],
            // Sin credenciales no se ejecuta NI se registra: una subcuenta que no usa este
            // proveedor está sin configurar, no averiada (S0.7 §3.5).
            requiere: { claves: ['META_ACCESS_TOKEN'], cfg },
          },
          () => runMetaSync(sb, tn.id, cfg),
          (r) => ({ rowsWritten: r.synced, failures: r.failures, detail: { cuentas: r.accounts } })
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al sincronizar con Meta'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
