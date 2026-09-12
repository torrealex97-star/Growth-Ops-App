'use client'

import { createContext, useContext } from 'react'
import { resolveTenantBranding, type TenantBranding } from '@/lib/tenant-branding'

interface TenantContextValue {
  slug: string
  id: string | null
  branding: TenantBranding
}

const TenantContext = createContext<TenantContextValue | null>(null)

export function TenantProvider({
  tenant,
  tenantId,
  branding,
  children,
}: {
  tenant: string
  tenantId?: string | null
  branding?: TenantBranding
  children: React.ReactNode
}) {
  return (
    <TenantContext.Provider
      value={{ slug: tenant, id: tenantId ?? null, branding: branding ?? resolveTenantBranding(null) }}
    >
      {children}
    </TenantContext.Provider>
  )
}

// Nombre de marca + acento de color de la subcuenta activa (Fase 10), resuelto en
// app/[tenant]/layout.tsx desde tenants.settings.branding. Úsalo en vez de hardcodear
// "Scalix Systems" en cualquier pantalla dentro de app/[tenant]/**.
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
