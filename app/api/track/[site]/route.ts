import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  MinuteRateLimiter,
  classifyBot,
  deriveChannel,
  hashIp,
  isValidEventName,
  originAllowed,
} from '@/lib/tracking/ingest'

export const runtime = 'nodejs'

// Rate limiter en memoria del proceso (best-effort; ver comentario en la clase).
const limiter = new MinuteRateLimiter()

// Los eventos del brief de captación. Cualquier otro nombre se rechaza: un canal abierto de
// escritura con nombres libres sería la puerta a basura en canonical_events (y las agregaciones
// del funnel asumen esta lista).
const ALLOWED_EVENTS = new Set([
  'page_view',
  'landing_view',
  'cta_view',
  'cta_click',
  'form_start',
  'form_submit',
  'lead',
  'appointment_booked',
  'appointment_attended',
  'purchase',
  // VSL (el dashboard detallado de VSL usa los mismos; aquí solo cuentan como etapas del funnel)
  'vsl_view',
  'vsl_progress',
  'vsl_complete',
])

const MAX_PAYLOAD_BYTES = 8 * 1024

type TrackBody = {
  event?: string
  event_id?: string
  url?: string
  referrer?: string
  anonymous_id?: string
  session_id?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  gclid?: string
  fbclid?: string
  ttclid?: string
  properties?: Record<string, unknown>
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
function clientIp(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
}

/**
 * INGESTA DEL PIXEL FIRST-PARTY (Fase C). Pública: la llaman navegadores sin sesión, así que
 * NO usa requireTenant (no hay cookie) ni el secreto TRACKING_INGEST_KEY (un secreto no puede
 * vivir en un script servido al navegador). La autenticación es la public_key del site:
 * identifica site+subcuenta y SOLO concede escritura acotada de eventos — nunca lectura.
 *
 * Flujo: resolve site → valida origin+rate limit+evento → guarda RAW tal como llegó →
 * normaliza a canónico (visitor/session/touchpoint get-or-create con claves por subcuenta).
 * Un fallo de normalización NO pierde el raw (§8 del mapa de tracking): queda con
 * processing_status='received' para replay.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ site: string }> }) {
  const { site: publicKey } = await params
  if (!/^gop_pk_[A-Za-z0-9_-]{32,64}$/.test(publicKey)) {
    return NextResponse.json({ error: 'Clave inválida' }, { status: 400 })
  }

  const origin = request.headers.get('origin')
  const userAgent = request.headers.get('user-agent')
  const ip = clientIp(request)

  // Cuerpo pequeño a propósito: un pixel no manda ni 1KB. El tamaño es la primera barrera de abuso.
  const rawBody = await request.text().catch(() => null)
  if (!rawBody || rawBody.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 413 })
  }
  let body: TrackBody
  try {
    body = JSON.parse(rawBody) as TrackBody
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const eventName = (body.event ?? '').trim()
  if (!isValidEventName(eventName) || !ALLOWED_EVENTS.has(eventName)) {
    return NextResponse.json({ error: 'Evento desconocido' }, { status: 422 })
  }

  const sb = serviceClient()
  if (!sb)
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY no configurada en este entorno' }, { status: 500 })

  // 1) Resolver site+tenant por la clave pública (única global por diseño de la migración).
  // La subcuenta dueña del site debe estar ACTIVA: una subcuenta archivada/suspendida no sigue
  // recogiendo eventos (su pixel deja de responder con 409, igual que un site con tracking off).
  const { data: site } = await sb
    .from('tracking_sites')
    .select(
      'id, tenant_id, slug, allowed_origins, allow_localhost, tracking_enabled, rate_limit_per_minute, tenants!inner(status)'
    )
    .eq('public_key', publicKey)
    .eq('tenants.status', 'active')
    .maybeSingle()
  if (!site) return NextResponse.json({ error: 'Site desconocido' }, { status: 404 })
  if (!site.tracking_enabled) return NextResponse.json({ error: 'Tracking desactivado' }, { status: 409 })

  // 2) Origin allowlist (el vacío = ninguno autorizado, por diseño de la migración).
  if (!originAllowed(origin, site.allowed_origins ?? [], site.allow_localhost)) {
    return NextResponse.json({ error: 'Origen no autorizado' }, { status: 403 })
  }

  // 3) Rate limit por clave (techo por proceso; ver MinuteRateLimiter).
  if (!limiter.allow(publicKey, site.rate_limit_per_minute ?? 600)) {
    return NextResponse.json({ error: 'Límite de eventos superado' }, { status: 429 })
  }

  const bot = classifyBot(userAgent)
  const receivedAt = new Date()
  const tenantId: string = site.tenant_id

  // 4) RAW tal como llegó (idempotente por event_id del navegador cuando viene).
  const eventId = (body.event_id ?? '').trim().slice(0, 200) || null
  const { data: rawRow, error: rawError } = await sb
    .from('raw_events')
    .insert({
      tenant_id: tenantId,
      site_id: site.id,
      source: 'pixel',
      source_event_id: eventId,
      source_schema_version: '1.0',
      normalizer_version: '1.0',
      payload: body as unknown as Record<string, unknown>,
      payload_bytes: rawBody.length,
      processing_status: 'received',
      request_origin: origin,
      user_agent: userAgent,
      ip_hash: hashIp(ip, process.env.TRACKING_IP_SALT),
      bot_classification: bot,
      correlation_id: crypto.randomUUID(),
      received_at: receivedAt.toISOString(),
    })
    .select('id')
    .single()
  // Duplicado por event_id: la ingesta es idempotente; el navegador reintenta y no duplica.
  if (rawError) {
    if (rawError.code === '23505') {
      return NextResponse.json({ accepted: true, duplicate: true }, { status: 200 })
    }
    return NextResponse.json({ error: 'No se pudo registrar el evento' }, { status: 500 })
  }

  // 5) Normalización a canónico. Sin anonymous_id no hay visitor: se marca skipped (el raw queda).
  const anonymousId = (body.anonymous_id ?? '').trim().slice(0, 128) || null
  if (!anonymousId) {
    await sb
      .from('raw_events')
      .update({
        processing_status: 'skipped',
        rejection_reason: 'sin_anonymous_id',
        processed_at: new Date().toISOString(),
      })
      .eq('id', rawRow.id)
    return NextResponse.json({ accepted: false, reason: 'sin_anonymous_id' }, { status: 200 })
  }

  // 5a) Visitor get-or-create — la unique es (tenant_id, anonymous_id), NUNCA global (migración Fase B).
  let visitorId: string | null = null
  const { data: existingVisitor } = await sb
    .from('analytics_visitors')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('anonymous_id', anonymousId)
    .maybeSingle()
  if (existingVisitor) {
    visitorId = existingVisitor.id
  } else {
    const { data: newVisitor } = await sb
      .from('analytics_visitors')
      .insert({ tenant_id: tenantId, anonymous_id: anonymousId })
      .select('id')
      .single()
    visitorId = newVisitor?.id ?? null
  }
  if (!visitorId) {
    await sb
      .from('raw_events')
      .update({ processing_status: 'received', rejection_reason: 'visitor_no_resuelto' })
      .eq('id', rawRow.id)
    return NextResponse.json({ accepted: false, reason: 'visitor_no_resuelto' }, { status: 200 })
  }

  // 5b) Session get-or-create (30 min de ventana, window name en el SDK).
  const externalSessionId = (body.session_id ?? '').trim().slice(0, 128) || null
  let sessionId: string | null = null
  if (externalSessionId) {
    const { data: existingSession } = await sb
      .from('analytics_sessions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('external_session_id', externalSessionId)
      .maybeSingle()
    if (existingSession) {
      sessionId = existingSession.id
    } else {
      const { data: newSession } = await sb
        .from('analytics_sessions')
        .insert({
          tenant_id: tenantId,
          visitor_id: visitorId,
          external_session_id: externalSessionId,
          started_at: receivedAt.toISOString(),
          landing_url: body.url ?? null,
          referrer: body.referrer ?? null,
          utm_source: body.utm_source ?? null,
          utm_medium: body.utm_medium ?? null,
          utm_campaign: body.utm_campaign ?? null,
          utm_content: body.utm_content ?? null,
          utm_term: body.utm_term ?? null,
          gclid: body.gclid ?? null,
          fbclid: body.fbclid ?? null,
          ttclid: body.ttclid ?? null,
        })
        .select('id')
        .single()
      sessionId = newSession?.id ?? null
    }
  }

  // 5c) Touchpoint del primer contacto de la sesión (prim-touch attribution).
  let touchpointId: string | null = null
  if (sessionId) {
    const { data: existingTouchpoint } = await sb
      .from('analytics_touchpoints')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('session_id', sessionId)
      .order('occurred_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    touchpointId = existingTouchpoint?.id ?? null
    if (!touchpointId) {
      const { data: newTouchpoint } = await sb
        .from('analytics_touchpoints')
        .insert({
          tenant_id: tenantId,
          visitor_id: visitorId,
          session_id: sessionId,
          occurred_at: receivedAt.toISOString(),
          channel: deriveChannel(body.utm_source, body.referrer),
          source: body.utm_source ?? null,
          medium: body.utm_medium ?? null,
          campaign: body.utm_campaign ?? null,
          landing_url: body.url ?? null,
          referrer: body.referrer ?? null,
          click_id_type: body.gclid ? 'gclid' : body.fbclid ? 'fbclid' : body.ttclid ? 'ttclid' : null,
          click_id: body.gclid ?? body.fbclid ?? body.ttclid ?? null,
          capture_method: 'browser',
          observation_type: 'observed',
        })
        .select('id')
        .single()
      touchpointId = newTouchpoint?.id ?? null
    }
  }

  // 6) Evento canónico (idempotente por tenant+source+source_event_id).
  const { error: canonicalError } = await sb.from('canonical_events').upsert(
    {
      tenant_id: tenantId,
      site_id: site.id,
      raw_event_id: rawRow.id,
      source_event_id: eventId,
      event_id: eventId ?? crypto.randomUUID(),
      event_name: eventName,
      occurred_at: receivedAt.toISOString(),
      source: 'pixel',
      schema_version: '1.0',
      idempotency_key: eventId ?? `${anonymousId}:${eventName}:${receivedAt.toISOString()}`,
      visitor_id: visitorId,
      session_id: sessionId,
      touchpoint_id: touchpointId,
      processing_status: 'received',
      properties: {
        url: body.url ?? null,
        referrer: body.referrer ?? null,
        ...(body.properties ?? {}),
      },
    },
    { onConflict: 'tenant_id,source,source_event_id', ignoreDuplicates: true }
  )
  if (canonicalError) {
    await sb
      .from('raw_events')
      .update({ rejection_reason: `canonico:${canonicalError.code ?? 'error'}` })
      .eq('id', rawRow.id)
    return NextResponse.json({ error: 'No se pudo normalizar el evento' }, { status: 500 })
  }

  await sb
    .from('raw_events')
    .update({ processing_status: 'normalized', processed_at: new Date().toISOString() })
    .eq('id', rawRow.id)

  return NextResponse.json({ accepted: true }, { status: 201 })
}

// OPTIONS para que el navegador permita el POST cross-origin desde los dominios autorizados.
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })
}
