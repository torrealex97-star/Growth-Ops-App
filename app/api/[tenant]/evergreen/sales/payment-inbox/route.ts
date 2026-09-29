import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { readPaymentInbox } from '@/lib/sales/payment-inbox'

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
      return NextResponse.json({ payment, products: products.data, plans: plans.data, sales: visibleSales })
    }
    return NextResponse.json({ rows, total: rows.length })
  } catch {
    return NextResponse.json({ error: 'No se pudieron comprobar los cobros pendientes. Reintenta.' }, { status: 503 })
  }
}
