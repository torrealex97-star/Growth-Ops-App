import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { stripeGet } from '@/lib/stripe/client'
import { classifyForBackfill, type BackfillRow } from '@/lib/finance/stripeBackfill'
import { buildCollection, buildSaleFromPayment, type ImportChoice } from '@/lib/finance/stripeImport'
import type { StripeIntent } from '@/lib/finance/stripeReconciliation'

export const runtime = 'nodejs'
export const maxDuration = 120

// Registrar como VENTAS los pagos de Stripe que el informe marca como `registrable`.
//
// Va en una ruta aparte del informe a propósito: el informe sigue siendo de solo lectura y con su
// test que lo garantiza. Escribir es otra cosa y se pide expresamente.
//
// LO QUE NO SE AUTOMATIZA. El producto y el plan de pago los elige la persona: `sales` los exige
// (NOT NULL) y un pago de Stripe no dice a cuál corresponde. Aquí llegan elegidos.

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireFinanceAdmin(tenantSlug: string) {
  const session = await requireTenant(tenantSlug)
  if ('error' in session) return session
  // Escribe ventas y cobros: de ahí salen la facturación y las comisiones.
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return { error: NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 }) }
  }
  return session
}

// GET — productos y planes de pago para poder elegir. Sin esto habría que escribir ids a mano.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireFinanceAdmin(tenant)
  if ('error' in session) return session.error

  const sb = serviceClient()
  const [products, plans] = await Promise.all([
    sb.from('products').select('id,name').eq('tenant_id', session.tenantId).order('name'),
    sb
      .from('payment_plans')
      .select('id,name,method,cash_collection_ratio,gross_price')
      .eq('tenant_id', session.tenantId)
      .order('name'),
  ])
  if (products.error) return NextResponse.json({ error: products.error.message }, { status: 500 })
  if (plans.error) return NextResponse.json({ error: plans.error.message }, { status: 500 })
  return NextResponse.json({ products: products.data ?? [], plans: plans.data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireFinanceAdmin(tenant)
  if ('error' in session) return session.error

  const body = (await req.json().catch(() => ({}))) as {
    paymentIds?: string[]
    productId?: string
    paymentPlanId?: string
  }
  const paymentIds = [...new Set((body.paymentIds ?? []).filter((id) => typeof id === 'string' && id.trim()))]
  if (paymentIds.length === 0) return NextResponse.json({ error: 'No has elegido ningún pago' }, { status: 400 })
  if (paymentIds.length > 200) {
    return NextResponse.json({ error: 'Máximo 200 pagos por tanda' }, { status: 400 })
  }
  if (!body.productId || !body.paymentPlanId) {
    return NextResponse.json({ error: 'Falta elegir producto y plan de pago' }, { status: 400 })
  }

  const sb = serviceClient()

  // El producto y el plan tienen que ser de ESTA subcuenta: con service_role, un id de otra pasaría
  // sin que RLS lo pare, y quedaría una venta apuntando al producto de otro cliente.
  const [product, plan] = await Promise.all([
    sb.from('products').select('id').eq('tenant_id', session.tenantId).eq('id', body.productId).maybeSingle(),
    sb
      .from('payment_plans')
      .select('id,method,cash_collection_ratio')
      .eq('tenant_id', session.tenantId)
      .eq('id', body.paymentPlanId)
      .maybeSingle(),
  ])
  if (!product.data) return NextResponse.json({ error: 'Ese producto no es de esta subcuenta' }, { status: 400 })
  if (!plan.data) return NextResponse.json({ error: 'Ese plan de pago no es de esta subcuenta' }, { status: 400 })
  const planRow = plan.data as { id: string; method: string | null; cash_collection_ratio: number | null }

  const cfg = await getTenantConfigWithFallback(session.tenantId, true)
  const key = cfg.STRIPE_SECRET_KEY
  if (!key) return NextResponse.json({ error: 'Falta la Secret Key de Stripe en Integraciones' }, { status: 400 })

  const choice: ImportChoice = {
    productId: body.productId,
    paymentPlanId: body.paymentPlanId,
    // Un plan sin ratio declarado se trata como 1 (todo el bruto comisiona), que es lo que hace el
    // registro manual: inventar otro número cambiaría las comisiones.
    cashCollectionRatio: planRow.cash_collection_ratio ?? 1,
    paymentMethod: planRow.method,
    tenantId: session.tenantId,
    userId: session.userId,
  }

  // Estado ACTUAL para volver a clasificar: no se confía en lo que el navegador diga que vio. Entre
  // que se pintó la lista y se pulsó el botón, un pago puede haberse reembolsado o registrado.
  const [collections, contacts] = await Promise.all([
    sb
      .from('collections')
      .select('payment_reference')
      .eq('tenant_id', session.tenantId)
      .not('payment_reference', 'is', null)
      .limit(10000),
    sb.from('contacts').select('id,email').eq('tenant_id', session.tenantId).not('email', 'is', null).limit(10000),
  ])
  if (collections.error) return NextResponse.json({ error: collections.error.message }, { status: 500 })
  if (contacts.error) return NextResponse.json({ error: contacts.error.message }, { status: 500 })
  const knownReferences = new Set(
    (collections.data ?? []).map((c) => (c as { payment_reference: string }).payment_reference).filter(Boolean)
  )
  const contactsByEmail = new Map<string, string>()
  for (const c of contacts.data ?? []) {
    const row = c as { id: string; email: string }
    const email = row.email.trim().toLowerCase()
    if (email && !contactsByEmail.has(email)) contactsByEmail.set(email, row.id)
  }

  const resultados: { paymentId: string; ok: boolean; saleId?: string; motivo?: string }[] = []
  let registradas = 0

  for (const paymentId of paymentIds) {
    // Cada pago se relee de Stripe por su id: es la fuente de la verdad sobre importe y estado, y
    // así el importe escrito no puede venir manipulado desde el navegador.
    let intent: StripeIntent
    try {
      intent = await stripeGet<StripeIntent>(
        `payment_intents/${encodeURIComponent(paymentId)}`,
        new URLSearchParams([['expand[]', 'latest_charge']]),
        { secretKey: key, accountId: cfg.STRIPE_ACCOUNT_ID }
      )
    } catch (e) {
      resultados.push({ paymentId, ok: false, motivo: e instanceof Error ? e.message : 'Stripe no respondió' })
      continue
    }

    const row: BackfillRow = classifyForBackfill(intent, { knownReferences, contactsByEmail })
    const built = buildSaleFromPayment(row, choice)
    if ('error' in built) {
      resultados.push({ paymentId, ok: false, motivo: built.error })
      continue
    }

    const inserted = await sb.from('sales').insert(built.sale).select('id')
    if (inserted.error || !inserted.data || inserted.data.length === 0) {
      resultados.push({ paymentId, ok: false, motivo: inserted.error?.message || 'No se pudo crear la venta' })
      continue
    }
    const saleId = (inserted.data[0] as { id: string }).id

    const collection = await sb
      .from('collections')
      .insert(buildCollection(row, saleId, choice))
      .select('id')
    if (collection.error || !collection.data || collection.data.length === 0) {
      // La venta sin su cobro sería facturación sin dinero asociado, y además el pago volvería a
      // salir como registrable (la referencia vive en el cobro) → se duplicaría en la siguiente
      // tanda. Se deshace la venta y se reporta.
      await sb.from('sales').delete().eq('tenant_id', session.tenantId).eq('id', saleId)
      // 23505 en `collections` = el unique (tenant_id, payment_reference) de
      // 20260914120000 ha parado un DOBLE REGISTRO del mismo pago: otra petición
      // (doble clic, reintento del navegador) ya lo había registrado entre medias. No es un
      // error del usuario ni un fallo: es exactamente lo que tiene que pasar, y el mensaje lo dice
      // así en vez de soltarle una violación de constraint.
      const yaRegistrado = collection.error?.code === '23505'
      resultados.push({
        paymentId,
        ok: false,
        motivo: yaRegistrado
          ? 'Este pago ya se había registrado (otra petición llegó antes). No se ha duplicado nada.'
          : `No se pudo registrar el cobro (${collection.error?.message || '0 filas'}), así que se deshizo la venta.`,
      })
      continue
    }

    // Ya registrada: se añade a las referencias conocidas para que un id repetido en la misma tanda
    // no cree una segunda venta.
    knownReferences.add(paymentId)
    registradas++
    resultados.push({ paymentId, ok: true, saleId })

    await sb.from('audit_logs').insert({
      tenant_id: session.tenantId,
      entity_type: 'sale',
      entity_id: saleId,
      action: 'create',
      actor_user_id: session.userId,
      new_values: { origen: 'stripe_backfill', payment_reference: paymentId, gross_amount: built.sale.gross_amount },
    })
  }

  return NextResponse.json({ ok: true, registradas, total: paymentIds.length, resultados })
}
