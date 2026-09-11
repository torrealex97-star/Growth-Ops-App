"use client"

import { usePathname } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

const TABS: RouteTab[] = [
  { label: 'Registro', href: '/ventas/registro', match: '/ventas/registro' },
  { label: 'Pagos', href: '/ventas/pagos', match: '/ventas/pagos' },
  { label: 'Reservas', href: '/ventas/reservas', match: '/ventas/reservas' },
]

export default function VentasLayout({ children }: { children: React.ReactNode }) {
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
