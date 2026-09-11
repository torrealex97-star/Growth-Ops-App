"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'

export default function AnaliticaFinancieraIndexPage() {
  const tenant = useTenant()
  const router = useRouter()
  useEffect(() => { router.replace(`/${tenant}/finanzas/analitica/resumen`) }, [tenant, router])
  return null
}
