import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getTenantConfigWithFallback } from '@/lib/config'
import {
  mueveDinero,
  normalizarEventoStripe,
  verificarFirmaStripe,
  type EventoStripeNormalizado,
} from '@/lib/stripe/webhook'
import { hechoDesdeSobre } from '@/lib/eventos/canonico'
import { derivarStripe } from '@/lib/eventos/stripe'
import { gateForDraft, suggestForDraft } from '@/lib/finance/stripeSaleDrafts'

export const runtime = 'nodejs'
export const maxDuration = 10

// WEBHOOK DE STRIPE — la mitad continua de la ingesta económica.
//
// LO QUE FALTABA. Toda la ingesta de dinero era de tirón (backfill + cron): un cobro no existía en la
// app hasta que alguien pulsaba el importador. Esto lo recibe en el momento. El backfill NO se
// sustituye: sigue siendo la mitad histórica, y son dos cosas distintas que se necesitan las dos.
//
// QUÉ HACE, Y QUÉ NO HACE TODAVÍA. Verifica la firma, guarda el evento CRUDO y clasifica su semántica
// económica. NO escribe en `collections` ni en `sales`: crear una venta exige producto y plan de pago,
// que un pago de Stripe no dice, y ese es justo el motivo por el que el registro pasa por una decisión
// humana (ver lib/finance/stripeBackfill.ts). Lo que sí consigue es que el pago esté en el sistema el
// mismo día, marcado como pendiente de registrar, en vez de descubrirse semanas después.
//
// POR QUÉ SE LEE EL CUERPO CRUDO. La firma de Stripe se calcula sobre los bytes exactos. Parsear el
// JSON y volver a serializarlo cambia el orden de claves y los espacios, y la firma deja de cuadrar
// aunque el mensaje sea legítimo. De ahí `await req.text()` antes de cualquier JSON.parse.

function servicio() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params

  // El cuerpo crudo, ANTES de nada. Ver la nota de arriba.
  const crudo = await req.text()

  const sb = servicio()
  const { data: tenantRow } = await sb.from('tenants').select('id, status').eq('slug', tenantSlug).maybeSingle()
  if (!tenantRow || tenantRow.status !== 'active') {
    return NextResponse.json({ error: 'Subcuenta no encontrada' }, { status: 404 })
  }
  const tenantId = tenantRow.id as string

  // El secreto es por subcuenta: cada una registra su propio endpoint en Stripe, y con un secreto
  // compartido el webhook de un cliente podría escribir en los datos de otro.
  const cfg = await getTenantConfigWithFallback(tenantId, true)
  const secreto = cfg.STRIPE_WEBHOOK_SECRET

  const firma = verificarFirmaStripe(crudo, req.headers.get('stripe-signature'), secreto)
  if (!firma.valida) {
    // Se registra el FALLO DE FIRMA sin el cuerpo: si alguien está probando a inyectar cobros, hay que
    // poder verlo, pero guardar el payload de un remitente no verificado es guardar lo que él quiera.
    // El motivo tampoco incluye el secreto ni la firma esperada.
    const { error: rechazoErr } = await sb.from('raw_events').insert({
      tenant_id: tenantId,
      source: 'stripe',
      payload: { _firma_rechazada: true, codigo: firma.codigo },
      payload_bytes: crudo.length,
      processing_status: 'rejected',
      rejection_reason: `Firma rechazada: ${firma.motivo}`,
      request_origin: req.headers.get('origin'),
      user_agent: req.headers.get('user-agent'),
    })
    // Rastro de seguridad (posible intento de inyectar cobros): si no se pudo guardar, que quede
    // al menos en logs — es lo único que avisaría de un intento repetido.
    if (rechazoErr) console.error('[stripe-webhook] no se pudo registrar el rechazo de firma:', rechazoErr.message)
    // 401 y no 400: el problema es de autenticación. Stripe reintenta ante 5xx, así que devolver 500
    // aquí provocaría reintentos infinitos de algo que nunca va a pasar la firma.
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
  }

  let evento: unknown
  try {
    evento = JSON.parse(crudo)
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const n = normalizarEventoStripe(evento)
  if ('error' in n) {
    // Firma válida pero no se entiende el contenido: se guarda entero para poder reprocesarlo cuando
    // se arregle el normalizador. Es exactamente para esto que existe la capa RAW.
    const { error: rechazoErr } = await sb.from('raw_events').insert({
      tenant_id: tenantId,
      source: 'stripe',
      payload: evento as Record<string, unknown>,
      payload_bytes: crudo.length,
      processing_status: 'rejected',
      rejection_reason: n.error,
    })
    // Si esto falla, el evento NO quedó guardado en ningún sitio: no se puede responder 200 con
    // "registrado: true" porque sería mentira, y Stripe no reintentaría un cobro que se perdió
    // para siempre. 500 fuerza el reintento (mismo evt_id → misma ruta → nuevo intento de guardarlo).
    if (rechazoErr) {
      console.error('[stripe-webhook] no se pudo registrar el evento no reconocido:', rechazoErr.message)
      return NextResponse.json({ error: 'No se pudo registrar el evento' }, { status: 500 })
    }
    // 200: el evento ES de Stripe y ya está guardado. Un 4xx haría que Stripe lo reintentara una y
    // otra vez sin que el reintento cambie nada.
    return NextResponse.json({ recibido: true, registrado: true, procesado: false, motivo: n.error })
  }

  // IDEMPOTENCIA POR EL ID DEL EVENTO. Stripe reintenta el mismo `evt_...` ante cualquier duda, así
  // que el segundo intento tiene que ser inofensivo. El único parcial de `raw_events`
  // (tenant, source, source_event_id) lo garantiza en base, no solo aquí.
  const { data: yaEsta } = await sb
    .from('raw_events')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('source', 'stripe')
    .eq('source_event_id', n.eventId)
    .maybeSingle()

  if (yaEsta) {
    return NextResponse.json({ recibido: true, duplicado: true, evento: n.eventId })
  }

  const { error } = await sb.from('raw_events').insert({
    tenant_id: tenantId,
    source: 'stripe',
    source_event_id: n.eventId,
    payload: evento as Record<string, unknown>,
    payload_bytes: crudo.length,
    // `normalized` significa que se ha entendido y clasificado, no que ya sea una venta: eso sigue
    // necesitando la decisión de producto y plan que un pago de Stripe no trae.
    processing_status: 'normalized',
    processed_at: new Date().toISOString(),
    normalizer_version: 'stripe-webhook-1',
    user_agent: req.headers.get('user-agent'),
  })

  if (error) {
    // 23505 = otra entrega del mismo evento llegó entre la comprobación y el insert. Es el único que
    // se esperaba, y significa que no hay nada que hacer.
    if (error.code === '23505') {
      return NextResponse.json({ recibido: true, duplicado: true, evento: n.eventId })
    }
    // 500 a propósito: aquí SÍ interesa que Stripe reintente, porque el fallo es nuestro y transitorio.
    return NextResponse.json({ error: 'No se pudo registrar el evento' }, { status: 500 })
  }

  // EL HECHO CANÓNICO (F1). El sobre ya está guardado arriba; esto es su interpretación, con la
  // clase que el normalizador YA decidió — de los tres eventos que Stripe emite por un mismo pago,
  // solo uno es dinero, y esa distinción se conserva en el tipo del hecho en vez de reinterpretarse
  // cada vez que alguien lee la tabla. No escribe en collections: la semántica financiera no cambia.
  try {
    const { data: sobre } = await sb
      .from('raw_events')
      .select('id, received_at')
      .eq('tenant_id', tenantId)
      .eq('source', 'stripe')
      .eq('source_event_id', n.eventId)
      .maybeSingle()
    const derivado = derivarStripe(evento)
    if (sobre?.id && derivado) {
      const { data: escrito, error: hechoErr } = await sb
        .from('canonical_events')
        .upsert(
          hechoDesdeSobre({
            tenantId,
            source: 'stripe',
            sourceEventId: derivado.sourceEventId,
            rawEventId: sobre.id,
            tipo: derivado.tipo,
            payload: {},
            recibidoEn: sobre.received_at ?? new Date().toISOString(),
            propiedades: derivado.propiedades,
          }),
          { onConflict: 'tenant_id,source,source_event_id', ignoreDuplicates: true }
        )
        .select('id')
        .maybeSingle()
      if (hechoErr) console.warn('[stripe-webhook] no se pudo derivar el hecho canónico:', hechoErr.message)
      if (escrito?.id) {
        const { error: enlaceErr } = await sb
          .from('raw_events')
          .update({ canonical_event_id: escrito.id })
          .eq('id', sobre.id)
        if (enlaceErr) console.warn('[stripe-webhook] no se pudo enlazar el hecho canónico:', enlaceErr.message)
      }
    }
  } catch (e) {
    // Igual que en GHL: el sobre ya está a salvo y el hecho se puede derivar después con el replay.
    console.warn('[stripe-webhook] no se pudo escribir el hecho canónico:', e instanceof Error ? e.message : e)
  }

  // VENTA BORRADOR — sugerencia automática, nunca el ledger. El pago YA está a salvo en raw_events/
  // canonical_events (arriba); esto solo intenta identificar de quién es y qué vende, para que un
  // closer/admin apruebe con un clic en vez de tener que buscarlo en el informe de backfill.
  if (n.clase === 'cobro') {
    await intentarCrearBorrador(sb, tenantId, n)
  } else if (n.tipo === 'invoice.payment_succeeded' && n.lineaPriceId) {
    await registrarPistaDePrecio(sb, tenantId, n)
  }

  return NextResponse.json({
    recibido: true,
    evento: n.eventId,
    clase: n.clase,
    // Se dice si este evento cuenta como dinero, que es la decisión no obvia: de los tres eventos que
    // Stripe emite por un mismo pago, solo uno suma.
    mueve_dinero: mueveDinero(n),
    importe_eur: n.importeEur,
    motivo: n.motivo,
  })
}

async function resolverContacto(sb: SupabaseClient, tenantId: string, email: string): Promise<string | null> {
  const { data } = await sb
    .from('contacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .ilike('email', email.trim())
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

// Sugiere e inserta una venta borrador para un cobro real. Best-effort a propósito: el pago YA está a
// salvo en raw_events (el llamador lo garantiza antes de invocar esto), así que un fallo aquí solo
// significa que el pago sigue viéndose en el informe de backfill de siempre, no que se pierda dinero.
async function intentarCrearBorrador(sb: SupabaseClient, tenantId: string, n: EventoStripeNormalizado) {
  try {
    const paymentReference = n.referenciaPago
    if (!paymentReference || !n.importeEur || n.importeEur <= 0) return

    const [{ data: cobroExistente }, { data: borradorExistente }] = await Promise.all([
      sb
        .from('collections')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('payment_reference', paymentReference)
        .maybeSingle(),
      sb
        .from('sale_drafts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('payment_reference', paymentReference)
        .maybeSingle(),
    ])
    const contactId = n.email ? await resolverContacto(sb, tenantId, n.email) : null

    const gate = gateForDraft({
      contactId,
      paymentReference,
      knownCollectionReferences: new Set(cobroExistente ? [paymentReference] : []),
      existingDraftReferences: new Set(borradorExistente ? [paymentReference] : []),
    })
    // 'sin_contacto' se queda para el informe de backfill de siempre (ese caso ya lo cubre, y crear
    // un contacto a partir de un email de facturación mezclaría la base de clientes con ruido).
    if (gate !== 'crear') return

    const [{ data: ventaActiva }, { data: pista }] = await Promise.all([
      sb
        .from('sales')
        .select('id, product_id, payment_plan_id')
        .eq('tenant_id', tenantId)
        .eq('contact_id', contactId as string)
        .eq('status', 'active')
        .order('sale_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from('stripe_price_hints')
        .select('stripe_price_id')
        .eq('tenant_id', tenantId)
        .eq('payment_intent_id', paymentReference)
        .maybeSingle(),
    ])
    const stripePriceId = n.lineaPriceId ?? (pista?.stripe_price_id as string | undefined) ?? null

    const [{ data: priceMapRows }, { data: planRows }] = await Promise.all([
      sb.from('stripe_price_map').select('stripe_price_id, product_id, payment_plan_id').eq('tenant_id', tenantId),
      sb
        .from('payment_plans')
        .select('id, product_id, gross_price, number_of_payments')
        .eq('tenant_id', tenantId)
        .eq('is_active', true),
    ])

    const venta = ventaActiva as { id: string; product_id: string; payment_plan_id: string } | null
    const suggestion = suggestForDraft({
      amount: n.importeEur,
      stripePriceId,
      activeSale: venta ? { id: venta.id, productId: venta.product_id, paymentPlanId: venta.payment_plan_id } : null,
      priceMap: (priceMapRows ?? []).map((r) => ({
        stripePriceId: r.stripe_price_id as string,
        productId: r.product_id as string,
        paymentPlanId: r.payment_plan_id as string,
      })),
      plans: (planRows ?? []).map((r) => ({
        id: r.id as string,
        productId: r.product_id as string,
        grossPrice: r.gross_price as number,
        numberOfPayments: r.number_of_payments as number,
      })),
    })

    const { error: insErr } = await sb.from('sale_drafts').insert({
      tenant_id: tenantId,
      payment_reference: paymentReference,
      amount: n.importeEur,
      currency: n.moneda ?? 'EUR',
      contact_id: contactId,
      email: n.email,
      occurred_at: n.ocurridoEn,
      suggested_product_id: suggestion.suggestedProductId,
      suggested_payment_plan_id: suggestion.suggestedPaymentPlanId,
      existing_sale_id: suggestion.existingSaleId,
      reason: suggestion.reason,
      stripe_price_id: stripePriceId,
    })
    // 23505 = otra entrega del mismo webhook ya creó el borrador entre la comprobación y el insert.
    // El UNIQUE (tenant_id, payment_reference) existe exactamente para esto: no es un fallo.
    if (insErr && insErr.code !== '23505') {
      console.warn('[stripe-webhook] no se pudo crear la venta borrador:', insErr.message)
    }
  } catch (e) {
    console.warn('[stripe-webhook] fallo generando la venta borrador:', e instanceof Error ? e.message : e)
  }
}

// La factura trae el Price ID (sus líneas van completas en el payload); el PaymentIntent no. Se guarda
// como pista por si el borrador aún no existe (orden de entrega no garantizado por Stripe), y si ya
// existe sin sugerencia resuelta, se reintenta con este Price ID recién llegado.
async function registrarPistaDePrecio(sb: SupabaseClient, tenantId: string, n: EventoStripeNormalizado) {
  try {
    const intentId = n.referenciasAlternativas[0]
    if (!intentId || !n.lineaPriceId) return

    const { error: hintErr } = await sb
      .from('stripe_price_hints')
      .upsert(
        { tenant_id: tenantId, payment_intent_id: intentId, stripe_price_id: n.lineaPriceId },
        { onConflict: 'tenant_id,payment_intent_id' }
      )
    if (hintErr) console.warn('[stripe-webhook] no se pudo guardar la pista de Price ID:', hintErr.message)

    const { data: draft } = await sb
      .from('sale_drafts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('payment_reference', intentId)
      .eq('status', 'pending')
      .is('stripe_price_id', null)
      .maybeSingle()
    if (!draft) return

    const { data: priceMapRows } = await sb
      .from('stripe_price_map')
      .select('product_id, payment_plan_id')
      .eq('tenant_id', tenantId)
      .eq('stripe_price_id', n.lineaPriceId)
      .limit(1)
    const mapeado = (priceMapRows ?? [])[0] as { product_id: string; payment_plan_id: string } | undefined

    const { error: updErr } = await sb
      .from('sale_drafts')
      .update({
        stripe_price_id: n.lineaPriceId,
        ...(mapeado
          ? {
              suggested_product_id: mapeado.product_id,
              suggested_payment_plan_id: mapeado.payment_plan_id,
              reason: `Reconocido por el Price ID de Stripe (${n.lineaPriceId}), mapeado en Integraciones (llegó tras crear el borrador).`,
            }
          : {}),
      })
      .eq('id', (draft as { id: string }).id)
    if (updErr)
      console.warn('[stripe-webhook] no se pudo actualizar la venta borrador con el Price ID:', updErr.message)
  } catch (e) {
    console.warn('[stripe-webhook] fallo procesando la pista de Price ID:', e instanceof Error ? e.message : e)
  }
}
