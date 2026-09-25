import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { allowedPrefixesFor, type AppRole } from './permissions'
import { requireTenant } from './requireTenant'
import { isAllowedLocation } from '@/lib/marketing-navigation'

// AUTORIZACIÓN POR PANTALLA PARA ENDPOINTS QUE ESQUIVAN RLS.
//
// EL PROBLEMA (auditoría F02). `requireTenant` comprueba que quien llama PERTENECE a la subcuenta.
// Eso basta cuando la consulta va con las credenciales de la persona y RLS decide qué filas ve. No
// basta cuando la ruta usa service-role o el cliente `postgres` directo, que se saltan RLS a
// propósito para poder contar filas que el rol no vería: ahí la única autorización es la que
// escriba la ruta, y varias no escribían ninguna. Esconder la entrada del menú no protege el
// endpoint: la dirección se puede pedir a mano.
//
// LA REGLA QUE SE REUTILIZA, EN VEZ DE INVENTAR OTRA. El layout ya decide a qué pantallas entra
// cada persona con `allowedPrefixesFor` (rol + los permisos por departamento o por página que le
// haya puesto un admin). Un endpoint que sirve los datos de una pantalla exige exactamente lo
// mismo. Una segunda lista de roles aquí divergiría de la del menú al primer cambio, y entonces la
// pantalla y su API discreparían sobre quién puede ver qué.

type Sesion = Exclude<Awaited<ReturnType<typeof requireTenant>>, { error: NextResponse }>

function servicio() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Comprueba pertenencia a la subcuenta Y acceso a la pantalla `ruta` (relativa, p. ej. `/funnels`).
 *
 * Devuelve la sesión resuelta o un 403. `ruta` es la misma que usa el menú, para que no haya dos
 * ideas de "quién ve esto".
 */
export async function requirePantalla(tenantSlug: string, ruta: string): Promise<Sesion | { error: NextResponse }> {
  const sesion = await requireTenant(tenantSlug)
  if ('error' in sesion) return sesion

  // El super admin de plataforma y quien administra esta subcuenta entran: es el mismo criterio del
  // layout, donde `allowedPrefixesFor` no restringe a los roles de liderazgo.
  if (sesion.isSuperAdmin) return sesion

  const { data } = await servicio()
    .from('users')
    .select('dept_overrides, page_overrides')
    .eq('id', sesion.userId)
    .maybeSingle()
  const overrides = (data ?? {}) as { dept_overrides?: string[] | null; page_overrides?: string[] | null }

  const zonas = allowedPrefixesFor(
    (sesion.role ?? 'setter') as AppRole,
    overrides.dept_overrides,
    overrides.page_overrides
  )
  // `undefined` o vacío = sin restricción (liderazgo). Es la convención de `allowedPrefixesFor`.
  if (!zonas || zonas.length === 0) return sesion
  if (isAllowedLocation(zonas, ruta)) return sesion

  return {
    error: NextResponse.json({ error: 'No tienes acceso a esta pantalla' }, { status: 403 }),
  }
}
