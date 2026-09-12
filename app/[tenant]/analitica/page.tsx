'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'

export default function AnaliticaIndexPage() {
  const tenant = useTenant()
  const router = useRouter()
  useEffect(() => {
    router.replace(`/${tenant}/analitica/embudo`)
  }, [tenant, router])
  return null
}
