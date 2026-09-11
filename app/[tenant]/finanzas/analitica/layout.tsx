'use client'

import { usePathname } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

export default function AnaliticaFinancieraLayout({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const pathname = usePathname()
  const relPathname = pathname.replace(`/${tenant}`, '') || '/'

  const TABS: RouteTab[] = [
    { label: 'Resumen', href: `/${tenant}/finanzas/analitica/resumen`, match: '/finanzas/analitica/resumen' },
    { label: 'Proyección de caja', href: `/${tenant}/finanzas/analitica/proyeccion`, match: '/finanzas/analitica/proyeccion' },
  ]

  return (
    <div className="p-6 space-y-6">
      <RouteTabs tabs={TABS} relPathname={relPathname} />
      {children}
    </div>
  )
}
