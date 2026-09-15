import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getTenantConfigWithFallback } from '@/lib/config'
import { mueveDinero, normalizarEventoStripe, verificarFirmaStripe } from '@/lib/stripe/webhook'

export const runtime = 'nodejs'

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
    await sb.from('raw_events').insert({
      tenant_id: tenantId,
      source: 'stripe',
      payload: { _firma_rechazada: true, codigo: firma.codigo },
      payload_bytes: crudo.length,
      processing_status: 'rejected',
      rejection_reason: `Firma rechazada: ${firma.motivo}`,
      request_origin: req.headers.get('origin'),
      user_agent: req.headers.get('user-agent'),
    })
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
    await sb.from('raw_events').insert({
      tenant_id: tenantId,
      source: 'stripe',
      payload: evento as Record<string, unknown>,
      payload_bytes: crudo.length,
      processing_status: 'rejected',
      rejection_reason: n.error,
    })
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
