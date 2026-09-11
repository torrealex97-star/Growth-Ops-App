"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'

export default function CrmIndexPage() {
  const tenant = useTenant()
  const router = useRouter()
  useEffect(() => { router.replace(`/${tenant}/crm/contactos`) }, [tenant, router])
  return null
}
