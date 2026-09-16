'use client'

import { createContext, useContext } from 'react'
import { resolveTenantBranding, type TenantBranding } from '@/lib/tenant-branding'

/**
 * La sesión que el layout YA resolvió.
 *
 * POR QUÉ ESTÁ AQUÍ. 32 pantallas repetían `supabase.auth.getUser()` y 24 de ellas volvían a pedir
 * `users` + `roles(key)` — justo lo que app/[tenant]/layout.tsx acaba de traer para poder decidir si
 * dejarlas entrar. Eran dos viajes de red EN SERIE por pantalla, antes de pedir sus propios datos, para
 * releer algo que ya estaba en memoria. Publicarlo aquí los elimina sin cambiar ninguna consulta.
 *
 * `user` viene del `select('*, roles(key, name)')` del layout, así que trae todas las columnas: no hace
 * falta volver a la tabla para leer `data_scope`, `base_salary` o las de fijo.
 */
export type SesionTenant = {
  userId: string
  /** La fila de `users` con su rol, tal cual la trajo el layout. */
  user: Record<string, unknown> & { roles?: { key?: string; name?: string } | null }
  /** Clave del rol funcional, ya leída de `roles(key)`. */
  rol: string | null
  isSuperAdmin: boolean
}

interface TenantContextValue {
  slug: string
  id: string | null
  branding: TenantBranding
  sesion: SesionTenant | null
}

const TenantContext = createContext<TenantContextValue | null>(null)

export function TenantProvider({
  tenant,
  tenantId,
  branding,
  sesion,
  children,
}: {
  tenant: string
  tenantId?: string | null
  branding?: TenantBranding
  sesion?: SesionTenant | null
  children: React.ReactNode
}) {
  return (
    <TenantContext.Provider
      value={{
        slug: tenant,
        id: tenantId ?? null,
        branding: branding ?? resolveTenantBranding(null),
        sesion: sesion ?? null,
      }}
    >
      {children}
    </TenantContext.Provider>
  )
}

// Nombre de marca + acento de color de la subcuenta activa (Fase 10), resuelto en
// app/[tenant]/layout.tsx desde tenants.settings.branding. Úsalo en vez de hardcodear
// "Growth Ops" en cualquier pantalla dentro de app/[tenant]/**.
export function useTenantBranding(): TenantBranding {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenantBranding() called outside <TenantProvider> (app/[tenant]/layout.tsx)')
  return ctx.branding
}

// Slug de la subcuenta activa, resuelto del segmento [tenant] de la URL por
// app/[tenant]/layout.tsx. Úsalo para construir cualquier href/fetch interno:
// `/${tenant}/dashboard`, `/api/${tenant}/evergreen/...`.
export function useTenant(): string {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant() called outside <TenantProvider> (app/[tenant]/layout.tsx)')
  return ctx.slug
}

// UUID de `tenants.id` para la subcuenta activa (resuelto una vez en el layout).
// Úsalo para filtrar queries directas a Supabase desde cliente por `tenant_id`
// (RLS ya aísla los datos; esto es para que el switcher del super_admin muestre
// una subcuenta a la vez en vez de mezclar todo lo que RLS le permite ver).
export function useTenantId(): string {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenantId() called outside <TenantProvider> (app/[tenant]/layout.tsx)')
  if (!ctx.id)
    throw new Error('tenantId aún no resuelto (llamado antes de que app/[tenant]/layout.tsx termine de cargar)')
  return ctx.id
}

/**
 * La sesión ya resuelta por el layout, para no volver a pedirla.
 *
 * Devuelve `null` en las rutas públicas (login, recover, registro de afiliados), que se renderizan sin
 * sesión a propósito. En cualquier pantalla del panel está puesta: el layout no pinta los hijos hasta
 * haberla resuelto.
 *
 * Sustituye al par `await supabase.auth.getUser()` + `from('users').select(...)` que cada pantalla hacía
 * por su cuenta. Dos viajes de red menos, en serie, por pantalla.
 */
export function useSesion(): SesionTenant | null {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useSesion() called outside <TenantProvider> (app/[tenant]/layout.tsx)')
  return ctx.sesion
}
