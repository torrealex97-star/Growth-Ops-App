import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { mapResendEventToStatus, shouldAdvanceStatus } from '@/lib/email/service'

export const runtime = 'nodejs'

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK DE RESEND → historial de emails
// ─────────────────────────────────────────────────────────────────────────────
// Resend entrega los eventos firmados con svix (cabeceras svix-id, svix-timestamp,
// svix-signature) sobre `data.data.id` = id del email (`re_…`) que coincide con el
// `provider_message_id` registrado en email_messages.
//
// SEGURIDAD (§19):
//  · Verificación criptográfica svix con RESEND_WEBHOOK_SECRET (Integraciones/env).
//    Sin secreto configurado el endpoint rechaza (fail-closed) en producción y
//    solo tolera modo dev explícito con EMAIL_WEBHOOK_INSECURE=1.
//  · Idempotente: UNIQUE(provider, provider_event_id) — el reenvío de un evento
//    no duplica (ON CONFLICT DO NOTHING) ni retrocede estados.
//  · Multi-tenant: el tenant SIEMPRE sale de la fila email_messages asociada al
//    id del proveedor — jamás del payload del cliente.
//  · Nunca 500 ante un evento desconocido/duplicado: 200 para que Resend no
//    reenvíe infinitamente; los desconocidos se ignoran con log.

const EVENT_STATUS_MAP: Record<string, (m: Record<string, unknown>) => Partial<Record<string, unknown>>> = {
  'email.sent': () => ({ sent_at: new Date().toISOString() }),
  'email.delivered': () => ({ delivered_at: new Date().toISOString() }),
  'email.opened': () => ({ opened_at: new Date().toISOString() }),
  'email.clicked': () => ({ clicked_at: new Date().toISOString() }),
  'email.bounced': () => ({ bounced_at: new Date().toISOString() }),
  'email.bounced.hard': () => ({ bounced_at: new Date().toISOString() }),
  'email.bounced.soft': () => ({ bounced_at: new Date().toISOString() }),
  'email.complained': () => ({}),
  'email.failed': () => ({}),
}

export async function POST(req: NextRequest) {
  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')
  const secret = process.env.RESEND_WEBHOOK_SECRET
  const insecureDev = process.env.EMAIL_WEBHOOK_INSECURE === '1'

  const raw = await req.text()

  // ── Verificación svix (HMAC-SHA256 sobre `${id}.${timestamp}.${payload}`) ──
  if (secret && svixId && svixTimestamp && svixSignature) {
    const { createHmac, timingSafeEqual } = await import('node:crypto')
    const ts = Number(svixTimestamp)
    // Rechazar reemplazos antiguos (> 5 min) — anti-replay.
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      return NextResponse.json({ error: 'timestamp inválido' }, { status: 400 })
    }
    const expected = createHmac('sha256', secret.replace(/^whsec_/, ''))
      .update(`${svixId}.${svixTimestamp}.${raw}`)
      .digest('base64')
    const got = svixSignature.split(' ').map((v) => v.split(',')[1] ?? v)
    const ok = got.some((g) => {
      try {
        const a = Buffer.from(g, 'base64')
        const b = Buffer.from(expected, 'base64')
        return a.length === b.length && timingSafeEqual(a, b)
      } catch {
        return false
      }
    })
    if (!ok) return NextResponse.json({ error: 'firma inválida' }, { status: 401 })
  } else if (!insecureDev) {
    // fail-closed: sin secreto configurado no se procesa nada en producción.
    return NextResponse.json({ error: 'webhook sin verificar' }, { status: 401 })
  }

  let body: { type?: string; data?: { id?: string; error_message?: string | null } }
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'payload inválido' }, { status: 400 })
  }

  const type = body.type ?? ''
  const providerMessageId = body.data?.id ?? ''
  const status = mapResendEventToStatus(type)
  if (!status || !providerMessageId) {
    // Evento no relevante (p.ej. email.received) o sin id: OK para Resend.
    return NextResponse.json({ ok: true, ignored: true })
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // El tenant sale del registro interno, NUNCA del payload.
  const { data: msg } = await sb
    .from('email_messages')
    .select('id, tenant_id, status, error_message')
    .eq('provider_message_id', providerMessageId)
    .eq('provider', 'resend')
    .maybeSingle()
  if (!msg) return NextResponse.json({ ok: true, ignored: 'mensaje no registrado' })

  // 1) Timeline idempotente (UNIQUE provider+provider_event_id).
  await sb.from('email_events').upsert(
    {
      tenant_id: msg.tenant_id,
      email_message_id: msg.id,
      provider: 'resend',
      provider_event_id: svixId ?? `${type}:${providerMessageId}:${Date.now()}`,
      event_type: type,
      event_payload: body.data ?? {},
      event_timestamp: svixTimestamp ? new Date(Number(svixTimestamp) * 1000).toISOString() : new Date().toISOString(),
    },
    { onConflict: 'provider,provider_event_id', ignoreDuplicates: true }
  )

  // 2) Estado del mensaje: solo avanza (nunca DELIVERED→SENT) + timestamps.
  if (shouldAdvanceStatus(msg.status, status)) {
    const patch: Record<string, unknown> = { status }
    const extra = EVENT_STATUS_MAP[type]?.(body.data ?? {}) ?? {}
    for (const [k, v] of Object.entries(extra)) patch[k] = v
    if (status === 'FAILED' || status === 'BOUNCED') {
      patch.error_message = body.data?.error_message ?? `Evento ${type} del proveedor`
    }
    await sb.from('email_messages').update(patch).eq('id', msg.id)
  }

  return NextResponse.json({ ok: true })
}
