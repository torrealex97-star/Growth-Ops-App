import { createClient } from '@/lib/supabase/client'

// Cierre de sesión robusto.
//
// El problema anterior: `supabase.auth.signOut()` usa scope 'global' por
// defecto, que hace una llamada de red al servidor para revocar la sesión.
// Si esa llamada va lenta o falla (red inestable), el botón se quedaba
// "pillado" porque no había estado de carga ni timeout, y `router.push` es
// una navegación cliente que no siempre limpia el estado cacheado del layout.
//
// Solución: cerrar sesión en local (instantáneo, sin esperar al servidor),
// con un timeout de seguridad, y redirigir con un hard reload para que la app
// se re-monte sin sesión ni usuario cacheado.
export async function performLogout(redirectTo = '/') {
  try {
    const supabase = createClient()
    await Promise.race([supabase.auth.signOut({ scope: 'local' }), new Promise((resolve) => setTimeout(resolve, 2500))])
  } catch {
    // Ignoramos: redirigimos igualmente.
  } finally {
    window.location.href = redirectTo
  }
}
