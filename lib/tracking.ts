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
//
// ACOTADO A LA SUBCUENTA. `users` es una tabla GLOBAL (la pertenencia vive en `tenant_members`), así
// que sin este filtro un utm_term resolvía a cualquier usuario de la plataforma: una agenda de la
// subcuenta A podía quedar atribuida a un setter de la B, y con ella su comisión. Además
// `.maybeSingle()` devolvía null en silencio si dos usuarios de subcuentas distintas compartían
// código — la atribución se perdía sin un solo error.
export async function resolveUserIdByTrackingCode(
  sb: SupabaseClient,
  code: string | null | undefined,
  tenantId: string
): Promise<string | null> {
  const c = normalizeTrackingCode(code)
  if (!c || !tenantId) return null
  // c no contiene comodines (%,_) porque el alfabeto es alfanumérico, así que ilike == igualdad
  // insensible a mayúsculas.
  const { data } = await sb.from('users').select('id').ilike('tracking_code', c).limit(20)
  const ids = (data ?? []).map((u) => (u as { id: string }).id)
  if (ids.length === 0) return null
  return firstMemberOf(sb, tenantId, ids)
}

/** De una lista de usuarios, el primero que sea miembro de esta subcuenta. */
export async function firstMemberOf(sb: SupabaseClient, tenantId: string, userIds: string[]): Promise<string | null> {
  if (userIds.length === 0 || !tenantId) return null
  const { data } = await sb
    .from('tenant_members')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .in('user_id', userIds)
    .limit(1)
  const row = (data ?? [])[0] as { user_id: string } | undefined
  return row?.user_id ?? null
}
