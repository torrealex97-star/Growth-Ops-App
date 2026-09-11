import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'

type StripeIntent = {
  id: string
  amount_received: number
  currency: string
  created: number
  status: string
  receipt_email?: string | null
  metadata?: Record<string, string>
  latest_charge?: string | {
    id: string
    amount_refunded?: number
    refunded?: boolean
    disputed?: boolean
    billing_details?: { email?: string | null; name?: string | null }
  } | null
}

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

  const query = new URLSearchParams({ limit: '100' })
  query.append('expand[]', 'data.latest_charge')
  const stripeRes = await fetch(`https://api.stripe.com/v1/payment_intents?${query}`, {
    headers: {
      Authorization: `Bearer ${cfg.STRIPE_SECRET_KEY}`,
      ...(cfg.STRIPE_ACCOUNT_ID ? { 'Stripe-Account': cfg.STRIPE_ACCOUNT_ID } : {}),
    },
    cache: 'no-store',
  })
  const stripeJson = await stripeRes.json().catch(() => ({})) as { data?: StripeIntent[]; error?: { message?: string } }
  if (!stripeRes.ok) return NextResponse.json({ error: stripeJson.error?.message || 'Stripe no respondió correctamente.' }, { status: 502 })

  const intents = stripeJson.data ?? []
  const { data: collections, error } = await sb
    .from('collections')
    .select('id,sale_id,gross_amount,status,payment_reference,payment_provider,payment_method,collected_at,sales(contacts(full_name,email))')
    .eq('tenant_id', auth.tenantId)
    .order('collected_at', { ascending: false })
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = intents.filter((intent) => {
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
    return intent.status === 'succeeded' || !!charge?.refunded || !!charge?.disputed
  }).map((intent) => {
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
    const refs = [intent.id, typeof intent.latest_charge === 'string' ? intent.latest_charge : charge?.id].filter(Boolean)
    const byReference = collections?.find((c) => c.payment_reference && refs.includes(c.payment_reference))
    const saleId = intent.metadata?.sale_id || intent.metadata?.saleId || null
    const amount = intent.amount_received / 100
    const bySaleAndAmount = !byReference && saleId
      ? collections?.find((c) => c.sale_id === saleId && Math.abs(Number(c.gross_amount) - amount) < 0.01)
      : null
    const collection = byReference || bySaleAndAmount || null
    const amountMatches = !collection || Math.abs(Number(collection.gross_amount) - amount) < 0.01
    const providerStatus = charge?.disputed ? 'disputed' : charge?.refunded ? 'refunded' : intent.status
    const reconciliation = !collection
      ? 'missing'
      : !amountMatches || (providerStatus === 'succeeded' && collection.status !== 'collected')
        ? 'mismatch'
        : byReference ? 'matched' : 'probable'
    const relation = collection?.sales as unknown as { contacts?: { full_name?: string; email?: string } | null } | null
    return {
      paymentId: intent.id,
      chargeId: charge?.id || (typeof intent.latest_charge === 'string' ? intent.latest_charge : null),
      createdAt: new Date(intent.created * 1000).toISOString(),
      amount,
      currency: intent.currency.toUpperCase(),
      providerStatus,
      refundedAmount: Number(charge?.amount_refunded || 0) / 100,
      email: intent.receipt_email || charge?.billing_details?.email || relation?.contacts?.email || null,
      customer: charge?.billing_details?.name || relation?.contacts?.full_name || null,
      saleId,
      collectionId: collection?.id || null,
      internalAmount: collection ? Number(collection.gross_amount) : null,
      reconciliation,
    }
  })

  return NextResponse.json({
    rows,
    summary: {
      total: rows.length,
      matched: rows.filter((r) => r.reconciliation === 'matched').length,
      probable: rows.filter((r) => r.reconciliation === 'probable').length,
      mismatch: rows.filter((r) => r.reconciliation === 'mismatch').length,
      missing: rows.filter((r) => r.reconciliation === 'missing').length,
    },
  })
}
