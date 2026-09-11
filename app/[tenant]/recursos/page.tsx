"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'

export default function RecursosIndexPage() {
  const tenant = useTenant()
  const router = useRouter()
  useEffect(() => { router.replace(`/${tenant}/recursos/enlaces`) }, [tenant, router])
  return null
}
