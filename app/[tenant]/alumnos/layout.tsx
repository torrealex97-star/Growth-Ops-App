"use client"

import { usePathname } from 'next/navigation'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'
import { useTenant } from '@/lib/tenant-context'

const TABS: RouteTab[] = [
  { label: 'Journey', href: '/alumnos/journey', match: '/alumnos/journey' },
  { label: 'Soporte', href: '/alumnos/soporte', match: '/alumnos/soporte' },
  { label: 'Cancelaciones', href: '/alumnos/cancelaciones', match: '/alumnos/cancelaciones' },
  { label: 'Contratos', href: '/alumnos/contratos', match: '/alumnos/contratos' },
]

export default function AlumnosLayout({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const pathname = usePathname()
  const relPathname = pathname.replace(new RegExp(`^/${tenant}`), '') || '/'
  const tabs = TABS.map((tab) => ({ ...tab, href: `/${tenant}${tab.href}` }))

  return (
    <div className="space-y-6">
      <div className="max-w-full overflow-x-auto px-6 pt-6 pb-1">
        <RouteTabs tabs={tabs} relPathname={relPathname} />
      </div>
      {children}
    </div>
  )
}
