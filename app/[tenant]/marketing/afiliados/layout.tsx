'use client'

import { usePathname } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

export default function AfiliadosLayout({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const pathname = usePathname()
  const relPathname = pathname.replace(`/${tenant}`, '') || '/'

  const TABS: RouteTab[] = [
    {
      label: 'Colaboradores',
      href: `/${tenant}/marketing/afiliados/afiliados`,
      match: '/marketing/afiliados/afiliados',
    },
    { label: 'Campañas', href: `/${tenant}/marketing/afiliados/campanas`, match: '/marketing/afiliados/campanas' },
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
