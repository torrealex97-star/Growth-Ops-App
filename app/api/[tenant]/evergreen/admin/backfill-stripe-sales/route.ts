import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'
export const maxDuration = 300

// Backfill de ventas/cobros desde Stripe para clientes que hoy solo existen en `stripe_customers`
// (sincronizados en Integraciones → Stripe → "Sincronizar clientes") pero no tienen ninguna venta
// registrada en la app. A petición explícita del usuario:
// - Precio por fecha del primer pago real: 1497€ si es anterior a agosto de 2026, 1997€ desde
//   agosto de 2026 en adelante (la venta usa este precio fijo, no el importe exacto de Stripe).
// - Se crea además UN `collection` por cada pago real que Stripe registró para ese cliente (no
//   solo un importe agregado), con el importe REAL de cada cobro — así el conteo de pagos/morosos
//   es exacto. Idempotente: si ya existe un collection con esa referencia de Stripe, se salta.
// - Se omiten los contactos de Stripe que YA tienen alguna venta registrada en la app (evita
//   duplicar ingresos/comisiones de algo ya registrado a mano).
const PRICE_CUTOFF = new Date('2026-08-01T00:00:00Z').getTime()
const PRICE_BEFORE = 1497
const PRICE_FROM = 1997
const PRODUCT_NAME_MATCH = '%women digital closer%'

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

type StripePayment = { reference: string; amount: number; paidAt: string }

async function fetchStripePayments(
  stripeCustomerId: string,
  stripeSecretKey: string,
  stripeAccountId?: string | null
): Promise<StripePayment[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${stripeSecretKey}`,
    ...(stripeAccountId ? { 'Stripe-Account': stripeAccountId } : {}),
  }
  const fetchOpts = { headers, cache: 'no-store' as const, signal: AbortSignal.timeout(15_000) }

  // Facturas pagadas: cubren clientes con suscripción (pagos recurrentes reales, uno por cuota).
  const invQuery = new URLSearchParams({ customer: stripeCustomerId, status: 'paid', limit: '100' })
  const invRes = await fetch(`https://api.stripe.com/v1/invoices?${invQuery}`, fetchOpts)
  const invJson = (await invRes.json().catch(() => ({}))) as {
    data?: Array<{ id: string; amount_paid: number; status_transitions?: { paid_at?: number | null } }>
    error?: { message?: string }
  }
  if (!invRes.ok) throw new Error(invJson.error?.message || 'Stripe no respondió al listar facturas.')
  if ((invJson.data ?? []).length > 0) {
    return (invJson.data ?? []).map((inv) => ({
      reference: `stripe_invoice_${inv.id}`,
      amount: inv.amount_paid / 100,
      paidAt: new Date((inv.status_transitions?.paid_at ?? 0) * 1000).toISOString(),
    }))
  }

  // Sin facturas (pago único sin suscripción): cargos directos.
  const chQuery = new URLSearchParams({ customer: stripeCustomerId, limit: '100' })
  const chRes = await fetch(`https://api.stripe.com/v1/charges?${chQuery}`, fetchOpts)
  const chJson = (await chRes.json().catch(() => ({}))) as {
    data?: Array<{ id: string; paid: boolean; amount: number; created: number }>
    error?: { message?: string }
  }
  if (!chRes.ok) throw new Error(chJson.error?.message || 'Stripe no respondió al listar cargos.')
  return (chJson.data ?? [])
    .filter((c) => c.paid)
    .map((c) => ({
      reference: `stripe_charge_${c.id}`,
      amount: c.amount / 100,
      paidAt: new Date(c.created * 1000).toISOString(),
    }))
}

async function resolveProductId(sb: SupabaseClient, tenantId: string): Promise<string> {
  const { data, error } = await sb
    .from('products')
    .select('id,name')
    .eq('tenant_id', tenantId)
    .ilike('name', PRODUCT_NAME_MATCH)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error(
      `No se encontró ningún producto que coincida con "${PRODUCT_NAME_MATCH}". Créalo antes de continuar.`
    )
  }
  if (data.length > 1) {
    throw new Error(
      `Hay ${data.length} productos que coinciden con "${PRODUCT_NAME_MATCH}" (${data.map((p) => p.name).join(', ')}). Especifica cuál usar.`
    )
  }
  return data[0].id as string
}

async function resolvePaymentPlanId(
  sb: SupabaseClient,
  tenantId: string,
  productId: string,
  grossPrice: number
): Promise<string> {
  const existing = await sb
    .from('payment_plans')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('product_id', productId)
    .eq('gross_price', grossPrice)
    .limit(1)
    .maybeSingle()
  if (existing.data) return existing.data.id as string
  const inserted = await sb
    .from('payment_plans')
    .insert({
      tenant_id: tenantId,
      product_id: productId,
      name: `Stripe (importado) — ${grossPrice}€`,
      code: `stripe_import_${grossPrice}`,
      gross_price: grossPrice,
      number_of_payments: 1,
      is_active: true,
    })
    .select('id')
    .single()
  if (inserted.error) throw new Error(inserted.error.message)
  return inserted.data.id as string
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!auth.isSuperAdmin && !['admin', 'director'].includes(auth.role ?? '')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { ownerEmail?: string; dryRun?: boolean }
  if (!body.ownerEmail) {
    return NextResponse.json({ error: 'Falta ownerEmail (responsable de las ventas importadas)' }, { status: 400 })
  }
  const dryRun = body.dryRun !== false // por defecto true — hay que pedir explícitamente dryRun:false para escribir

  const sb = svc()
  const cfg = await getTenantConfigWithFallback(auth.tenantId)
  if (!cfg.STRIPE_SECRET_KEY) return NextResponse.json({ error: 'Stripe no está configurado.' }, { status: 400 })

  const owner = await sb
    .from('users')
    .select('id,full_name')
    .eq('tenant_id', auth.tenantId)
    .ilike('email', body.ownerEmail)
    .maybeSingle()
  if (!owner.data) {
    return NextResponse.json(
      { error: `No se encontró ningún usuario con email ${body.ownerEmail} en este tenant` },
      { status: 404 }
    )
  }

  let productId: string
  try {
    productId = await resolveProductId(sb, auth.tenantId)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }

  const { data: stripeCustomers, error: scError } = await sb
    .from('stripe_customers')
    .select('stripe_customer_id,contact_id,email,name')
    .eq('tenant_id', auth.tenantId)
    .not('contact_id', 'is', null)
  if (scError) return NextResponse.json({ error: scError.message }, { status: 500 })

  const results = {
    dryRun,
    salesCreated: 0,
    collectionsCreated: 0,
    skippedAlreadyHasSale: 0,
    skippedNoPayments: 0,
    errors: [] as string[],
    preview: [] as Array<{ contactId: string; name: string | null; price: number; payments: number; saleDate: string }>,
  }

  const planCache = new Map<number, string>()
  const getPlanId = async (price: number) => {
    const cached = planCache.get(price)
    if (cached) return cached
    if (dryRun) return 'dry-run'
    const id = await resolvePaymentPlanId(sb, auth.tenantId, productId, price)
    planCache.set(price, id)
    return id
  }

  for (const sc of stripeCustomers ?? []) {
    const contactId = sc.contact_id as string
    const existingSale = await sb
      .from('sales')
      .select('id')
      .eq('tenant_id', auth.tenantId)
      .eq('contact_id', contactId)
      .limit(1)
      .maybeSingle()
    if (existingSale.data) {
      results.skippedAlreadyHasSale++
      continue
    }

    let payments: StripePayment[]
    try {
      payments = await fetchStripePayments(
        sc.stripe_customer_id as string,
        cfg.STRIPE_SECRET_KEY,
        cfg.STRIPE_ACCOUNT_ID
      )
    } catch (err) {
      results.errors.push(`${sc.email || sc.stripe_customer_id}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    if (payments.length === 0) {
      results.skippedNoPayments++
      continue
    }
    payments.sort((a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime())
    const firstPayment = payments[0]
    const price = new Date(firstPayment.paidAt).getTime() >= PRICE_CUTOFF ? PRICE_FROM : PRICE_BEFORE
    const saleDateStr = firstPayment.paidAt.slice(0, 10)
    const refundDeadline = new Date(new Date(firstPayment.paidAt).getTime() + 15 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)

    results.preview.push({
      contactId,
      name: sc.name,
      price,
      payments: payments.length,
      saleDate: saleDateStr,
    })

    if (dryRun) continue

    const planId = await getPlanId(price)
    const insertedSale = await sb
      .from('sales')
      .insert({
        tenant_id: auth.tenantId,
        contact_id: contactId,
        product_id: productId,
        payment_plan_id: planId,
        sale_date: saleDateStr,
        refund_deadline_at: refundDeadline,
        gross_amount: price,
        status: 'active',
        closer_id: owner.data.id,
        created_by: owner.data.id,
        notes: 'Importado automáticamente desde Stripe (backfill)',
      })
      .select('id')
      .single()
    if (insertedSale.error) {
      results.errors.push(`${sc.email || sc.stripe_customer_id}: ${insertedSale.error.message}`)
      continue
    }
    results.salesCreated++
    const saleId = insertedSale.data.id as string

    for (const payment of payments) {
      const already = await sb
        .from('collections')
        .select('id')
        .eq('tenant_id', auth.tenantId)
        .eq('payment_reference', payment.reference)
        .limit(1)
        .maybeSingle()
      if (already.data) continue
      const insertedCollection = await sb.from('collections').insert({
        tenant_id: auth.tenantId,
        sale_id: saleId,
        collected_at: payment.paidAt,
        gross_amount: payment.amount,
        commissionable_amount: payment.amount,
        payment_method: 'stripe',
        payment_provider: 'stripe',
        payment_reference: payment.reference,
        is_confirmed: true,
        // No se marca elegible para comisión: el responsable asignado a la venta importada no es
        // necesariamente quien cerró la venta original — evita generar comisiones incorrectas.
        is_eligible_for_commission: false,
        status: 'collected',
        notes: 'Importado automáticamente desde Stripe (backfill)',
      })
      if (insertedCollection.error) {
        results.errors.push(
          `${sc.email || sc.stripe_customer_id} / ${payment.reference}: ${insertedCollection.error.message}`
        )
        continue
      }
      results.collectionsCreated++
    }
  }

  return NextResponse.json(results)
}
