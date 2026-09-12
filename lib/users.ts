import type { createClient } from '@/lib/supabase/client'

// Query compartida para el patrón "mapa id→nombre de usuarios activos" repetido en 6+ pantallas
// (Tareas, Biblioteca, Contenido, Eventos CSM, Gastos, Drops) dentro de sus propios Promise.all
// de carga inicial. Devuelve el query builder (thenable) sin await para que siga componiendo
// igual que la llamada inline que reemplaza — cero cambio de comportamiento, solo un sitio menos
// donde mantener la misma query si cambia el shape de `users`.
export function activeUserNamesQuery(supabase: ReturnType<typeof createClient>) {
  return supabase.from('users').select('id, full_name').eq('is_active', true).order('full_name')
}
