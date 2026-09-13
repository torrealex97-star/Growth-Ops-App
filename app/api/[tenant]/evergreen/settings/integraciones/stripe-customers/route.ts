import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { syncStripeCustomers } from '@/lib/finance/stripeCustomers'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'

export const runtime = 'nodejs'

async function requireFinanceRole(tenant: string) {
  const auth = await requireTenant(tenant)
  if ('error' in auth) return { ok: false as const, res: auth.error }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  // `requireTenant` ya resuelve el rol del caller: repetir aquí la misma consulta a `users` era una
  // ida y vuelta extra a la base de datos por petición para obtener exactamente el mismo dato.
  if (!['admin', 'director', 'cobros'].includes(auth.role || '')) {
    return { ok: false as const, res: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return { ok: true as const, sb, tenantId: auth.tenantId }
}

// GET — devuelve el último estado cacheado (sin llamar a Stripe); POST — sincroniza con Stripe.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireFinanceRole(tenant)
  if (!auth.ok) return auth.res

  const { data, error } = await auth.sb
    .from('stripe_customers')
    .select('stripe_customer_id,contact_id,email,name,status,subscription_id,current_period_end,last_synced_at')
    .eq('tenant_id', auth.tenantId)
    .order('status', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rows: data ?? [] })
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireFinanceRole(tenant)
  if (!auth.ok) return auth.res

  const cfg = await getTenantConfigWithFallback(auth.tenantId)
  if (!cfg.STRIPE_SECRET_KEY) return NextResponse.json({ error: 'Stripe no está configurado.' }, { status: 400 })

  try {
    const result = await recordSyncRun(
      auth.sb,
      {
        tenantId: auth.tenantId,
        provider: 'stripe',
        job: 'stripe-customers',
        trigger: 'manual',
        secrets: [cfg.STRIPE_SECRET_KEY],
      },
      () => syncStripeCustomers(auth.sb, auth.tenantId, cfg.STRIPE_SECRET_KEY, cfg.STRIPE_ACCOUNT_ID),
      (r) => ({
        rowsWritten: r.rows.length,
        // Una lista truncada por presupuesto de tiempo NO es un éxito: si se guarda como 'ok', el
        // panel diría que la base de clientes está al día cuando falta historial por leer.
        failures: r.truncated
          ? ['Stripe tenía más páginas por leer de las que caben en una ejecución: vuelve a lanzarlo para completar.']
          : [],
        detail: { clientes: r.rows.length, conContacto: r.matched, sinContacto: r.unmatched, truncado: r.truncated },
      })
    )
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof SyncBusyError) return NextResponse.json({ error: err.message }, { status: 409 })
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Stripe no respondió correctamente.',
        code: (err as { code?: string }).code,
      },
      { status: 502 }
    )
  }
}
