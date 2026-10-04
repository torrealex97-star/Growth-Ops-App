import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getTenantConfigWithFallback } from '@/lib/config'
import { meetingId, type FathomMeeting } from '@/lib/fathom/meetings'
import { procesarMeetingFathom } from '@/lib/fathom/ingesta'

export const runtime = 'nodejs'

// WEBHOOK DE FATHOM (new meeting content ready): ingesta EN TIEMPO REAL de reuniones.
//
// Por qué existe: la carga de Fathom era solo el botón de Integraciones › history-sync (pull paginado
// de toda la API). Una llamada de ventas quedaba sin transcripción hasta que alguien pulsara el
// botón — y el análisis de llamadas (cron analyze-calls) se quedaba esperando. Con el webhook, la
// reunión entra en cuanto Fathom termina de procesarla, emparejada con su cita por la MISMA regla
// canónica (lib/fathom/ingesta): matcher + cola de revisión, nunca una escritura a ciegas.
//
// Idempotencia: el payload lleva TODO el contenido (transcripción y resumen incluidos), así que no
// hay llamadas a la API de Fathom aquí. Reentregar la misma reunión es seguro: decideMatch la
// detecta como ya_importada y la cola de revisión es unique por (tenant_id, fathom_meeting_id).
//
// Firma: Fathom firma al estilo Svix — cabeceras webhook-id, webhook-timestamp y webhook-signature;
// HMAC-SHA256 (base64) de `${id}.${timestamp}.${body}` con el material del secreto (lo que va tras
// el prefijo whsec_). Tolerancia de 5 minutos contra replays. FAIL-CLOSED: sin secreto configurado
// en la subcuenta el endpoint rechaza TODO, y la respuesta es idéntica a la de una subcuenta
// inexistente para no servir de sondeo de tenants.

/** Verificación Svix de la firma. Devuelve false ante cualquier anomalía (fail-closed). */
function verifyFathomSignature(raw: string, headers: Headers, secret: string): boolean {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatureHeader = headers.get('webhook-signature')
  if (!id || !timestamp || !signatureHeader) return false
  const ts = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(ts)) return false
  const ahora = Math.floor(Date.now() / 1000)
  if (Math.abs(ahora - ts) > 300) return false
  // El secreto llega con prefijo whsec_: la firma usa solo el material base64 de después.
  const material = secret.includes('_') ? secret.split('_')[1] : secret
  const secretBytes = Buffer.from(material, 'base64')
  const signedContent = `${id}.${timestamp}.${raw}`
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64')
  // Cada firma va versionada ("v1,<base64>") y pueden venir varias separadas por espacio.
  const firmas = signatureHeader
    .split(' ')
    .map((firma) => {
      const partes = firma.split(',')
      return partes.length > 1 ? partes[1] : partes[0]
    })
    .filter(Boolean)
  return firmas.some((firma) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(firma))
    } catch {
      // Longitudes distintas: timingSafeEqual lanza. No es un match, no es un error del servidor.
      return false
    }
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const raw = await req.text()
    const { tenant } = await params
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: tenantRow } = await sb
      .from('tenants')
      .select('id, status')
      .eq('slug', tenant)
      .eq('status', 'active')
      .maybeSingle()
    // Subcuenta inexistente y firma inválida responden IGUAL: si no, este endpoint sirve para
    // averiguar qué subcuentas existen (mismo criterio que el webhook de Calendly).
    if (!tenantRow) return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
    const tenantId = tenantRow.id

    const cfg = await getTenantConfigWithFallback(tenantId, true)
    const secreto = cfg.FATHOM_WEBHOOK_SECRET || process.env.FATHOM_WEBHOOK_SECRET
    if (!secreto || !verifyFathomSignature(raw, req.headers, secreto)) {
      return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
    }

    // Cuerpo roto o vacío: 400 con registro en el log (mismo criterio que Calendly) — no hay nada
    // que reintentar y el motivo queda visible en el runtime.
    let body: ReturnType<typeof JSON.parse>
    try {
      body = JSON.parse(raw)
    } catch {
      console.warn(`[fathom] 400: cuerpo vacío o JSON inválido (longitud ${raw.length}); entrega no procesable`)
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const meeting = body as FathomMeeting
    if (!meetingId(meeting)) {
      // Un payload sin identificador estable no se puede procesar de forma idempotente. Se acusa
      // recibo con 200 para que Fathom no reenvíe para siempre algo que nunca va a encajar.
      console.warn('[fathom] entrega sin identificador de reunión (share_url/url): omitida')
      return NextResponse.json({ ok: true, omitida: 'sin_identificador' })
    }

    // La MISMA ingesta canónica que el botón de histórico: matcher, escritura de grabación +
    // resumen + transcripción, asistencia solo sobre lo no resuelto, y a la cola de revisión lo
    // dudoso. El webhook no decide nada por su cuenta.
    const resultado = await procesarMeetingFathom(sb, tenantId, meeting)
    return NextResponse.json({ ok: true, resultado })
  } catch (error) {
    // 500 para que Fathom reintente: un fallo transitorio (BD caída) no puede perder una reunión.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al procesar la reunión' },
      { status: 500 }
    )
  }
}
