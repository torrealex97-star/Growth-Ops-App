import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { reconcileStripePayments } from '@/lib/finance/stripeReconciliation'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: user } = await sb.from('users').select('roles(key)').eq('id', auth.userId).single()
  const role = (user?.roles as { key?: string } | null)?.key
  if (!['admin', 'director', 'cobros'].includes(role || '')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const cfg = await getTenantConfigWithFallback(auth.tenantId)
  if (!cfg.STRIPE_SECRET_KEY) return NextResponse.json({ error: 'Stripe no está configurado.' }, { status: 400 })

  try {
    const result = await reconcileStripePayments(sb, auth.tenantId, cfg.STRIPE_SECRET_KEY, cfg.STRIPE_ACCOUNT_ID)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Stripe no respondió correctamente.' }, { status: 502 })
  }
}
