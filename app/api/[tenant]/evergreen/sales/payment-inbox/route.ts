import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { stripeGet } from '@/lib/stripe/client'
import { readPaymentInbox } from '@/lib/sales/payment-inbox'
import { firstInvoiceLinePriceId, resolveByPriceId } from '@/lib/sales/priceRecognition'

export const runtime = 'nodejs'
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  if (!session.isSuperAdmin && !['admin', 'director', 'closer'].includes(session.role ?? '')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const rows = await readPaymentInbox(
      sb,
      session.tenantId,
      session.role === 'closer' && !session.isSuperAdmin ? session.userId : null
    )
    const paymentId = req.nextUrl.searchParams.get('payment')
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
              .select('id,sale_date,gross_amount,closer_id,products(name)')
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

      // RECONOCIMIENTO POR PRICE ID (best-effort): si el cobro viene de una factura (suscripción/
      // plan de cuotas), su Price ID puede estar mapeado a un producto/plan en Integraciones. Un
      // Payment Link de un solo pago sin factura no trae esta señal, y un fallo aquí NUNCA rompe
      // la bandeja — el admin sigue pudiendo elegir a mano, igual que hoy.
      let suggestion: { productId: string; paymentPlanId: string } | null = null
      try {
        const cfg = await getTenantConfigWithFallback(session.tenantId, true)
        if (cfg.STRIPE_SECRET_KEY) {
          const intent = await stripeGet<{ invoice?: unknown }>(
            `payment_intents/${encodeURIComponent(paymentId)}`,
            new URLSearchParams([['expand[]', 'invoice']]),
            { secretKey: cfg.STRIPE_SECRET_KEY, accountId: cfg.STRIPE_ACCOUNT_ID }
          )
          const priceId = firstInvoiceLinePriceId(intent.invoice)
          if (priceId) {
            const { data: mapRows } = await sb
              .from('stripe_price_map')
              .select('stripe_price_id, product_id, payment_plan_id')
              .eq('tenant_id', session.tenantId)
              .eq('stripe_price_id', priceId)
              .limit(1)
            suggestion = resolveByPriceId(
              priceId,
              (mapRows ?? []).map((r) => ({
                stripePriceId: r.stripe_price_id,
                productId: r.product_id,
                paymentPlanId: r.payment_plan_id,
              }))
            )
          }
        }
      } catch {
        // Best-effort: sin sugerencia, la bandeja funciona exactamente igual que antes de esto.
      }

      return NextResponse.json({
        payment,
        products: products.data,
        plans: plans.data,
        sales: visibleSales,
        suggestedProductId: suggestion?.productId ?? null,
        suggestedPaymentPlanId: suggestion?.paymentPlanId ?? null,
      })
    }
    return NextResponse.json({ rows, total: rows.length })
  } catch {
    return NextResponse.json({ error: 'No se pudieron comprobar los cobros pendientes. Reintenta.' }, { status: 503 })
  }
}
