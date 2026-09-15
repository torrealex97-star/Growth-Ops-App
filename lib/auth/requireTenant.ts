import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { leerRolMembresia, resolverRol } from './rol-efectivo'
import type { AppRole } from './permissions'

/**
 * Server-side tenant resolution + membership check for API routes under
 * app/api/[tenant]/evergreen/**. Resolves the tenant slug to its id, verifies
 * the caller is authenticated and either a member of that tenant or a
 * platform super_admin, and returns the tenantId to filter every query by.
 * RLS is the real backstop (many of these routes use the service-role client,
 * which bypasses RLS entirely), so tenantId must be applied explicitly to
 * every read/write in the route body — never trust a client-supplied tenant_id.
 */
export async function requireTenant(tenantSlug: string): Promise<
  | {
      userId: string
      tenantId: string
      isSuperAdmin: boolean
      /**
       * El rol con el que se decide, YA ACOTADO a esta subcuenta (ver lib/auth/rol-efectivo.ts).
       * Un rol de administración que se tiene en la subcuenta propia no se ejerce en la de otro
       * cliente al que solo se ha dado acceso de miembro.
       */
      role: string | null
      /** El rol funcional global, sin acotar. Para diagnóstico y para explicar un 403, nunca para decidir. */
      rolGlobal: string | null
      /** ¿Administra ESTA subcuenta? (tenant_members.role en admin/super_admin, o super_admin de plataforma) */
      administraTenant: boolean
    }
  | { error: NextResponse }
> {
  const cookieStore = await cookies()
  const authed = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll() {},
    },
  })
  const {
    data: { user },
  } = await authed.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  }

  const { data: tenant } = await authed.from('tenants').select('id, status').eq('slug', tenantSlug).maybeSingle()
  if (!tenant || tenant.status !== 'active') {
    return { error: NextResponse.json({ error: 'Subcuenta no encontrada' }, { status: 404 }) }
  }

  const { data: isSuperAdminData } = await authed.rpc('is_super_admin')
  const isSuperAdmin = !!isSuperAdminData

  // El rol de tenencia EN ESTA SUBCUENTA se lee aquí, junto con la membresía: es lo que pone el techo
  // al rol funcional (que es global y por tanto el mismo en todas las subcuentas).
  let rolMembresia: ReturnType<typeof leerRolMembresia> = null
  if (!isSuperAdmin) {
    const { data: membership } = await authed
      .from('tenant_members')
      .select('id, role')
      .eq('tenant_id', tenant.id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) {
      return { error: NextResponse.json({ error: 'No tienes acceso a esta subcuenta' }, { status: 403 }) }
    }
    rolMembresia = leerRolMembresia((membership as { role?: unknown }).role)
  }

  // Resuelto aquí una sola vez para que las ~40 rutas que necesitan el rol del caller
  // (para decidir admin/director/manager-only) no repitan el mismo lookup a `users` por su cuenta.
  const { data: callerRow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
  const rolGlobal = ((callerRow?.roles as { key?: string } | null)?.key ?? null) as AppRole | null

  // AQUÍ SE CIERRA LA ESCALADA. `role` sale ya acotado, así que las ~11 rutas que comprueban
  // `['admin','director'].includes(auth.role)` se aprietan solas sin tocarlas una por una: el fallo por
  // defecto pasa a ser denegar. `rolGlobal` queda disponible para poder explicar el motivo.
  const resuelto = resolverRol({ rolGlobal, rolMembresia, esSuperAdmin: isSuperAdmin })

  return {
    userId: user.id,
    tenantId: tenant.id,
    isSuperAdmin,
    role: resuelto.rol,
    rolGlobal: resuelto.rolGlobal,
    administraTenant: resuelto.administraTenant,
  }
}
