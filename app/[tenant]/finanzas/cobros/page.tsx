'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'

export default function CobrosConciliacionIndexPage() {
  const tenant = useTenant()
  const router = useRouter()
  useEffect(() => {
    router.replace(`/${tenant}/finanzas/cobros/cobros`)
  }, [tenant, router])
  return null
}
