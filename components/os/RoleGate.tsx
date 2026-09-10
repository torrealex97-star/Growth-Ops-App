"use client"

import { type AppRole } from '@/lib/auth/permissions'

interface RoleGateProps {
  allowedRoles: AppRole[]
  currentRole: AppRole
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function RoleGate({ allowedRoles, currentRole, children, fallback = null }: RoleGateProps) {
  if (!allowedRoles.includes(currentRole)) {
    return <>{fallback}</>
  }
  return <>{children}</>
}
