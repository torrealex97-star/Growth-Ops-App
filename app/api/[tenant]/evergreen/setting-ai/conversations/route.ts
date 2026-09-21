import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { InstagramApiError, type InstagramErrorCode } from '@/lib/instagram/client'
import {
  getInstagramConfig,
  resolveIgUserId,
  resolveFbPageId,
  getPageAccessToken,
  fetchIgConversationsWithMessages,
} from '@/lib/instagram/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// El trabajo real son ~9 llamadas a la Graph API (3 de resolución + listado + detalles en
// paralelo con pool de 5). Con el timeout de 15s por llamada del cliente, el peor caso
// honesto cabe de sobra aquí; 60 solo servía para que el usuario mirara una rueda girando
// antes del error.
export const maxDuration = 30

// Lista conversaciones (DMs) con su transcripción, para la pestaña "Conversaciones" de
// Setting AI. Instagram trae datos reales (mismo cliente que usa el sync orgánico);
// Facebook y TikTok todavía no tienen integración de mensajería, así que devuelven
// configured:false para que el front pinte un placeholder "próximamente".
//
// Un fallo de la Graph API NO es un error del servidor: si el token caducó o falta el
// permiso de mensajería, la integración no está operativa y se responde como tal
// (configured:false + motivo). Antes un 500 genérico —o el timeout de la lambda— dejaba
// la pantalla muerta sin decirle al usuario qué arreglar.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  const platform = req.nextUrl.searchParams.get('platform') || 'instagram'
  if (platform !== 'instagram') {
    return NextResponse.json({ configured: false, platform, conversations: [] })
  }

  const cfg = getInstagramConfig(await getTenantConfigWithFallback(t.tenantId, true))
  if (!cfg) return NextResponse.json({ configured: false, platform, conversations: [] })

  try {
    const { id: igUserId } = await resolveIgUserId(cfg)
    const pageId = await resolveFbPageId(cfg, igUserId)
    if (!pageId) return NextResponse.json({ configured: false, platform, conversations: [] })
    const pat = await getPageAccessToken(cfg, pageId)
    if (!pat) return NextResponse.json({ configured: false, platform, conversations: [] })
    const conversations = await fetchIgConversationsWithMessages(cfg, pageId, pat, igUserId, 20)
    return NextResponse.json({ configured: true, platform, conversations })
  } catch (e) {
    if (e instanceof InstagramApiError) {
      return NextResponse.json({
        configured: false,
        platform,
        conversations: [],
        motivo: motivoLegible(e.code, e.message),
      })
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

function motivoLegible(code: InstagramErrorCode, message: string): string {
  if (code === 'token_caducado') return 'El token de Instagram ha caducado: renuévalo en Integraciones.'
  if (code === 'sin_permisos')
    return 'Al token le falta el permiso instagram_manage_messages (acceso avanzado). Conéctalo en Integraciones.'
  if (code === 'limite_de_uso') return 'Instagram está limitando las peticiones ahora mismo: inténtalo en unos minutos.'
  if (code === 'timeout') return 'Instagram tardó demasiado en responder. Inténtalo de nuevo.'
  return `Instagram rechazó la petición: ${message}`
}
