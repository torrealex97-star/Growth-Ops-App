'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'

export default function AdquisicionIndexPage() {
  const tenant = useTenant()
  const router = useRouter()
  useEffect(() => {
    router.replace(`/${tenant}/marketing/adquisicion/campanas`)
  }, [tenant, router])
  return null
}
