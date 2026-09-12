import type { SupabaseClient } from '@supabase/supabase-js'

// Alfabeto tipo Crockford sin caracteres ambiguos (sin 0/o, 1/l/i) para códigos legibles al copiar.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

// Genera un código de tracking OPACO (no derivado del nombre) para el utm_term de los enlaces.
// Es aleatorio, URL-safe y sin caracteres ambiguos, para mantener la privacidad del rep: por la
// URL no se puede deducir quién es el setter/closer/cold caller.
export function generateTrackingCode(length = 8): string {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

// Normaliza un código para comparar sin depender de mayúsculas ni espacios sobrantes.
export function normalizeTrackingCode(code: string | null | undefined): string {
  return (code ?? '').trim().toLowerCase()
}

// Genera un código único comprobando colisiones contra users.tracking_code. Sirve tanto en cliente
// (browser client, admin) como en servidor (service role).
export async function generateUniqueTrackingCode(sb: SupabaseClient, excludeUserId?: string): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = generateTrackingCode(8)
    let q = sb.from('users').select('id').eq('tracking_code', candidate)
    if (excludeUserId) q = q.neq('id', excludeUserId)
    const { data } = await q.maybeSingle()
    if (!data) return candidate
  }
  // Fallback prácticamente imposible: código más largo
  return generateTrackingCode(12)
}

// Punto ÚNICO de verdad para resolver el user.id a partir de un utm_term. Case-insensitive y
// tolerante a espacios. Usado por los webhooks (Calendly/GHL) y por la atribución de comisiones,
// para que un enlace resuelva siempre igual sin importar mayúsculas.
export async function resolveUserIdByTrackingCode(
  sb: SupabaseClient,
  code: string | null | undefined
): Promise<string | null> {
  const c = normalizeTrackingCode(code)
  if (!c) return null
  // c no contiene comodines (%,_) porque el alfabeto es alfanumérico, así que ilike == igualdad
  // insensible a mayúsculas.
  const { data } = await sb.from('users').select('id').ilike('tracking_code', c).maybeSingle()
  return (data?.id as string | undefined) ?? null
}
