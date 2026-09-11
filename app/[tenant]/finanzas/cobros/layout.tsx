'use client'

import { usePathname } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

export default function CobrosConciliacionLayout({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const pathname = usePathname()
  const relPathname = pathname.replace(`/${tenant}`, '') || '/'

  const TABS: RouteTab[] = [
    { label: 'Cobros', href: `/${tenant}/finanzas/cobros/cobros`, match: '/finanzas/cobros/cobros' },
    { label: 'Devoluciones', href: `/${tenant}/finanzas/cobros/devoluciones`, match: '/finanzas/cobros/devoluciones' },
    { label: 'Conciliación', href: `/${tenant}/finanzas/cobros/conciliacion`, match: '/finanzas/cobros/conciliacion' },
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
