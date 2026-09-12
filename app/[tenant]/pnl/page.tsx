'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'

// La sección "Dirección" se disolvió: I&G (P&L) vive ahora en Finanzas › Analítica financiera.
export default function PnlLegacyRedirectPage() {
  const tenant = useTenant()
  const router = useRouter()
  useEffect(() => {
    router.replace(`/${tenant}/finanzas/analitica/pnl`)
  }, [tenant, router])
  return null
}
