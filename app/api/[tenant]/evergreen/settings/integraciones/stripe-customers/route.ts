import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { syncStripeCustomers } from '@/lib/finance/stripeCustomers'

export const runtime = 'nodejs'

async function requireFinanceRole(tenant: string) {
  const auth = await requireTenant(tenant)
  if ('error' in auth) return { ok: false as const, res: auth.error }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: user } = await sb.from('users').select('roles(key)').eq('id', auth.userId).single()
  const role = (user?.roles as { key?: string } | null)?.key
  if (!['admin', 'director', 'cobros'].includes(role || '')) {
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
    const result = await syncStripeCustomers(auth.sb, auth.tenantId, cfg.STRIPE_SECRET_KEY, cfg.STRIPE_ACCOUNT_ID)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Stripe no respondió correctamente.' },
      { status: 502 }
    )
  }
}
