// SESIÓN "VER COMO" (super admin entra como un colaborador y ve SUS paneles, exactamente como los
// ve él). El mecanismo es un CAMBIO DE SESIÓN real de Supabase — no una simulación de rol — porque
// "ver lo mismo que ve él" exige atravesar RLS con SU identidad: su data_scope, sus páginas
// permitidas, sus contratos, su nada.
//
// Piensa en el ticket como el guardarropas de un teatro:
//   · Al entrar como alguien, la sesión del super admin se guarda CERRADA (cifrada) en una cookie
//     aparte y el navegador recibe la sesión del otro usuario.
//   · La cookie de ticket solo la puede leer el servidor y solo con CONFIG_ENC_KEY: en el
//     navegador no hay nada que copiar y llevarse.
//   · El ticket CADUCA (30 min) y no sirve en otra subcuenta ni para otro usuario: lleva todo
//     dentro, firmado con la misma clave.
//   · "Salir" devuelve la sesión original tal cual se guardó.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

const VER = 'vc1' // versión del formato: si algún día cambia el payload, los tickets viejos caducan solos

export type TicketVerComo = {
  v: typeof VER
  /** Subcuenta donde empezó la sesión (el ticket no sirve en otra). */
  tenant: string
  /** Sesión del super admin, guardada para poder devolverla intacta. */
  superAdmin: {
    access_token: string
    refresh_token: string
    expires_at: number
    user_id: string
  }
  /** A quién se entró a ver (para el banner y la auditoría). */
  objetivo: { userId: string; email: string | null; nombre: string | null }
  /** Marca de emisión (ms). */
  iat: number
  /** Marca de caducidad (ms). */
  exp: number
  /** Aleatorio, para que dos tickets nunca coincidan. */
  nonce: string
}

/** Ventana de la sesión "ver como". Media hora es suficiente para revisar los paneles de alguien. */
export const VER_COMO_TTL_MS = 30 * 60 * 1000

const COOKIE_TICKET = 'vc-ticket'
export const cookieNombre = () => COOKIE_TICKET

function clave(): Buffer {
  const master = process.env.CONFIG_ENC_KEY
  if (!master) throw new Error('CONFIG_ENC_KEY no configurada (no se puede usar Ver como)')
  return createHash('sha256').update(`${master}:ver-como-v1`).digest()
}

export function sellarTicket(payload: Omit<TicketVerComo, 'v' | 'iat' | 'exp' | 'nonce'>, now = Date.now()): string {
  const completo: TicketVerComo = {
    ...payload,
    v: VER,
    iat: now,
    exp: now + VER_COMO_TTL_MS,
    nonce: randomBytes(12).toString('base64url'),
  }
  const body = Buffer.from(JSON.stringify(completo), 'utf8')
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', clave(), iv)
  const cifrado = Buffer.concat([c.update(body), c.final()])
  return `vc1.${iv.toString('base64url')}.${Buffer.concat([cifrado, c.getAuthTag()]).toString('base64url')}`
}

export type TicketResultado =
  | { ok: true; ticket: TicketVerComo }
  | { ok: false; motivo: 'formato' | 'clave' | 'integridad' | 'version' | 'caducado' | 'contenido' }

export function abrirTicket(valor: string | undefined | null, now = Date.now()): TicketResultado {
  if (!valor || typeof valor !== 'string') return { ok: false, motivo: 'formato' }
  const partes = valor.split('.')
  if (partes.length !== 3 || partes[0] !== 'vc1' || !partes[1] || !partes[2]) return { ok: false, motivo: 'version' }
  try {
    const iv = Buffer.from(partes[1], 'base64url')
    const datos = Buffer.from(partes[2], 'base64url')
    if (datos.length < 17) return { ok: false, motivo: 'formato' }
    const tag = datos.subarray(datos.length - 16)
    const texto = datos.subarray(0, datos.length - 16)
    const d = createDecipheriv('aes-256-gcm', clave(), iv)
    d.setAuthTag(tag)
    const ticket = JSON.parse(Buffer.concat([d.update(texto), d.final()]).toString('utf8')) as TicketVerComo
    if (ticket.v !== VER) return { ok: false, motivo: 'version' }
    if (typeof ticket.exp !== 'number' || ticket.exp < now) return { ok: false, motivo: 'caducado' }
    if (
      !ticket.superAdmin?.access_token ||
      !ticket.superAdmin?.refresh_token ||
      !ticket.superAdmin?.user_id ||
      !ticket.objetivo?.userId ||
      typeof ticket.tenant !== 'string' ||
      !ticket.tenant
    ) {
      return { ok: false, motivo: 'contenido' }
    }
    return { ok: true, ticket }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('auth') || msg.includes('key')) return { ok: false, motivo: 'integridad' }
    return { ok: false, motivo: 'contenido' }
  }
}

/** Cookies de sesión de Supabase (@supabase/ssr): nombres y contenido que hay que apuntar/cambiar. */
export function nombresCookiesSesion(ref: string): string[] {
  return [`sb-${ref}-auth-token`, `sb-${ref}-auth-token.code-verifier`]
}
