import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { readPaymentEvidence } from '@/lib/stripe/payment-evidence'
import { suggestPayment, type PaymentEvidence } from '@/lib/sales/payment-recognition'
import { readPaymentInbox } from '@/lib/sales/payment-inbox'
import { canViewPaymentInbox } from '@/lib/sales/payment-inbox-access'
import { resolveByPriceId } from '@/lib/sales/priceRecognition'
import { planCuotasDeVenta, type CobroPlanCuotas, type CuotaReal } from '@/lib/sales/plan-cuotas'

export const runtime = 'nodejs'
export const maxDuration = 60
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  if (!canViewPaymentInbox(session.role, session.isSuperAdmin)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const paymentId = req.nextUrl.searchParams.get('payment')
    // The shared list does not broaden the existing registration form's write scope.
    if (paymentId && session.role === 'setter' && !session.isSuperAdmin)
      return NextResponse.json(
        { error: 'Puedes consultar la bandeja. Un administrador o closer debe registrar el cobro.' },
        { status: 403 }
      )
    const rows =
      paymentId && session.role === 'closer' && !session.isSuperAdmin
        ? await readPaymentInbox(sb, session.tenantId, session.userId)
        : await readPaymentInbox(sb, session.tenantId, null)
    if (paymentId) {
      const payment = rows.find((r) => r.payment_id === paymentId)
      if (!payment)
        return NextResponse.json({ error: 'El cobro ya está registrado o no tienes acceso.' }, { status: 404 })
      const [products, plans, sales] = await Promise.all([
        sb
          .from('products')
          .select('id,name')
          .eq('tenant_id', session.tenantId)
          .eq('is_active', true)
          .order('name')
          .limit(500),
        sb
          .from('payment_plans')
          .select('id,name,product_id,gross_price,number_of_payments,method')
          .eq('tenant_id', session.tenantId)
          .eq('is_active', true)
          .order('name')
          .limit(500),
        payment.contactId
          ? sb
              .from('sales')
              .select(
                'id,sale_date,gross_amount,closer_id,product_id,payment_plan_id,installments_count,installments_start_date,products(name),payment_plans(method),collections(gross_amount,status,expected_installment_id,collected_at)'
              )
              .eq('tenant_id', session.tenantId)
              .eq('contact_id', payment.contactId)
              .eq('status', 'active')
              .order('sale_date', { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (products.error || plans.error || sales.error) throw new Error('No se pudieron leer las opciones')
      const visibleSales =
        session.role === 'closer' && !session.isSuperAdmin
          ? (sales.data ?? []).filter((s) => s.closer_id === session.userId)
          : (sales.data ?? [])

      let evidence: PaymentEvidence = {
        priceId: null,
        subscriptionId: null,
        recurring: false,
        firstPayment: false,
        nextPaymentDate: null,
        subscriptionStatus: null,
        cancelAtPeriodEnd: false,
        warning: 'Stripe no está configurado para reconocer este cobro.',
      }
      const cfg = await getTenantConfigWithFallback(session.tenantId, true)
      if (cfg.STRIPE_SECRET_KEY)
        evidence = await readPaymentEvidence(paymentId, {
          secretKey: cfg.STRIPE_SECRET_KEY,
          accountId: cfg.STRIPE_ACCOUNT_ID,
        })
      let suggestion: { productId: string; paymentPlanId: string } | null = null
      if (evidence.priceId) {
        const { data: mapRows, error: mapError } = await sb
          .from('stripe_price_map')
          .select('stripe_price_id,product_id,payment_plan_id')
          .eq('tenant_id', session.tenantId)
          .eq('stripe_price_id', evidence.priceId)
          .limit(2)
        if (mapError) evidence.warning = 'No se pudo consultar la correspondencia de productos. Reintenta.'
        else if (mapRows?.length === 1)
          suggestion = resolveByPriceId(
            evidence.priceId,
            mapRows.map((r) => ({
              stripePriceId: r.stripe_price_id,
              productId: r.product_id,
              paymentPlanId: r.payment_plan_id,
            }))
          )
      }
      // Siguiente cuota pendiente por venta, con el calendario canónico (planCuotasDeVenta):
      // real si la venta tiene sale_expected_installments, derivada (FIFO) si no. Una sola
      // consulta acotada a las ventas visibles; si falla se corta el GET (no se sugiere con
      // un calendario a medias).
      const saleIds = visibleSales.map((s) => s.id)
      const cuotasReales = saleIds.length
        ? await sb.from('sale_expected_installments').select('*').in('sale_id', saleIds).order('installment_number')
        : { data: [], error: null as null }
      if (cuotasReales.error) throw new Error('No se pudo leer el calendario de cuotas')
      const cuotasPorVenta = new Map<string, CuotaReal[]>()
      for (const cuota of cuotasReales.data ?? []) {
        const lista = cuotasPorVenta.get(cuota.sale_id) ?? []
        lista.push(cuota)
        cuotasPorVenta.set(cuota.sale_id, lista)
      }
      const enrichedSales = visibleSales.map((s) => {
        const cobros: CobroPlanCuotas[] = (s.collections ?? []).map((c) => ({
          status: String(c.status ?? ''),
          gross_amount: Number(c.gross_amount ?? 0),
          collected_at: String(c.collected_at ?? ''),
          expected_installment_id: c.expected_installment_id ?? null,
        }))
        const planVenta = (plans.data ?? []).find((p) => p.id === s.payment_plan_id) ?? null
        const planDeCuotas = planCuotasDeVenta(cuotasPorVenta.get(s.id) ?? [], cobros, {
          grossAmount: Number(s.gross_amount),
          saleDate: s.sale_date.slice(0, 10),
          paymentPlan: planVenta
            ? { number_of_payments: planVenta.number_of_payments, method: planVenta.method }
            : null,
          installmentsCount: s.installments_count,
          installmentsStartDate: s.installments_start_date,
        })
        const siguiente = planDeCuotas.cuotas.find((c) => c.estado !== 'collected')
        return {
          ...s,
          collected: cobros.filter((c) => c.status === 'collected').reduce((sum, c) => sum + c.gross_amount, 0),
          method:
            (Array.isArray(s.payment_plans)
              ? s.payment_plans[0]
              : (s.payment_plans as { method: string | null } | null)
            )?.method ?? null,
          nextInstallment: siguiente
            ? {
                number: siguiente.numero,
                total: planDeCuotas.cuotas.length,
                amount: siguiente.bruto,
                dueDate: siguiente.vencimiento,
              }
            : null,
        }
      })
      const recognition = suggestPayment(
        evidence,
        suggestion,
        enrichedSales,
        plans.data ?? [],
        Number(payment.amount),
        payment.paid_at
      )

      return NextResponse.json({
        payment,
        products: products.data,
        plans: plans.data,
        sales: enrichedSales,
        recognition,
        suggestedProductId: suggestion?.productId ?? null,
        suggestedPaymentPlanId: suggestion?.paymentPlanId ?? null,
      })
    }
    return NextResponse.json({ rows, total: rows.length })
  } catch {
    return NextResponse.json({ error: 'No se pudieron comprobar los cobros pendientes. Reintenta.' }, { status: 503 })
  }
}
