import { classifyMetaError } from '@/lib/meta/errors'
import { graphUrl, META_API_VERSION } from '@/lib/meta/api-version'
import { metaProof } from '@/lib/meta/salud'
import { inspeccionarToken } from '@/lib/meta/token'
import { veredictoDeToken } from '@/lib/meta/token-salud'

// COMPROBACIÓN DE SALUD DE INSTAGRAM, EN UN SOLO SITIO.
//
// Vivía dentro del `probeGroup` de la ruta de Integraciones. Sale aquí por lo mismo que la de Meta:
// la pantalla y los crons tienen que dar el MISMO veredicto sobre la misma credencial, y los crons no
// pueden importar una función que vive dentro de una ruta.

export type ConfigSaludInstagram = {
  INSTAGRAM_ACCESS_TOKEN?: string
  META_ACCESS_TOKEN?: string
  META_API_VERSION?: string
  META_APP_SECRET?: string
  META_APP_ID?: string
  IG_USER_ID?: string
}

export type VeredictoInstagram = { ok: boolean; message: string; code?: string }

const TIMEOUT_MS = 10_000

export async function comprobarSaludInstagram(cfg: ConfigSaludInstagram): Promise<VeredictoInstagram> {
  const token = cfg.INSTAGRAM_ACCESS_TOKEN || cfg.META_ACCESS_TOKEN
  // Falta de credencial NO es avería: es configuración pendiente (ver S0.7 §3.5).
  if (!token) return { ok: false, message: 'Falta el token de Instagram/Meta.', code: 'sin_credenciales' }
  const ver = cfg.META_API_VERSION || META_API_VERSION
  const proof = metaProof(token, cfg.META_APP_SECRET)
  const qs = `&access_token=${encodeURIComponent(token.trim())}${proof ? `&appsecret_proof=${proof}` : ''}`
  // Se comprueba la CUENTA que se va a sincronizar (IG_USER_ID), no solo que el token exista. Antes
  // bastaba con que `/me/accounts` respondiera: con un IG_USER_ID equivocado la pantalla decía «Token
  // válido» y luego no llegaba ni una publicación, sin que nadie supiera por qué.
  const objetivo = cfg.IG_USER_ID
    ? `${encodeURIComponent(cfg.IG_USER_ID.trim())}?fields=username,media_count`
    : `me/accounts?fields=name`
  const r = await fetch(graphUrl(ver, objetivo) + qs, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  const j = (await r.json().catch(() => ({}))) as { username?: string; media_count?: number; error?: unknown }
  if (!r.ok || j.error) {
    const causa = classifyMetaError(j, r.status)
    return { ok: false, message: causa.message, code: causa.code }
  }
  if (!j.username) {
    return {
      ok: true,
      message: 'El token vale, pero falta IG_USER_ID: sin él no se sabe qué cuenta sincronizar.',
    }
  }

  // El token funciona. Se le pregunta a Meta cómo es: tipo, caducidad y permisos reales.
  const base = `Cuenta @${j.username} conectada (${j.media_count ?? 0} publicaciones).`
  const inspeccion = await inspeccionarToken(token, {
    version: ver,
    appSecret: cfg.META_APP_SECRET,
    appId: cfg.META_APP_ID,
  })
  const veredicto = veredictoDeToken(inspeccion, 'instagram')
  if (!veredicto.ok) return { ok: false, message: `${base} ${veredicto.mensaje}`, code: veredicto.code }
  return { ok: true, message: veredicto.mensaje ? `${base} ${veredicto.mensaje}` : base }
}
