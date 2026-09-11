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
    { label: 'I&G (P&L)', href: `/${tenant}/finanzas/analitica/pnl`, match: '/finanzas/analitica/pnl' },
    { label: 'Cohortes', href: `/${tenant}/finanzas/analitica/cohortes`, match: '/finanzas/analitica/cohortes' },
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="max-w-full overflow-x-auto pb-1">
        <RouteTabs tabs={TABS} relPathname={relPathname} />
      </div>
      {children}
    </div>
  )
}
