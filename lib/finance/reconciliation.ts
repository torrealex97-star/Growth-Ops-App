// Conciliación (Finanzas › Cobros & Conciliación): cruza cada cobro/devolución interno con el
// registro de su plataforma de cobro (Stripe, seQura, transferencia/Bizum/PayPal manual) y
// detecta descuadres. Reutiliza reconcileStripePayments (lib/finance/stripeReconciliation.ts) —
// no reimplementa el cotejo de Stripe, solo añade el resto de plataformas y las cruza todas
// en una sola vista.
import type { SupabaseClient } from '@supabase/supabase-js'
import { reconcileStripePayments } from './stripeReconciliation'
import { formatCurrency } from '@/lib/utils'

type ConciliacionPlatform = 'stripe' | 'sequra' | 'transferencia' | 'bizum' | 'paypal' | 'otro'
export type ConciliacionStatus = 'conciliado' | 'descuadre' | 'pendiente'

export type ConciliacionRow = {
  id: string
  platform: ConciliacionPlatform
  date: string | null
  amount: number
  customer: string | null
  email: string | null
  saleId: string | null
  collectionId: string | null
  internalAmount: number | null
  status: ConciliacionStatus
  detail: string
}

type CollectionForReconciliation = {
  id: string
  sale_id: string
  gross_amount: number | string
  status: string
  payment_method: string | null
  collected_at: string | null
  sales: { contacts: { full_name: string | null; email: string | null } | null } | null
}

type RefundForReconciliation = {
  sale_id: string
  refund_date: string | null
  gross_refund_amount: number | string
}

const num = (x: number | string | null | undefined) => Number(x ?? 0)
const daysBetween = (a: string, b: string) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000)

const MANUAL_METHODS = new Set(['transferencia', 'bizum', 'paypal', 'otro'])

export async function buildConciliacion(
  sb: SupabaseClient,
  tenantId: string,
  opts: { stripeSecretKey?: string | null; stripeAccountId?: string | null }
): Promise<{ rows: ConciliacionRow[]; summary: Record<ConciliacionStatus, number> & { total: number } }> {
  const [
    { data: collections, error: collErr },
    { data: refunds, error: refErr },
    { data: manualRecords, error: manualErr },
  ] = await Promise.all([
    sb
      .from('collections')
      .select('id,sale_id,gross_amount,status,payment_method,collected_at,sales(contacts(full_name,email))')
      .eq('tenant_id', tenantId)
      .order('collected_at', { ascending: false })
      .limit(1000),
    sb.from('refunds').select('sale_id,refund_date,gross_refund_amount').eq('tenant_id', tenantId).limit(1000),
    sb
      .from('manual_platform_records')
      .select('id,platform,reference,amount,transacted_at,matched_collection_id,notes')
      .eq('tenant_id', tenantId)
      .order('transacted_at', { ascending: false })
      .limit(1000),
  ])
  if (collErr) throw new Error(collErr.message)
  if (refErr) throw new Error(refErr.message)
  if (manualErr) throw new Error(manualErr.message)

  const allCollections = (collections || []) as unknown as CollectionForReconciliation[]
  const allRefunds = (refunds || []) as RefundForReconciliation[]
  const refundsBySale = new Map<string, RefundForReconciliation[]>()
  for (const r of allRefunds) {
    const arr = refundsBySale.get(r.sale_id) || []
    arr.push(r)
    refundsBySale.set(r.sale_id, arr)
  }

  const rows: ConciliacionRow[] = []

  // --- Stripe: reutiliza el cotejo ya existente (mismo que en Configuración › Integraciones) ---
  if (opts.stripeSecretKey) {
    try {
      const stripe = await reconcileStripePayments(sb, tenantId, opts.stripeSecretKey, opts.stripeAccountId)
      for (const r of stripe.rows) {
        let status: ConciliacionStatus =
          r.reconciliation === 'matched' || r.reconciliation === 'probable' ? 'conciliado' : 'descuadre'
        let detail =
          r.reconciliation === 'matched'
            ? 'Cotejado por referencia de pago'
            : r.reconciliation === 'probable'
              ? 'Coincidencia probable (venta + importe)'
              : r.reconciliation === 'missing'
                ? 'Cobro sin venta asociada en la app'
                : 'Importe distinto al registrado internamente'
        // Devolución en Stripe sin reflejar en Devoluciones internas.
        if (r.providerStatus === 'refunded') {
          const saleRefunds = r.saleId ? refundsBySale.get(r.saleId) || [] : []
          const hasRefund = saleRefunds.some((rf) => Math.abs(num(rf.gross_refund_amount) - r.refundedAmount) < 0.5)
          if (!hasRefund) {
            status = 'descuadre'
            detail = 'Devolución en Stripe no reflejada en Devoluciones'
          }
        }
        // Comisión de pasarela (fee de Stripe) no registrada en el cobro interno — solo se
        // comprueba sobre cobros ya cotejados, con tolerancia de 0.05€ para no marcar falsos
        // descuadres por redondeo entre céntimos de Stripe y el processing_fee introducido a mano.
        if (status === 'conciliado' && r.platformFee != null && r.platformFee > 0.01) {
          const registered = r.internalProcessingFee ?? 0
          if (registered < r.platformFee - 0.05) {
            status = 'descuadre'
            detail = `Comisión de pasarela no registrada (Stripe: ${formatCurrency(r.platformFee)} · interno: ${formatCurrency(registered)})`
          }
        }
        rows.push({
          id: `stripe_${r.paymentId}`,
          platform: 'stripe',
          date: r.createdAt,
          amount: r.amount,
          customer: r.customer,
          email: r.email,
          saleId: r.saleId,
          collectionId: r.collectionId,
          internalAmount: r.internalAmount,
          status,
          detail,
        })
      }
    } catch (err) {
      // Si Stripe no responde no bloqueamos el resto de plataformas — se refleja como fila única.
      rows.push({
        id: 'stripe_error',
        platform: 'stripe',
        date: null,
        amount: 0,
        customer: null,
        email: null,
        saleId: null,
        collectionId: null,
        internalAmount: null,
        status: 'pendiente',
        detail: `No se pudo consultar Stripe: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  // --- seQura: cruza cobros internos con la deuda real sincronizada (sequra_delinquent_customers,
  // misma fuente que Finanzas › Morosidad — no se vuelve a llamar a la API en vivo por pedido). ---
  const sequraCollections = allCollections.filter((c) => c.payment_method === 'sequra')
  if (sequraCollections.length > 0) {
    const { data: delinquents, error: delErr } = await sb
      .from('sequra_delinquent_customers')
      .select('customer_email,debt_amount,status')
      .eq('tenant_id', tenantId)
    if (delErr) throw new Error(delErr.message)
    const debtByEmail = new Map<string, { debt: number; status: string }>()
    for (const d of delinquents || []) {
      if (!d.customer_email) continue
      debtByEmail.set(d.customer_email.toLowerCase(), { debt: num(d.debt_amount), status: d.status })
    }
    for (const c of sequraCollections) {
      const email = c.sales?.contacts?.email?.toLowerCase() || null
      const delinquent = email ? debtByEmail.get(email) : undefined
      const hasOpenDebt =
        !!delinquent && delinquent.debt > 0 && !['recuperado', 'incobrable'].includes(delinquent.status)
      rows.push({
        id: `sequra_${c.id}`,
        platform: 'sequra',
        date: c.collected_at,
        amount: num(c.gross_amount),
        customer: c.sales?.contacts?.full_name || null,
        email,
        saleId: c.sale_id,
        collectionId: c.id,
        internalAmount: num(c.gross_amount),
        status: hasOpenDebt ? 'descuadre' : 'conciliado',
        detail: hasOpenDebt
          ? `seQura reporta deuda pendiente (${formatCurrency(delinquent!.debt)}) para este cliente`
          : 'Sin deuda vencida reportada por seQura',
      })
    }
  }

  // --- Transferencia/Bizum/PayPal/Otro: cruza cobros internos con la carga manual del extracto. ---
  const manualCollectionsByMethod = new Map<string, CollectionForReconciliation[]>()
  for (const c of allCollections) {
    if (!c.payment_method || !MANUAL_METHODS.has(c.payment_method)) continue
    const arr = manualCollectionsByMethod.get(c.payment_method) || []
    arr.push(c)
    manualCollectionsByMethod.set(c.payment_method, arr)
  }
  const usedRecordIds = new Set<string>()
  for (const [method, cols] of Array.from(manualCollectionsByMethod.entries())) {
    const candidates = (manualRecords || []).filter((m) => m.platform === method)
    for (const c of cols) {
      // Un enlace explícito (matched_collection_id, fijado a mano en la carga del extracto) tiene
      // prioridad sobre el cotejo por importe+fecha — sin esto, dos cobros con importe y fecha
      // parecidos podían cotejarse con el registro equivocado aunque el usuario ya hubiera fijado
      // el enlace correcto.
      const match =
        candidates.find((m) => !usedRecordIds.has(m.id) && m.matched_collection_id === c.id) ??
        candidates.find(
          (m) =>
            !usedRecordIds.has(m.id) &&
            Math.abs(num(m.amount) - num(c.gross_amount)) < 0.01 &&
            (!c.collected_at || daysBetween(m.transacted_at, c.collected_at) <= 3)
        )
      if (match) usedRecordIds.add(match.id)
      rows.push({
        id: `manual_${c.id}`,
        platform: method as ConciliacionPlatform,
        date: c.collected_at,
        amount: num(c.gross_amount),
        customer: c.sales?.contacts?.full_name || null,
        email: c.sales?.contacts?.email || null,
        saleId: c.sale_id,
        collectionId: c.id,
        internalAmount: num(c.gross_amount),
        status: match ? 'conciliado' : 'descuadre',
        detail: match ? 'Cotejado con extracto cargado manualmente' : 'Cobro sin registro de plataforma cargado',
      })
    }
  }
  // Registros manuales cargados que no casaron con ningún cobro interno (venta sin cobro / carga duplicada).
  for (const m of manualRecords || []) {
    if (usedRecordIds.has(m.id)) continue
    rows.push({
      id: `manual_orphan_${m.id}`,
      platform: m.platform as ConciliacionPlatform,
      date: m.transacted_at,
      amount: num(m.amount),
      customer: null,
      email: null,
      saleId: null,
      collectionId: null,
      internalAmount: null,
      status: 'descuadre',
      detail: m.notes
        ? `Registro de plataforma sin cobro asociado — ${m.notes}`
        : 'Registro de plataforma sin cobro asociado',
    })
  }

  const summary = {
    total: rows.length,
    conciliado: rows.filter((r) => r.status === 'conciliado').length,
    descuadre: rows.filter((r) => r.status === 'descuadre').length,
    pendiente: rows.filter((r) => r.status === 'pendiente').length,
  }

  return { rows, summary }
}
