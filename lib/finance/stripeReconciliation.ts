// Cotejo de pagos Stripe vs. cobros internos — extraído de
// app/api/[tenant]/evergreen/settings/integraciones/stripe-reconciliation/route.ts para que la
// misma lógica (sin duplicarla) alimente tanto el widget de "Revisar pagos" de Configuración ›
// Integraciones como la pestaña Finanzas › Cobros & Conciliación.
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripeList } from '@/lib/stripe/client'

export type StripeIntent = {
  id: string
  amount_received: number
  currency: string
  created: number
  status: string
  receipt_email?: string | null
  metadata?: Record<string, string>
  latest_charge?:
    | string
    | {
        id: string
        amount_refunded?: number
        refunded?: boolean
        disputed?: boolean
        billing_details?: { email?: string | null; name?: string | null }
        balance_transaction?: string | { fee?: number } | null
      }
    | null
}

type StripeReconciliationRow = {
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
  platformFee: number | null
  internalProcessingFee: number | null
  reconciliation: 'matched' | 'probable' | 'mismatch' | 'missing'
}

export type StripeReconciliationResult = {
  rows: StripeReconciliationRow[]
  summary: { total: number; matched: number; probable: number; mismatch: number; missing: number }
  /** `true` = quedaban más pagos por leer en Stripe. Un informe a medias tiene que decir que lo es. */
  truncated: boolean
}

export async function reconcileStripePayments(
  sb: SupabaseClient,
  tenantId: string,
  stripeSecretKey: string,
  stripeAccountId?: string | null
): Promise<StripeReconciliationResult> {
  const query = new URLSearchParams({ limit: '100' })
  query.append('expand[]', 'data.latest_charge')
  query.append('expand[]', 'data.latest_charge.balance_transaction')
  // PAGINADO (antes: una única página de 100). Con una sola página, un pago sin cobro interno más
  // antiguo que los 100 últimos no aparecía como descuadre: aparecía como si no existiera, y la
  // conciliación daba por cuadrado lo que nunca había mirado.
  const { items: intents, truncated } = await stripeList<StripeIntent>('payment_intents', query, {
    secretKey: stripeSecretKey,
    accountId: stripeAccountId,
  })

  // Cobros internos a cotejar. Antes se pedían los 1.000 más recientes y se buscaba dentro: al
  // paginar los pagos de Stripe (que ahora pueden ser años de historial), un pago cuyo cobro interno
  // quedara fuera de esos 1.000 se habría reportado como "sin registrar", y registrarlo otra vez
  // duplicaría la facturación. Se consulta por las referencias y ventas QUE APARECEN, en lotes.
  const refsBuscadas = new Set<string>()
  const salesBuscadas = new Set<string>()
  for (const intent of intents) {
    refsBuscadas.add(intent.id)
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
    const chargeId = charge?.id || (typeof intent.latest_charge === 'string' ? intent.latest_charge : null)
    if (chargeId) refsBuscadas.add(chargeId)
    const saleId = intent.metadata?.sale_id || intent.metadata?.saleId
    if (saleId) salesBuscadas.add(saleId)
  }

  const SELECT_COLLECTIONS =
    'id,sale_id,gross_amount,processing_fee,status,payment_reference,payment_provider,payment_method,collected_at,sales(contacts(full_name,email))'
  const CHUNK = 200
  const collections: Array<Record<string, unknown>> = []
  const chunks = <T>(values: T[]): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < values.length; i += CHUNK) out.push(values.slice(i, i + CHUNK))
    return out
  }
  for (const lote of chunks(Array.from(refsBuscadas))) {
    const { data, error } = await sb
      .from('collections')
      .select(SELECT_COLLECTIONS)
      .eq('tenant_id', tenantId)
      .in('payment_reference', lote)
    if (error) throw new Error(error.message)
    collections.push(...((data ?? []) as unknown as Array<Record<string, unknown>>))
  }
  for (const lote of chunks(Array.from(salesBuscadas))) {
    const { data, error } = await sb
      .from('collections')
      .select(SELECT_COLLECTIONS)
      .eq('tenant_id', tenantId)
      .in('sale_id', lote)
    if (error) throw new Error(error.message)
    collections.push(...((data ?? []) as unknown as Array<Record<string, unknown>>))
  }

  const rows: StripeReconciliationRow[] = intents
    .filter((intent) => {
      const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
      return intent.status === 'succeeded' || !!charge?.refunded || !!charge?.disputed
    })
    .map((intent) => {
      const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
      const refs = [intent.id, typeof intent.latest_charge === 'string' ? intent.latest_charge : charge?.id].filter(
        Boolean
      )
      const byReference = collections.find((c) => c.payment_reference && refs.includes(c.payment_reference as string))
      const saleId = intent.metadata?.sale_id || intent.metadata?.saleId || null
      const amount = intent.amount_received / 100
      const bySaleAndAmount =
        !byReference && saleId
          ? collections.find((c) => c.sale_id === saleId && Math.abs(Number(c.gross_amount) - amount) < 0.01)
          : null
      const collection = byReference || bySaleAndAmount || null
      const amountMatches = !collection || Math.abs(Number(collection.gross_amount) - amount) < 0.01
      const providerStatus = charge?.disputed ? 'disputed' : charge?.refunded ? 'refunded' : intent.status
      const reconciliation: StripeReconciliationRow['reconciliation'] = !collection
        ? 'missing'
        : !amountMatches || (providerStatus === 'succeeded' && collection.status !== 'collected')
          ? 'mismatch'
          : byReference
            ? 'matched'
            : 'probable'
      const relation = collection?.sales as unknown as {
        contacts?: { full_name?: string; email?: string } | null
      } | null
      const balanceTx = charge && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null
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
        collectionId: (collection?.id as string) || null,
        internalAmount: collection ? Number(collection.gross_amount) : null,
        platformFee: balanceTx?.fee != null ? balanceTx.fee / 100 : null,
        internalProcessingFee: collection ? Number(collection.processing_fee ?? 0) : null,
        reconciliation,
      }
    })

  return {
    rows,
    truncated,
    summary: {
      total: rows.length,
      matched: rows.filter((r) => r.reconciliation === 'matched').length,
      probable: rows.filter((r) => r.reconciliation === 'probable').length,
      mismatch: rows.filter((r) => r.reconciliation === 'mismatch').length,
      missing: rows.filter((r) => r.reconciliation === 'missing').length,
    },
  }
}
