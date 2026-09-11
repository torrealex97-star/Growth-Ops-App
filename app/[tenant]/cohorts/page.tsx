'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'

// La sección "Dirección" se disolvió: Cohortes vive ahora en Finanzas › Analítica financiera.
export default function CohortsLegacyRedirectPage() {
  const tenant = useTenant()
  const router = useRouter()
  useEffect(() => {
    router.replace(`/${tenant}/finanzas/analitica/cohortes`)
  }, [tenant, router])
  return null
}
