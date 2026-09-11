"use client"

import { createContext, useContext } from 'react'

const TenantContext = createContext<string | null>(null)

export function TenantProvider({ tenant, children }: { tenant: string; children: React.ReactNode }) {
  return <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>
}

// Slug de la subcuenta activa, resuelto del segmento [tenant] de la URL por
// app/[tenant]/layout.tsx. Úsalo para construir cualquier href/fetch interno:
// `/${tenant}/dashboard`, `/api/${tenant}/evergreen/...`.
export function useTenant(): string {
  const tenant = useContext(TenantContext)
  if (!tenant) throw new Error('useTenant() called outside <TenantProvider> (app/[tenant]/layout.tsx)')
  return tenant
}
