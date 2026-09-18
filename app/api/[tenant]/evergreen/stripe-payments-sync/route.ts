import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'
import { syncStripePayments } from '@/lib/finance/stripePaymentsSync'

export const runtime = 'nodejs'
export const maxDuration = 60

// SYNC MANUAL del espejo de pagos de Stripe (fuente primaria de Cash Collected).
// Mismo patrón que stripe-reconciliation y stripe-customers: usuario admin/director/cobros,
// config de la subcuenta (la clave de una no puede leer la cuenta de otra), y registro de la
// corrida en integration_sync_runs para que el panel diga la verdad (incluido `truncated`:
// media lista NO es un éxito). No está en vercel.json a propósito — mismo motivo que
// stripe-customers (plan Hobby, crons limitados): se lanza desde Integraciones › Stripe.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: user } = await sb.from('users').select('roles(key)').eq('id', auth.userId).single()
  const role = (user?.roles as { key?: string } | null)?.key
  if (!['admin', 'director', 'cobros'].includes(role || '')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const cfg = await getTenantConfigWithFallback(auth.tenantId, true)
  if (!cfg.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe no está configurado en esta subcuenta.' }, { status: 400 })
  }

  try {
    const result = await recordSyncRun(
      sb,
      {
        tenantId: auth.tenantId,
        provider: 'stripe',
        job: 'stripe-payments',
        trigger: 'manual',
        secrets: [cfg.STRIPE_SECRET_KEY],
      },
      () =>
        syncStripePayments(sb, auth.tenantId, cfg.STRIPE_SECRET_KEY!, cfg.STRIPE_ACCOUNT_ID, {
          // Presupuesto de lambda: si no cabe todo, `truncated` lo dice y la siguiente
          // pasada continúa (el upsert es idempotente).
          deadline: Date.now() + 45_000,
        }),
      (r) => ({
        rowsWritten: r.written,
        failures: r.truncated
          ? ['Stripe tenía más pagos por leer de los que caben en una ejecución: pulsa de nuevo para continuar.']
          : [],
        detail: { pagos: r.written, devueltos: r.refunded, paginas: r.pages, truncado: r.truncated },
      })
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    if (e instanceof SyncBusyError) {
      return NextResponse.json(
        { ok: false, busy: true, message: 'Ya hay una sincronización en marcha.' },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Stripe no respondió correctamente.' },
      { status: 502 }
    )
  }
}
