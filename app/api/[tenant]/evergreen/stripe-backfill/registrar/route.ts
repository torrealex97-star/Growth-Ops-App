import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { stripeGet } from '@/lib/stripe/client'
import { classifyForBackfill, type BackfillRow } from '@/lib/finance/stripeBackfill'
import { buildCollection, buildSaleFromPayments, type ImportChoice } from '@/lib/finance/stripeImport'
import type { StripeIntent } from '@/lib/finance/stripeReconciliation'

export const runtime = 'nodejs'
export const maxDuration = 60

// Registrar como VENTAS los pagos de Stripe que el informe marca como `registrable`.
//
// Va en una ruta aparte del informe a propósito: el informe sigue siendo de solo lectura y con su
// test que lo garantiza. Escribir es otra cosa y se pide expresamente.
//
// LO QUE NO SE AUTOMATIZA. El producto y el plan de pago los elige la persona: `sales` los exige
// (NOT NULL) y un pago de Stripe no dice a cuál corresponde. Aquí llegan elegidos.
//
// UNA VENTA POR CLIENTE, NO POR PAGO. Los pagos de una misma persona dentro de la tanda son los
// PLAZOS de una venta, no ventas distintas: se escribe UNA venta por el PRECIO PACTADO del plan y
// UN cobro por cada pago real.
// Escribir una venta por pago —lo que hacía antes— dejó 48 ventas para 27 clientas en la base real,
// con el ticket medio hundido de ~1497€ a 458€ y todas las métricas por venta detrás.
//
// SI EL CONTACTO YA TIENE VENTA, se registra igualmente la venta de esta tanda y se AVISA en el
// resultado. Fusionar contra una venta anterior daría por hecho que no hubo segunda compra, y un
// upsell o una renovación son ventas de verdad: lo decide una persona, no esta ruta.

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
      .select('id,method,cash_collection_ratio,gross_price')
      .eq('tenant_id', session.tenantId)
      .eq('id', body.paymentPlanId)
      .maybeSingle(),
  ])
  if (!product.data) return NextResponse.json({ error: 'Ese producto no es de esta subcuenta' }, { status: 400 })
  if (!plan.data) return NextResponse.json({ error: 'Ese plan de pago no es de esta subcuenta' }, { status: 400 })
  const planRow = plan.data as {
    id: string
    method: string | null
    cash_collection_ratio: number | null
    gross_price: number | null
  }

  const cfg = await getTenantConfigWithFallback(session.tenantId, true)
  const key = cfg.STRIPE_SECRET_KEY
  if (!key) return NextResponse.json({ error: 'Falta la Secret Key de Stripe en Integraciones' }, { status: 400 })

  const choice: ImportChoice = {
    productId: body.productId,
    paymentPlanId: body.paymentPlanId,
    // Un plan sin ratio declarado se trata como 1 (todo el bruto comisiona), que es lo que hace el
    // registro manual: inventar otro número cambiaría las comisiones.
    cashCollectionRatio: planRow.cash_collection_ratio ?? 1,
    // El PRECIO PACTADO del plan. La venta vale esto, no lo que haya entrado todavía: facturación y
    // cash collected son dos métricas distintas y `collections` ya guarda la segunda.
    planGrossPrice: planRow.gross_price ?? null,
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

  // PASO 1 — releer y clasificar TODOS los pagos antes de escribir nada. Hace falta la tanda entera
  // para saber qué pagos son del mismo cliente: agrupar sobre la marcha crearía la primera venta
  // antes de saber que el segundo pago era su plazo.
  const clasificados = new Map<string, BackfillRow>()
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

    clasificados.set(paymentId, classifyForBackfill(intent, { knownReferences, contactsByEmail }))
  }

  // PASO 2 — agrupar por contacto. Un pago sin contacto identificado no agrupa con nadie: se
  // reporta con el motivo que trae la clasificación, igual que antes.
  const porContacto = new Map<string, BackfillRow[]>()
  for (const [paymentId, row] of clasificados) {
    if (row.verdict !== 'registrable' || !row.contactId) {
      resultados.push({
        paymentId,
        ok: false,
        motivo: row.reason || `El pago ${paymentId} ya no es registrable (${row.verdict}).`,
      })
      continue
    }
    const grupo = porContacto.get(row.contactId)
    if (grupo) grupo.push(row)
    else porContacto.set(row.contactId, [row])
  }

  // Qué contactos YA tenían una venta antes de esta tanda. No cambia lo que se escribe: se avisa,
  // porque una segunda venta del mismo cliente puede ser un upsell legítimo o un doble registro, y
  // solo quien conoce el caso lo sabe.
  const conVentaPrevia = new Set<string>()
  if (porContacto.size > 0) {
    const previas = await sb
      .from('sales')
      .select('contact_id')
      .eq('tenant_id', session.tenantId)
      .in('contact_id', [...porContacto.keys()])
    if (previas.error) return NextResponse.json({ error: previas.error.message }, { status: 500 })
    for (const v of previas.data ?? []) conVentaPrevia.add((v as { contact_id: string }).contact_id)
  }

  // PASO 3 — una venta por contacto, con todos sus cobros.
  let ventasCreadas = 0
  for (const [contactId, filas] of porContacto) {
    const built = buildSaleFromPayments(filas, choice)
    if ('error' in built) {
      for (const f of filas) resultados.push({ paymentId: f.paymentId, ok: false, motivo: built.error })
      continue
    }

    const inserted = await sb.from('sales').insert(built.sale).select('id')
    if (inserted.error || !inserted.data || inserted.data.length === 0) {
      const motivo = inserted.error?.message || 'No se pudo crear la venta'
      for (const f of filas) resultados.push({ paymentId: f.paymentId, ok: false, motivo })
      continue
    }
    const saleId = (inserted.data[0] as { id: string }).id

    const collection = await sb
      .from('collections')
      .insert(filas.map((f) => buildCollection(f, saleId, choice)))
      .select('id')
    const escritos = collection.data?.length ?? 0
    if (collection.error || escritos !== filas.length) {
      // La venta sin TODOS sus cobros sería facturación descuadrada, y los pagos sin cobro volverían
      // a salir como registrables (la referencia vive en el cobro) → se duplicarían en la siguiente
      // tanda. Se deshace la venta entera —los cobros caen con ella por la FK— y se reporta.
      await sb.from('sales').delete().eq('tenant_id', session.tenantId).eq('id', saleId)
      // 23505 en `collections` = el unique (tenant_id, payment_reference) de
      // 20260914120000 ha parado un DOBLE REGISTRO del mismo pago: otra petición
      // (doble clic, reintento del navegador) ya lo había registrado entre medias. No es un
      // error del usuario ni un fallo: es exactamente lo que tiene que pasar, y el mensaje lo dice
      // así en vez de soltarle una violación de constraint.
      const yaRegistrado = collection.error?.code === '23505'
      const motivo = yaRegistrado
        ? 'Alguno de estos pagos ya se había registrado (otra petición llegó antes). No se ha duplicado nada.'
        : `No se pudieron registrar los cobros (${collection.error?.message || `${escritos} de ${filas.length}`}), así que se deshizo la venta.`
      for (const f of filas) resultados.push({ paymentId: f.paymentId, ok: false, motivo })
      continue
    }

    ventasCreadas++
    const aviso = conVentaPrevia.has(contactId)
      ? 'Este cliente ya tenía una venta registrada. Se ha creado otra: revisa si era un upsell o un duplicado.'
      : undefined
    for (const f of filas) {
      // Ya registrado: se añade a las referencias conocidas para que un id repetido en la misma
      // tanda no cree una segunda venta.
      knownReferences.add(f.paymentId)
      registradas++
      resultados.push({ paymentId: f.paymentId, ok: true, saleId, motivo: aviso })
    }

    await sb.from('audit_logs').insert({
      tenant_id: session.tenantId,
      entity_type: 'sale',
      entity_id: saleId,
      action: 'create',
      actor_user_id: session.userId,
      new_values: {
        origen: 'stripe_backfill',
        payment_references: built.references,
        gross_amount: built.sale.gross_amount,
      },
    })
  }

  return NextResponse.json({
    ok: true,
    registradas,
    ventasCreadas,
    total: paymentIds.length,
    resultados,
  })
}
