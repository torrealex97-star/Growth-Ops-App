import type { createClient } from '@/lib/supabase/client'

// Regla de negocio "quién puede ocupar cada rol de venta", antes duplicada literalmente entre
// el wizard de creación (ventas/registro/nueva) y el diálogo de edición (ventas/registro/[id]):
// el desplegable de "setter" incluye también cold callers (ambos agendan por utm_term y cobran
// como setter) y el de "closer" incluye admin (hay admins, ej. [tenant], que también cierran
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
