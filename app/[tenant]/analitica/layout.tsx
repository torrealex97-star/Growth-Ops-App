'use client'

import { usePathname } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

const TABS: RouteTab[] = [
  { label: 'Embudo', href: '/analitica/embudo', match: '/analitica/embudo' },
  { label: 'Ranking', href: '/analitica/ranking', match: '/analitica/ranking' },
  { label: 'Actividad', href: '/analitica/actividad', match: '/analitica/actividad' },
]

export default function AnaliticaLayout({ children }: { children: React.ReactNode }) {
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
