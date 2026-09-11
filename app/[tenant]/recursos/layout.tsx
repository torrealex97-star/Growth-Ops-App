"use client"

import { usePathname } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

const TABS: RouteTab[] = [
  { label: 'Enlaces', href: '/recursos/enlaces', match: '/recursos/enlaces' },
  { label: 'Biblioteca', href: '/recursos/biblioteca', match: '/recursos/biblioteca' },
  { label: 'Testimonios', href: '/recursos/testimonios', match: '/recursos/testimonios' },
  { label: 'Contratos', href: '/recursos/contratos-producto', match: '/recursos/contratos-producto' },
]

export default function RecursosLayout({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const pathname = usePathname()
  const relPathname = pathname.replace(new RegExp(`^/${tenant}`), '') || '/'
  const tabs = TABS.map((t) => ({ ...t, href: `/${tenant}${t.href}` }))

  return (
    <div className="p-6 space-y-6">
      <RouteTabs tabs={tabs} relPathname={relPathname} />
      {children}
    </div>
  )
}
