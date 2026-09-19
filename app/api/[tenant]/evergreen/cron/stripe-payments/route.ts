import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncStripePayments } from '@/lib/finance/stripePaymentsSync'
import { getTenantConfigWithFallback } from '@/lib/config'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'

export const runtime = 'nodejs'
export const maxDuration = 60

// CRON del espejo de pagos de Stripe (fuente primaria de Cash Collected). Mismo patrón que
// stripe-customers: GET global protegido por CRON_SECRET que recorre TODAS las subcuentas activas,
// porque el planificador (GitHub Actions, igual que los otros 7 crons delegados) pega a una URL
// estática y la autorización por Bearer es la que evita que cualquiera dispare la ingesta.
//
// Por qué existe: la primera carga del espejo (backfill histórico) y el refresco diario de
// `refunded_amount`/`status` no pueden depender de que alguien pulse el botón de Integraciones.
// El webhook cubre el tiempo real de los pagos NUEVOS; este cron es el pull que completa el
// histórico y repara lo que el push pudo perder. Sigue SIN estar en vercel.json (plan Hobby:
// ya hay 2 crons y un tercero desplazaria Meta o recordatorios) — se ejecuta desde
// .github/workflows/cron-stripe-payments.yml, como el resto de crons delegados.
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
      // cuenta de otra (mismo invariant que stripe-customers).
      const cfg = await getTenantConfigWithFallback(tn.id, true)
      if (!cfg.STRIPE_SECRET_KEY) {
        // Sin clave no es un fallo: esa subcuenta simplemente no usa Stripe.
        porSubcuenta[tn.slug] = { omitida: true, motivo: 'Stripe no está configurado en esta subcuenta' }
        continue
      }
      try {
        porSubcuenta[tn.slug] = await recordSyncRun(
          sb,
          {
            tenantId: tn.id,
            provider: 'stripe',
            job: 'stripe-payments',
            trigger: 'cron',
            secrets: [cfg.STRIPE_SECRET_KEY],
          },
          // Presupuesto por subcuenta para no pisar las demás: si Stripe tiene más historial del
          // que cabe, `truncated` lo declara y la siguiente ejecución continúa (upsert idempotente).
          () => syncStripePayments(sb, tn.id, cfg.STRIPE_SECRET_KEY!, cfg.STRIPE_ACCOUNT_ID, { deadline: Date.now() + 30_000 }),
          (r) => ({
            rowsWritten: r.written,
            failures: r.truncated
              ? ['Stripe tenía más pagos por leer de los que caben en una ejecución: se completará en la siguiente.']
              : [],
            detail: { pagos: r.written, devueltos: r.refunded, paginas: r.pages, truncado: r.truncated },
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
