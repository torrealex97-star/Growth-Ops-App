// Cotejo de pagos Stripe vs. cobros internos — extraído de
// app/api/[tenant]/evergreen/settings/integraciones/stripe-reconciliation/route.ts para que la
// misma lógica (sin duplicarla) alimente tanto el widget de "Revisar pagos" de Configuración ›
// Integraciones como la pestaña Finanzas › Cobros & Conciliación.
import type { SupabaseClient } from '@supabase/supabase-js'

export type StripeIntent = {
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

export type StripeReconciliationRow = {
  paymentId: string
  chargeId: string | null
  createdAt: string
  amount: number
  currency: string
  providerStatus: string
  refundedAmount: number
  email: string | null
  customer: string | null
  saleId: string | null
  collectionId: string | null
  internalAmount: number | null
  reconciliation: 'matched' | 'probable' | 'mismatch' | 'missing'
}

export type StripeReconciliationResult = {
  rows: StripeReconciliationRow[]
  summary: { total: number; matched: number; probable: number; mismatch: number; missing: number }
}

export async function reconcileStripePayments(
  sb: SupabaseClient,
  tenantId: string,
  stripeSecretKey: string,
  stripeAccountId?: string | null
): Promise<StripeReconciliationResult> {
  const query = new URLSearchParams({ limit: '100' })
  query.append('expand[]', 'data.latest_charge')
  const stripeRes = await fetch(`https://api.stripe.com/v1/payment_intents?${query}`, {
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      ...(stripeAccountId ? { 'Stripe-Account': stripeAccountId } : {}),
    },
    cache: 'no-store',
  })
  const stripeJson = (await stripeRes.json().catch(() => ({}))) as { data?: StripeIntent[]; error?: { message?: string } }
  if (!stripeRes.ok) {
    throw new Error(stripeJson.error?.message || 'Stripe no respondió correctamente.')
  }

  const intents = stripeJson.data ?? []
  const { data: collections, error } = await sb
    .from('collections')
    .select('id,sale_id,gross_amount,status,payment_reference,payment_provider,payment_method,collected_at,sales(contacts(full_name,email))')
    .eq('tenant_id', tenantId)
    .order('collected_at', { ascending: false })
    .limit(1000)
  if (error) throw new Error(error.message)

  const rows: StripeReconciliationRow[] = intents
    .filter((intent) => {
      const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
      return intent.status === 'succeeded' || !!charge?.refunded || !!charge?.disputed
    })
    .map((intent) => {
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
      const reconciliation: StripeReconciliationRow['reconciliation'] = !collection
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

  return {
    rows,
    summary: {
      total: rows.length,
      matched: rows.filter((r) => r.reconciliation === 'matched').length,
      probable: rows.filter((r) => r.reconciliation === 'probable').length,
      mismatch: rows.filter((r) => r.reconciliation === 'mismatch').length,
      missing: rows.filter((r) => r.reconciliation === 'missing').length,
    },
  }
}
