"use client"

import { usePathname } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

const TABS: RouteTab[] = [
  { label: 'Contactos', href: '/crm/contactos', match: '/crm/contactos' },
  { label: 'Agendas', href: '/crm/agendas', match: '/crm/agendas' },
  { label: 'Seguimiento', href: '/crm/seguimiento', match: '/crm/seguimiento' },
]

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const pathname = usePathname()
  const relPathname = pathname.replace(new RegExp(`^/${tenant}`), '') || '/'
  const tabs = TABS.map((t) => ({ ...t, href: `/${tenant}${t.href}` }))

  return (
    <div className="p-6 space-y-6">
      <div className="max-w-full overflow-x-auto pb-1">
        <RouteTabs tabs={tabs} relPathname={relPathname} />
      </div>
      {children}
    </div>
  )
}
