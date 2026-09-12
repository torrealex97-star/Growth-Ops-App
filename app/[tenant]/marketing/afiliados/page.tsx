'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'

export default function AfiliadosIndexPage() {
  const tenant = useTenant()
  const router = useRouter()
  useEffect(() => {
    router.replace(`/${tenant}/marketing/afiliados/afiliados`)
  }, [tenant, router])
  return null
}
