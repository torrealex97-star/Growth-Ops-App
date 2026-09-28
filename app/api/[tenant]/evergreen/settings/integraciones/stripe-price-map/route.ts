import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// MAPEO PRICE ID DE STRIPE → PRODUCTO/PLAN INTERNO.
//
// Es la decisión que permite a las ventas borrador (ver lib/finance/stripeSaleDrafts.ts y
// migración 20260928120000_sale_drafts.sql) reconocer QUÉ PRODUCTO es un pago sin adivinar por
// importe: un admin la toma UNA VEZ por cada Price de Stripe que venda, y a partir de ahí cada pago
// futuro con ese Price ID se sugiere solo. No es una fusión ni una sincronización de catálogo: cada
// fila es una decisión humana explícita.

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireFinanceAdmin(tenantSlug: string) {
  const session = await requireTenant(tenantSlug)
  if ('error' in session) return session
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return { error: NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 }) }
  }
  return session
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireFinanceAdmin(tenant)
  if ('error' in session) return session.error

  const sb = serviceClient()
  const { data, error } = await sb
    .from('stripe_price_map')
    .select('id, stripe_price_id, product_id, payment_plan_id, created_at, products(name), payment_plans(name)')
    .eq('tenant_id', session.tenantId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ mapeos: data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireFinanceAdmin(tenant)
  if ('error' in session) return session.error

  const body = (await req.json().catch(() => ({}))) as {
    stripePriceId?: string
    productId?: string
    paymentPlanId?: string
  }
  const stripePriceId = body.stripePriceId?.trim()
  if (!stripePriceId || !body.productId || !body.paymentPlanId) {
    return NextResponse.json({ error: 'Faltan stripePriceId, productId o paymentPlanId' }, { status: 400 })
  }

  const sb = serviceClient()
  const [product, plan] = await Promise.all([
    sb.from('products').select('id').eq('tenant_id', session.tenantId).eq('id', body.productId).maybeSingle(),
    sb.from('payment_plans').select('id').eq('tenant_id', session.tenantId).eq('id', body.paymentPlanId).maybeSingle(),
  ])
  if (!product.data) return NextResponse.json({ error: 'Ese producto no es de esta subcuenta' }, { status: 400 })
  if (!plan.data) return NextResponse.json({ error: 'Ese plan de pago no es de esta subcuenta' }, { status: 400 })

  const { data, error } = await sb
    .from('stripe_price_map')
    .upsert(
      {
        tenant_id: session.tenantId,
        stripe_price_id: stripePriceId,
        product_id: body.productId,
        payment_plan_id: body.paymentPlanId,
        created_by: session.userId,
      },
      { onConflict: 'tenant_id,stripe_price_id' }
    )
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, id: data.id })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireFinanceAdmin(tenant)
  if ('error' in session) return session.error

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta el id del mapeo' }, { status: 400 })

  const sb = serviceClient()
  const { error } = await sb.from('stripe_price_map').delete().eq('tenant_id', session.tenantId).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
