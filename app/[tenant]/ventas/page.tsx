"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'

export default function VentasIndexPage() {
  const tenant = useTenant()
  const router = useRouter()
  useEffect(() => { router.replace(`/${tenant}/ventas/registro`) }, [tenant, router])
  return null
}
