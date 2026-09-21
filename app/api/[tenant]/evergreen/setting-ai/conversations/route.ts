import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { InstagramApiError, type InstagramErrorCode, type IgConversation } from '@/lib/instagram/client'
import {
  getInstagramConfig,
  resolveIgUserId,
  resolveFbPageId,
  getPageAccessToken,
  fetchIgConversationsWithMessages,
} from '@/lib/instagram/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Vercel Hobby permite 60s. El trabajo sano tarda 5-20s; el plazo duro de abajo (25s) decide
// SIEMPRE antes de que Vercel mate la función — 60 es solo margen para que la respuesta
// tardía de Meta no reviente la lambda.
export const maxDuration = 60

// Lista conversaciones (DMs) con su transcripción, para la pestaña "Conversaciones" de
// Setting AI. Instagram trae datos reales (mismo cliente que usa el sync orgánico);
// Facebook y TikTok todavía no tienen integración de mensajería, así que devuelven
// configured:false para que el front pinte un placeholder "próximamente".
//
// Dos capas de defensa contra la lentitud de Meta (endpoint de conversaciones más pesado
// que el resto de la Graph API: hoy dio error #1 y un timeout SUYO en la misma página):
//   1. PLAZO DURO de 25s a nivel de ruta: cualquiera que sea lo que esté haciendo la
//      descarga, a los 25s responde JSON usable (configured:false + motivo). Nunca más
//      FUNCTION_INVOCATION_TIMEOUT ni rueda eterna.
//   2. Presupuesto interno del cliente (ver fetchIgConversationsWithMessages): reintento
//      ligero del listado y degradación de detalles que no lleguen.
// Un fallo de la Graph API NO es un error del servidor: token caducado o falta de permiso
// se responden como integración no operativa (configured:false + motivo accionable).
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  const platform = req.nextUrl.searchParams.get('platform') || 'instagram'
  if (platform !== 'instagram') {
    return NextResponse.json({ configured: false, platform, conversations: [] })
  }

  const resultado = await conPlazo(descargar(tenant, platform), 25_000)
  if (resultado === PLAZO) {
    return NextResponse.json({
      configured: false,
      platform,
      conversations: [],
      motivo: 'Instagram no respondió a tiempo. Inténtalo de nuevo en unos minutos.',
    })
  }
  return NextResponse.json(resultado)
}

const PLAZO = Symbol('plazo-agotado')
function conPlazo<T>(p: Promise<T>, ms: number): Promise<T | typeof PLAZO> {
  return Promise.race([p, new Promise<typeof PLAZO>((r) => setTimeout(() => r(PLAZO), ms))])
}

type RespuestaConvos = {
  configured: boolean
  platform: string
  conversations: IgConversation[]
  motivo?: string
  error?: string
}

async function descargar(tenant: string, platform: string): Promise<RespuestaConvos> {
  const cfg = getInstagramConfig(await getTenantConfigWithFallback(tenant, true))
  if (!cfg) return { configured: false, platform, conversations: [] }

  try {
    const { id: igUserId } = await conEtapa('resolver cuenta IG', () => resolveIgUserId(cfg))
    const pageId = await resolveFbPageId(cfg, igUserId)
    if (!pageId)
      return {
        configured: false,
        platform,
        conversations: [],
        motivo: `Ninguna página de Facebook del token tiene vinculada la cuenta IG (${igUserId}). Revisa que la página esté asignada al System User. [ig=${igUserId}]`,
      }
    const pat = await conEtapa('obtener page access token', () => getPageAccessToken(cfg, pageId))
    if (!pat)
      return {
        configured: false,
        platform,
        conversations: [],
        motivo: `La página ${pageId} no devolvió un page access token: revisa que esté asignada al System User del token y que este tenga pages_show_list. [page=${pageId}]`,
      }
    const conversations = await conEtapa('listar conversaciones', () =>
      fetchIgConversationsWithMessages(cfg, pageId, pat, igUserId, 20)
    )
    return { configured: true, platform, conversations }
  } catch (e) {
    if (e instanceof InstagramApiError) {
      return { configured: false, platform, conversations: [], motivo: motivoLegible(e.code, e.message) }
    }
    return { configured: false, platform, conversations: [], error: (e as Error).message }
  }
}

// Cuando IG rechaza una llamada, el motivo debe decir QUÉ llamada fue: si no, el
// diagnóstico en producción es adivinanza (el detalle por conversación ya se degrada solo).
async function conEtapa<T>(etapa: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof InstagramApiError) throw new InstagramApiError(`${etapa}: ${e.message}`, e.code)
    throw e
  }
}

function motivoLegible(code: InstagramErrorCode, message: string): string {
  // El detalle SIEMPRE: sin la etapa que falló, diagnosticar en producción es una adivinanza.
  if (code === 'token_caducado') return `El token de Instagram ha caducado: renuévalo en Integraciones. [${message}]`
  if (code === 'sin_permisos')
    return `Al token le falta el permiso instagram_manage_messages (acceso avanzado). [${message}]`
  if (code === 'limite_de_uso') return `Instagram está limitando las peticiones ahora mismo. [${message}]`
  if (code === 'timeout') return `Instagram tardó demasiado en responder. Inténtalo de nuevo. [${message}]`
  return message
}
