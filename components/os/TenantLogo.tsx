'use client'

import { useEffect, useState } from 'react'
import type { TenantBranding } from '@/lib/tenant-branding'
import { cn } from '@/lib/utils'

export function TenantLogo({ branding, className }: { branding: TenantBranding; className?: string }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [branding.logoUrl])

  return (
    <div
      className={cn('relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden', className)}
      aria-label={`Logo de ${branding.name}`}
    >
      {branding.logoUrl && !failed ? (
        // Se usa <img> porque la URL pertenece al Storage configurable de cada instalación;
        // next/image exigiría hardcodear el host de todos los proyectos Supabase posibles.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={branding.logoUrl} alt="" className="h-full w-full object-contain" onError={() => setFailed(true)} />
      ) : (
        <span className="text-[34px] font-semibold leading-none tracking-[-0.18em] text-white" aria-hidden="true">
          {branding.name.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  )
}
