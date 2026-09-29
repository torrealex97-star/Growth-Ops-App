import { NextRequest, NextResponse, after } from 'next/server'
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
import { edadLegible, guardarSnapshot, leerSnapshot } from '@/lib/instagram/snapshot'
import {
  cfgDesdeEnv,
  descargarConversacionesGhl,
  guardarSnapshotGhl,
  leerSnapshotGhl,
  vincularConContactos,
  type GhConversation,
} from '@/lib/ghl/conversaciones'
import { serviceClient } from '@/lib/integrations/citas-sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Vercel Hobby permite 60s. El trabajo sano tarda 5-20s; el plazo duro de abajo (25s) decide
// SIEMPRE antes de que Vercel mate la función — 60 es solo margen para que la respuesta
// tardía de Meta no reviente la lambda.
export const maxDuration = 60

// Lista conversaciones con su transcripción, para la pestaña "Conversaciones" de Setting AI.
// Instagram trae datos reales (mismo cliente que usa el sync orgánico). GHL también: pull bajo
// demanda de /conversations/search + mensajes de la API v2 (lib/ghl/conversaciones.ts) con la
// MISMA mecánica de snapshot stale; es la bandeja unificada de la subcuenta (SMS, Facebook,
// Instagram, WhatsApp, email) y cada conversación llega vinculada al perfil del CRM cuando hay
// match (ghl_contact_id → email → teléfono). Facebook y TikTok directos siguen sin integración
// de mensajería: configured:false para que el front pinte un placeholder "próximamente".
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
  if (platform !== 'instagram' && platform !== 'ghl') {
    return NextResponse.json({ configured: false, platform, conversations: [] })
  }

  // GHL: mismo contrato que Instagram (snapshot → stale + refresco en after() → descarga con
  // plazo duro). Sin credencial o con GHL caído: configured:false con motivo accionable, o el
  // último snapshot correcto con su edad declarada — nunca una lista vacía que parezca
  // "no hay chats" (un error de carga no es un estado vacío).
  if (platform === 'ghl') {
    const snap = await leerSnapshotGhl(t.tenantId)
    if (snap) {
      const fresco = Date.now() - new Date(snap.guardado).getTime() < 3 * 60_000
      if (!fresco) {
        after(async () => {
          await descargarGhl(t.tenantId).catch(() => null) // guardarSnapshotGhl ocurre dentro
        })
      }
      return NextResponse.json({
        configured: true,
        platform,
        conversations: snap.conversaciones,
        motivo: `Último snapshot correcto (${edadLegible(snap.guardado)}).`,
        stale: true,
        guardado: snap.guardado,
      })
    }
    const resultadoGhl = await conPlazo(descargarGhl(t.tenantId), 25_000)
    if (resultadoGhl === PLAZO) {
      return NextResponse.json({
        configured: false,
        platform,
        conversations: [],
        motivo: 'GHL no respondió a tiempo. Inténtalo de nuevo en unos minutos.',
      })
    }
    return NextResponse.json(resultadoGhl)
  }

  // getTenantConfigWithFallback indexa por tenantId (UUID), no por slug: pasar el slug
  // devolvía vacío en silencio → "configured:false" pelado aunque la integración esté bien.
  // CON SNAPSHOT: responder YA (el listado de Meta tarda 15-40s cuando va mal) y refrescar
  // en segundo plano con after() — el usuario nunca espera a un upstream inestable.
  const snap = await leerSnapshot(t.tenantId)
  if (snap) {
    const fresco = Date.now() - new Date(snap.guardado).getTime() < 3 * 60_000
    if (!fresco) {
      after(async () => {
        await descargar(t.tenantId, platform).catch(() => null) // guardarSnapshot ocurre dentro
      })
    }
    return NextResponse.json({
      configured: true,
      platform,
      conversations: snap.conversaciones,
      motivo: `Último snapshot correcto (${edadLegible(snap.guardado)}).`,
      stale: true,
      guardado: snap.guardado,
    })
  }
  const resultado = await conPlazo(descargar(t.tenantId, platform), 25_000)
  if (resultado === PLAZO) {
    // Meta no respondió ni siquiera al plazo duro: respaldo stale si existe (con su edad),
    // nunca un error pelado.
    const snap = await leerSnapshot(t.tenantId)
    if (snap) {
      return NextResponse.json({
        configured: true,
        platform,
        conversations: snap.conversaciones,
        motivo: `Instagram no respondió a tiempo; mostrando el último snapshot correcto (${edadLegible(snap.guardado)}).`,
        stale: true,
        guardado: snap.guardado,
      })
    }
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
  conversations: (IgConversation | GhConversation)[]
  motivo?: string
  error?: string
  stale?: boolean
  guardado?: string
}

// Descarga GHL: credenciales del tenant (decryptSecret de integration_settings vía config con
// fallback a env), pull con presupuesto interno de 20s (por debajo del plazo duro de 25s de la
// ruta), vinculación con contacts y snapshot como respaldo. Un fallo de vinculación por BD es
// un error ruidoso (no una lista "sin perfil" que parezca que no hay matches).
async function descargarGhl(tenantId: string): Promise<RespuestaConvos> {
  const platform = 'ghl'
  const cfg = cfgDesdeEnv(await getTenantConfigWithFallback(tenantId, true))
  if (!cfg) {
    return {
      configured: false,
      platform,
      conversations: [],
      motivo: 'Faltan el token o el Location ID de GoHighLevel. Configúralos en Configuración → Integraciones.',
    }
  }
  try {
    const conversaciones = await descargarConversacionesGhl(cfg, { limite: 20, deadlineMs: Date.now() + 20_000 })
    await vincularConContactos(serviceClient(), tenantId, conversaciones)
    // Descarga buena: queda como respaldo para cuando GHL no responda (se guarda DESPUÉS de
    // vincular, para que el snapshot conserve también la vinculación con perfiles).
    if (conversaciones.length) await guardarSnapshotGhl(tenantId, conversaciones)
    return { configured: true, platform, conversations: conversaciones }
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e)
    const snap = await leerSnapshotGhl(tenantId)
    if (snap) {
      return {
        configured: true,
        platform,
        conversations: snap.conversaciones,
        motivo: `GHL no respondió (${mensaje}); mostrando el último snapshot correcto (${edadLegible(snap.guardado)}).`,
        stale: true,
        guardado: snap.guardado,
      }
    }
    return { configured: false, platform, conversations: [], motivo: `GHL no respondió: ${mensaje}` }
  }
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
    // Descarga buena: queda como respaldo para cuando Meta vuelva a colgarse.
    if (conversations.length) await guardarSnapshot(tenant, conversations)
    return { configured: true, platform, conversations }
  } catch (e) {
    const base = { platform, conversations: [] as IgConversation[] }
    if (e instanceof InstagramApiError) {
      const motivo = motivoLegible(e.code, e.message)
      const snap = await leerSnapshot(tenant)
      if (snap)
        return {
          configured: true,
          ...base,
          conversations: snap.conversaciones,
          motivo: `${motivo} Mostrando el último snapshot correcto (${edadLegible(snap.guardado)}).`,
          stale: true,
          guardado: snap.guardado,
        }
      return { configured: false, ...base, motivo }
    }
    const snap = await leerSnapshot(tenant)
    if (snap)
      return {
        configured: true,
        ...base,
        conversations: snap.conversaciones,
        motivo: `Error técnico (${(e as Error).message}); mostrando el último snapshot correcto (${edadLegible(snap.guardado)}).`,
        stale: true,
        guardado: snap.guardado,
      }
    return { configured: false, ...base, error: (e as Error).message }
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
