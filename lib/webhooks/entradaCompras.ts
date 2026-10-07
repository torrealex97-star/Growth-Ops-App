import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getTenantConfigWithFallback } from '@/lib/config'
import { getOrCreateContact } from '@/lib/contacts/resolve'
import { atribuirDesdePayload } from '@/lib/contacts/atribucion'
import { hechoDesdeSobre } from '@/lib/eventos/canonico'
import type { VeredictoFirma } from './verifySecret'

// MOTOR DE LOS WEBHOOKS DE COMPRA (Hotmart, Whop).
//
// Son dos proveedores con el mismo esqueleto y distinta firma: resolver la subcuenta por el slug de
// la URL, verificar la firma con el secreto POR SUBCUENTA, guardar el sobre ANTES de procesar nada,
// encajar el contacto por email, registrar la atribución y derivar el hecho canónico. Con el
// esqueleto en UN sitio, la mitad receptora de los dos proveedores no puede divergir (el webhook de
// GHL y el de Calendly copiaron el esqueleto a mano y cada copia envejeció distinto).
//
// LO QUE ESTE MOTOR NO HACE, y es deliberado (misma decisión que el webhook de Stripe): NO escribe
// en `sales` ni en `collections`. La compra trae el producto EXTERNO de Hotmart/Whop y su importe;
// qué producto de la app es y qué plan de pago le corresponde es una decisión del propietario. Lo
// que sí consigue es que la compra esté en el sistema el mismo día, en raw_events y como hecho
// canónico, en vez de descubrirse semanas después.

export type ClaseCompra = 'dinero' | 'devolucion' | 'estado'

export type DerivadoCompra = {
  sourceEventId: string
  tipo: string
  ocurridoEn: string
  propiedades: Record<string, unknown>
  clase: ClaseCompra
}

export type Comprador = {
  email: string | null
  fullName: string | null
  phone: string | null
}

export type FuenteCompra = 'hotmart' | 'whop'

const CLAVE_SECRETO: Record<FuenteCompra, string> = {
  hotmart: 'HOTMART_WEBHOOK_SECRET',
  whop: 'WHOP_WEBHOOK_SECRET',
}

function servicio() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function procesarEntradaCompra(opciones: {
  req: NextRequest
  params: Promise<{ tenant: string }>
  fuente: FuenteCompra
  verificar: (raw: string, cabeceras: Headers, secreto: string | undefined) => VeredictoFirma
  derivar: (payload: Record<string, unknown>, recibidoEn: string, idCabecera?: string | null) => DerivadoCompra | null
  extraerComprador: (payload: Record<string, unknown>) => Comprador
  toqueDesdePayload: (payload: Record<string, unknown>) => Record<string, unknown>
}): Promise<NextResponse> {
  const { req, params, fuente, verificar, derivar, extraerComprador, toqueDesdePayload } = opciones

  // El cuerpo crudo, ANTES de nada: las firmas (HMAC de Hotmart, Standard Webhooks de Whop) se
  // calculan sobre los bytes exactos. Parsear y volver a serializar cambia el orden de claves y
  // los espacios, y la firma deja de cuadrar aunque el mensaje sea legítimo.
  const crudo = await req.text()
  const { tenant } = await params

  const sb = servicio()
  const { data: tenantRow } = await sb
    .from('tenants')
    .select('id, status')
    .eq('slug', tenant)
    .eq('status', 'active')
    .single()

  // Subcuenta inexistente y firma inválida responden IGUAL (401 'Firma inválida', sin pistas): si
  // no, el endpoint sirve para averiguar qué subcuentas existen. Es el criterio de Calendly; el
  // 404 de Stripe se quedó viejo con el endurecimiento multi-tenant.
  if (!tenantRow) return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
  const tenantId = tenantRow.id as string

  // El secreto es por subcuenta: cada una registra su propio webhook con su propio token. Un
  // secreto compartido permitiría que el webhook de un cliente escribiera en los datos de otro.
  // No hay respaldo en el entorno: el panel es la única fuente, y así el panel nunca esconde cuál
  // es el valor vivo.
  const cfg = await getTenantConfigWithFallback(tenantId, true)
  const secreto = cfg[CLAVE_SECRETO[fuente]]

  const firma = verificar(crudo, req.headers, secreto)
  if (!firma.valida) {
    // Rastro de seguridad: igual que Stripe, se registra que hubo un rechazo — sin el cuerpo
    // (guardar el payload de un remitente no verificado es guardar lo que él quiera) y sin el
    // secreto. El motivo del log nunca contiene valores, solo la causa.
    const { error: rechazoErr } = await sb.from('raw_events').insert({
      tenant_id: tenantId,
      source: fuente,
      payload: { _firma_rechazada: true },
      payload_bytes: crudo.length,
      processing_status: 'rejected',
      rejection_reason: `Firma rechazada: ${firma.motivo ?? 'motivo no disponible'}`,
      request_origin: req.headers.get('origin'),
      user_agent: req.headers.get('user-agent'),
    })
    if (rechazoErr) console.error(`[${fuente}-webhook] no se pudo registrar el rechazo de firma:`, rechazoErr.message)
    console.warn(`[${fuente}-webhook] 401 en "${tenant}": ${firma.motivo}`)
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
  }

  const ahora = new Date().toISOString()
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(crudo) as Record<string, unknown>
  } catch {
    // 400, no 500: no hay nada que reintentar y el motivo queda en el log del runtime — el mismo
    // criterio que GHL y Calendly para cuerpos vacíos o rotos.
    console.warn(`[${fuente}-webhook] 400: cuerpo vacío o JSON inválido (longitud ${crudo.length})`)
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const derivado = derivar(payload, ahora, req.headers.get('webhook-id'))
  if (!derivado) {
    // Firma válida pero contenido que no se entiende: se guarda ENTERO para poder reprocesarlo
    // cuando se arregle el normalizador. Para eso existe la capa RAW. Y 200: la entrega ES del
    // proveedor y ya está guardada; un 4xx haría que la reintentara una y otra vez sin que el
    // reintento cambiara nada.
    const { error: rechazoErr } = await sb.from('raw_events').insert({
      tenant_id: tenantId,
      source: fuente,
      payload,
      payload_bytes: crudo.length,
      processing_status: 'rejected',
      rejection_reason: 'evento no reconocido por el normalizador',
      normalizer_version: fuente === 'hotmart' ? 'hotmart-1' : 'whop-1',
      user_agent: req.headers.get('user-agent'),
    })
    if (rechazoErr)
      console.error(`[${fuente}-webhook] no se pudo registrar el evento no reconocido:`, rechazoErr.message)
    return NextResponse.json({ recibido: true, registrado: true, procesado: false, motivo: 'evento no reconocido' })
  }

  // IDEMPOTENCIA + SANACIÓN. El sobre se UPSERTEA (no se consulta y se salta): si una entrega
  // anterior se quedó a medias (contacto fallido, hecho no escrito), el reintento del proveedor
  // REPROCESA sobre la misma fila y sana el parcial. Todas las proyecciones son idempotentes por
  // diseño (get_or_create, fill-if-empty, upsert del hecho), así que reintentar nunca duplica.
  const { data: sobrePrevio } = await sb
    .from('raw_events')
    .select('id, processing_status')
    .eq('tenant_id', tenantId)
    .eq('source', fuente)
    .eq('source_event_id', derivado.sourceEventId)
    .maybeSingle()

  const { data: sobre, error: errorSobre } = await sb
    .from('raw_events')
    .upsert(
      {
        tenant_id: tenantId,
        source: fuente,
        source_event_id: derivado.sourceEventId,
        normalizer_version: fuente === 'hotmart' ? 'hotmart-1' : 'whop-1',
        payload,
        payload_bytes: crudo.length,
        processing_status: 'received' as const,
        user_agent: req.headers.get('user-agent'),
        request_origin: req.headers.get('origin'),
      },
      // El parcial (tenant, source, source_event_id) convierte el reintento en la misma fila.
      { onConflict: 'tenant_id,source,source_event_id', ignoreDuplicates: false }
    )
    .select('id')
    .single()

  if (errorSobre || !sobre) {
    // Fallo nuestro y transitorio: 500 para que el proveedor reintente y el sobre acabe guardado.
    console.error(`[${fuente}-webhook] no se pudo guardar el sobre:`, errorSobre?.message)
    return NextResponse.json({ error: 'No se pudo registrar el evento' }, { status: 500 })
  }
  const sobreId = sobre.id as string

  // El cierre del sobre y la respuesta pasan todos por aquí: si alguna salida se saltara este
  // punto, el sobre quedaría en "received" para siempre y el replay no sabría distinguir lo
  // procesado de lo que se quedó a medias.
  const responder = async (cuerpo: Record<string, unknown>, status = 200) => {
    const fallo = status >= 400
    const { error: errorCierre } = await sb
      .from('raw_events')
      .update({
        processing_status: fallo ? 'rejected' : 'normalized',
        processed_at: new Date().toISOString(),
        rejection_reason: fallo ? String(cuerpo.error ?? 'error al procesar') : null,
      })
      .eq('id', sobreId)
    if (errorCierre) console.warn(`[${fuente}-webhook] no se pudo cerrar el sobre:`, errorCierre.message)
    return NextResponse.json(cuerpo, { status })
  }

  // ── CONTACTO ──────────────────────────────────────────────────────────────────────────────
  const comprador = extraerComprador(payload)
  if (!comprador.email && !comprador.phone) {
    // Sin identidad del comprador no se puede encajar nadie. Ante la duda no se decide: el sobre
    // queda guardado (con su derivación, si se procesa el hecho abajo) y se responde 200 — un
    // reintento no fabricaría un email. La entrega queda visible en raw_events para revisarla.
    console.warn(`[${fuente}-webhook] entrega sin email ni teléfono del comprador; queda en raw_events`)
    await escribirHecho(sb, fuente, tenantId, sobreId, derivado, null, ahora)
    return responder({
      recibido: true,
      evento: derivado.sourceEventId,
      tipo: derivado.tipo,
      contacto: false,
      motivo: 'sin email ni teléfono del comprador: enlazar el contacto es manual',
    })
  }

  const partes = (comprador.fullName || '').split(' ')
  const resolved = await getOrCreateContact(sb, tenantId, {
    email: comprador.email,
    phone: comprador.phone,
    fullName: comprador.fullName,
    firstName: partes[0] || null,
    lastName: partes.slice(1).join(' ') || null,
    // Solo al CREAR: un contacto que nace de una compra nace vendido ('venta' del embudo
    // canónico). Un contacto que ya existía NO cambia de estado: que renueve o reclame no dice
    // nada de su pipeline, y el pipeline es del equipo.
    leadStatus: 'venta',
    leadChannel: fuente,
    seenAt: ahora,
  })
  if (!resolved.ok) {
    // 500 a propósito: el proveedor reintenta, el sobre ya está guardado y el reprocesado sana.
    return responder({ error: 'Error creando el contacto', detalle: resolved.error }, 500)
  }
  const contactId = resolved.contact.id

  // ── ATRIBUCIÓN ────────────────────────────────────────────────────────────────────────────
  // La compra es un toque con su fecha real (la del pedido, no la del reintento): si el contacto
  // ya tenía atribución, rellenará huecos del origen y el toque antiguo no se presentará como
  // último — las reglas de registrarToque. Sin UTMs en el payload, no se escribe NADA (un hueco
  // no es un cero). Un fallo al atribuir NO tumba el webhook: la compra y el contacto valen más
  // que su procedencia.
  try {
    const { resultado } = await atribuirDesdePayload(sb, tenantId, contactId, toqueDesdePayload(payload), {
      source: fuente,
      enEl: derivado.ocurridoEn,
    })
    if (!resultado.ok) console.warn(`[atribucion/${fuente}] no se pudo registrar el toque:`, resultado.error)
  } catch (e) {
    console.warn(`[atribucion/${fuente}] no se pudo registrar el toque:`, e instanceof Error ? e.message : e)
  }

  // ── HECHO CANÓNICO ────────────────────────────────────────────────────────────────────────
  await escribirHecho(sb, fuente, tenantId, sobreId, derivado, contactId, ahora)

  return responder({
    recibido: true,
    duplicado: Boolean(sobrePrevio),
    evento: derivado.sourceEventId,
    tipo: derivado.tipo,
    contacto: true,
    contactId,
    // Se dice si este evento cuenta como dinero, que es la decisión no obvia: la clase lo declara,
    // el registro humano decide si entra en las ventas de la app.
    mueve_dinero: derivado.clase === 'dinero',
    clase: derivado.clase,
  })
}

/** El hecho canónico, al final (lleva el contactId de la proyección). Su fallo no tumba la entrega. */
async function escribirHecho(
  sb: ReturnType<typeof servicio>,
  fuente: FuenteCompra,
  tenantId: string,
  sobreId: string,
  derivado: DerivadoCompra,
  contactId: string | null,
  ahora: string
) {
  try {
    const { data: escrito, error: errorHecho } = await sb
      .from('canonical_events')
      .upsert(
        hechoDesdeSobre({
          tenantId,
          source: fuente,
          sourceEventId: derivado.sourceEventId,
          rawEventId: sobreId,
          tipo: derivado.tipo,
          payload: {},
          recibidoEn: ahora,
          propiedades: derivado.propiedades,
          ocurridoEn: derivado.ocurridoEn,
          contactId,
        }),
        { onConflict: 'tenant_id,source,source_event_id', ignoreDuplicates: true }
      )
      .select('id')
      .maybeSingle()
    if (errorHecho) {
      console.warn(`[${fuente}-webhook] no se pudo escribir el hecho canónico:`, errorHecho.message)
      return
    }
    if (escrito?.id) {
      const { error: enlaceErr } = await sb
        .from('raw_events')
        .update({ canonical_event_id: escrito.id })
        .eq('id', sobreId)
      if (enlaceErr) console.warn(`[${fuente}-webhook] no se pudo enlazar el hecho canónico:`, enlaceErr.message)
    }
  } catch (e) {
    // El sobre ya está a salvo: el hecho se puede derivar después con el replay.
    console.warn(`[${fuente}-webhook] no se pudo escribir el hecho canónico:`, e instanceof Error ? e.message : e)
  }
}
