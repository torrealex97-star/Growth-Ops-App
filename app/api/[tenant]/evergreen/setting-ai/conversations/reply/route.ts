import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { cfgDesdeEnv, enviarMensajeGhl, GhlConversacionesError, leerSnapshotGhl } from '@/lib/ghl/conversaciones'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Respuesta del inbox a un lead de GHL (petición de Alex, 1-oct): escribir aquí debe poder
// enviarse por el canal de la conversación (IG, TikTok, FB, WhatsApp, SMS, email) sin salir de
// la bandeja. Efecto externo IRREVERSIBLE (un DM real al lead) — la protección es doble
// validación: el texto sale al contacto de ESA conversación y la conversación debe pertenecer
// al tenant (se resuelve contra el snapshot del propio tenant; nada del cliente se confía:
// ni contactId ni canal salen del cliente).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const tenantId = t.tenantId

  let body: { conversationId?: unknown; texto?: unknown }
  try {
    body = (await req.json()) as { conversationId?: unknown; texto?: unknown }
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido.' }, { status: 400 })
  }
  const texto = typeof body.texto === 'string' ? body.texto.trim() : ''
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
  if (!texto) return NextResponse.json({ error: 'El mensaje está vacío.' }, { status: 400 })
  if (!conversationId) return NextResponse.json({ error: 'Falta la conversación.' }, { status: 400 })
  if (texto.length > 2000)
    return NextResponse.json({ error: 'El mensaje supera 2000 caracteres. Divídelo en dos.' }, { status: 400 })

  const snap = await leerSnapshotGhl(tenantId)
  const conv = snap?.conversaciones.find((c) => c.id === conversationId)
  if (!conv)
    return NextResponse.json(
      { error: 'Conversación no encontrada en tu bandeja. Refresca la pestaña e inténtalo de nuevo.' },
      { status: 404 }
    )
  if (!conv.contactId)
    return NextResponse.json(
      { error: 'Esta conversación no tiene contacto de GHL: no se puede responder.' },
      { status: 400 }
    )

  const cfg = cfgDesdeEnv(await getTenantConfigWithFallback(tenantId, true))
  if (!cfg) {
    return NextResponse.json(
      { error: 'Faltan el token o el Location ID de GoHighLevel. Configúralos en Configuración → Integraciones.' },
      { status: 400 }
    )
  }

  try {
    const { messageId } = await enviarMensajeGhl(cfg, {
      conversacionId: conv.id,
      contactId: conv.contactId,
      canal: conv.channel ?? 'chat',
      texto,
    })
    return NextResponse.json({ ok: true, messageId })
  } catch (e) {
    if (e instanceof GhlConversacionesError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error enviando el mensaje' }, { status: 500 })
  }
}
