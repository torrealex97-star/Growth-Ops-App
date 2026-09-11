import { createClient } from '@supabase/supabase-js'
import { searchAllOrders, showOrder } from './client'

// Identificador de comercio en SeQura — es una cuenta real de terceros, no una marca:
// configúralo con tu propia referencia de comercio SeQura (SEQURA_MERCHANT_REFERENCE).
const MERCHANT_REFERENCE = process.env.SEQURA_MERCHANT_REFERENCE || 'iawinners'

// Mora real = cuota vencida sin pagar (overdue_days > 0), no cuotas futuras
// normales de un pago aplazado (eso simplemente da debt > 0).
function isRealDelinquent(overdueDays: number | null): boolean {
  return (overdueDays ?? 0) > 0
}

export type SyncResult = {
  checked: number
  delinquentFound: number
  upserted: number
  recovered: number
}

export async function syncSequraDelinquents(tenantId: string): Promise<SyncResult> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const orders = (await searchAllOrders(MERCHANT_REFERENCE)).filter((o) => o.status !== 'cancelled')

  let checked = 0
  let delinquentFound = 0
  const delinquentRefs: string[] = []

  for (const order of orders) {
    checked++
    const detail = await showOrder(order.reference)
    if (detail.merchantReference !== MERCHANT_REFERENCE) continue // cinturón y tirantes junto al CHECK de BBDD
    if (!isRealDelinquent(detail.overdueDays)) continue

    delinquentFound++
    delinquentRefs.push(detail.primaryReference)

    const { error } = await sb.from('sequra_delinquent_customers').upsert(
      {
        tenant_id: tenantId,
        order_reference: detail.primaryReference,
        merchant_reference: MERCHANT_REFERENCE,
        customer_name: detail.customerName,
        customer_email: detail.customerEmail,
        product_name: detail.productName,
        order_value: detail.orderValueCents / 100,
        debt_amount: detail.debtCents / 100,
        overdue_days: detail.overdueDays,
        overdue_since: detail.overdueFrom,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,order_reference', ignoreDuplicates: false }
    )
    if (error) throw new Error(`Error guardando ${detail.primaryReference}: ${error.message}`)
  }

  // Filas que ya no están en mora (pagaron) -> recuperado, salvo que el equipo ya las
  // haya marcado como incobrable (esa decisión no se pisa sola).
  let recovered = 0
  const { data: stillPending } = await sb
    .from('sequra_delinquent_customers')
    .select('id, order_reference')
    .eq('tenant_id', tenantId)
    .not('status', 'in', '(recuperado,incobrable)')
  for (const row of stillPending ?? []) {
    if (delinquentRefs.includes(row.order_reference)) continue
    const { error } = await sb
      .from('sequra_delinquent_customers')
      .update({ status: 'recuperado', last_synced_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('tenant_id', tenantId)
    if (!error) recovered++
  }

  return { checked, delinquentFound, upserted: delinquentFound, recovered }
}
