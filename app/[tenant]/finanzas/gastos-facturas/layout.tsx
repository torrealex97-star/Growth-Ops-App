'use client'

import { usePathname } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

export default function GastosFacturasLayout({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const pathname = usePathname()
  const relPathname = pathname.replace(`/${tenant}`, '') || '/'

  const TABS: RouteTab[] = [
    { label: 'Gastos', href: `/${tenant}/finanzas/gastos-facturas/gastos`, match: '/finanzas/gastos-facturas/gastos' },
    {
      label: 'Facturas',
      href: `/${tenant}/finanzas/gastos-facturas/facturas`,
      match: '/finanzas/gastos-facturas/facturas',
    },
    {
      label: 'Export gestoría',
      href: `/${tenant}/finanzas/gastos-facturas/gestoria`,
      match: '/finanzas/gastos-facturas/gestoria',
    },
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
