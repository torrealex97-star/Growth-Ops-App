import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncStripeCustomers } from '@/lib/finance/stripeCustomers'
import { getTenantConfigWithFallback } from '@/lib/config'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'

export const runtime = 'nodejs'
export const maxDuration = 60

// Cron de la base de clientes de Stripe. Mismo patrón que los demás: un GET global protegido por
// CRON_SECRET que recorre TODAS las subcuentas activas, porque Vercel Cron pega a una URL estática.
//
// ESTA RUTA EXISTE PERO NO ESTÁ PROGRAMADA TODAVÍA, a propósito. El proyecto está en plan Hobby
// (verificado contra la API de Vercel: team `Growth-Ops_vercel`, plan `hobby`) y `vercel.json` ya
// declara NUEVE crons. Añadir un décimo sin saber cuántos ejecuta Vercel de verdad en ese plan
// podría desplazar sincronizaciones que sí importan —Meta, Instagram, recordatorios— y eso es peor
// que no tener la de Stripe automática.
//
// PARA ACTIVARLA hace falta una sola línea en `vercel.json`:
//   { "path": "/api/_/evergreen/cron/stripe-customers", "schedule": "0 9 * * *" }
// Antes de añadirla, comprobar en el panel de Vercel (Settings › Cron Jobs) cuántos crons están
// realmente registrados; si el plan no da para más, la alternativa es subir de plan o quitar uno.
// Mientras no esté programada, `SYNC_DEFS` la declara `scheduler: 'manual'` con su motivo, así que
// el panel de Integraciones dice la verdad en vez de pintar un verde que no le corresponde.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
    if (tenantsErr) throw new Error(tenantsErr.message)

    const porSubcuenta: Record<string, unknown> = {}
    for (const tn of tenants || []) {
      // Config EXPLÍCITA por subcuenta: la clave de Stripe de una no puede acabar sincronizando la
      // cuenta de otra, que es lo que pasaba cuando la config viajaba por process.env.
      const cfg = await getTenantConfigWithFallback(tn.id, true)
      if (!cfg.STRIPE_SECRET_KEY) {
        // Sin clave no es un fallo: esa subcuenta simplemente no usa Stripe. Decirlo no es lo mismo
        // que registrar un error.
        porSubcuenta[tn.slug] = { omitida: true, motivo: 'Stripe no está configurado en esta subcuenta' }
        continue
      }
      try {
        porSubcuenta[tn.slug] = await recordSyncRun(
          sb,
          {
            tenantId: tn.id,
            provider: 'stripe',
            job: 'stripe-customers',
            trigger: 'cron',
            secrets: [cfg.STRIPE_SECRET_KEY],
          },
          () => syncStripeCustomers(sb, tn.id, cfg.STRIPE_SECRET_KEY!, cfg.STRIPE_ACCOUNT_ID),
          // Mismos campos que la ruta manual, y la MISMA regla: una lista truncada por presupuesto
          // de tiempo no es un éxito. Si se guardara como 'ok', el panel diría que la base de
          // clientes está al día cuando falta historial por leer.
          (r) => ({
            rowsWritten: r.rows.length,
            failures: r.truncated
              ? ['Stripe tenía más páginas por leer de las que caben en una ejecución: se completará en la siguiente.']
              : [],
            detail: { emparejados: r.matched, sinEmparejar: r.unmatched, truncado: r.truncated },
          })
        )
      } catch (e) {
        porSubcuenta[tn.slug] = {
          error: e instanceof Error ? e.message : 'Error al sincronizar',
          // Otra ejecución ya estaba en marcha: no es un fallo, es el candado funcionando.
          omitida: e instanceof SyncBusyError,
        }
      }
    }
    return NextResponse.json({ ok: true, tenants: porSubcuenta })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al sincronizar con Stripe'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
