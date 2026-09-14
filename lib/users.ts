import type { SupabaseClient } from '@supabase/supabase-js'
import type { createClient } from '@/lib/supabase/client'

// Regla de negocio "quién puede ocupar cada rol de venta", antes duplicada literalmente entre
// el wizard de creación (ventas/registro/nueva) y el diálogo de edición (ventas/registro/[id]):
// el desplegable de "setter" incluye también cold callers (ambos agendan por utm_term y cobran
// como setter) y el de "closer" incluye admin (hay admins, ej. Jesús Peña, que también cierran
// ventas). Centralizado para que cambiar esta regla no requiera recordar tocarla en dos sitios.
export const isSetterRoleKey = (roleKey: string | null | undefined) => roleKey === 'setter' || roleKey === 'cold_caller'
export const isCloserRoleKey = (roleKey: string | null | undefined) => roleKey === 'closer' || roleKey === 'admin'
export const isAffiliateRoleKey = (roleKey: string | null | undefined) => roleKey === 'affiliate'

// Query compartida para el patrón "mapa id→nombre de usuarios activos" repetido en 6+ pantallas
// (Tareas, Biblioteca, Contenido, Eventos CSM, Gastos, Drops) dentro de sus propios Promise.all
// de carga inicial. Devuelve el query builder (thenable) sin await para que siga componiendo
// igual que la llamada inline que reemplaza — cero cambio de comportamiento, solo un sitio menos
// donde mantener la misma query si cambia el shape de `users`.
export function activeUserNamesQuery(supabase: ReturnType<typeof createClient>) {
  return supabase.from('users').select('id, full_name').eq('is_active', true).order('full_name')
}

// Nombres de los usuarios activos de UNA subcuenta, para dárselos como contexto a la IA (extraer
// una factura, repartir tareas de una transcripción…).
//
// POR QUÉ EXISTE. Esas dos rutas leían `users` con service-role y sin filtro: mandaban al modelo el
// nombre de TODOS los usuarios activos de la plataforma, incluidos los de otras subcuentas. Un
// nombre propio es un dato personal, y la pertenencia vive en `tenant_members`, así que el filtro
// tiene que pasar por ahí.
type MemberUser = { id: string; full_name: string | null; is_active: boolean | null }

export type TenantUser = { id: string; full_name: string }

/** Usuarios activos de una subcuenta (id + nombre), resueltos a través de `tenant_members`. */
export async function tenantActiveUsers(sb: SupabaseClient, tenantId: string): Promise<TenantUser[]> {
  const { data } = await sb
    .from('tenant_members')
    .select('users!inner(id, full_name, is_active)')
    .eq('tenant_id', tenantId)
    .limit(5000)
  const rows = (data ?? []) as unknown as Array<{ users: MemberUser | MemberUser[] | null }>
  return rows
    .map((row) => (Array.isArray(row.users) ? row.users[0] : row.users))
    .filter((u): u is MemberUser => !!u && u.is_active !== false && !!(u.full_name ?? '').trim())
    .map((u) => ({ id: u.id, full_name: (u.full_name ?? '').trim() }))
}

export async function tenantActiveUserNames(sb: SupabaseClient, tenantId: string): Promise<string[]> {
  return (await tenantActiveUsers(sb, tenantId)).map((u) => u.full_name)
}
