"use client"

import { usePathname } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

const TABS: RouteTab[] = [
  { label: 'Rendimiento', href: '/instagram', match: '/instagram', exact: true },
  { label: 'Reels del día', href: '/instagram/reels', match: '/instagram/reels' },
  { label: 'Carruseles y Flyers', href: '/instagram/carruseles', match: '/instagram/carruseles' },
  { label: 'Competencia', href: '/instagram/competencia', match: '/instagram/competencia' },
  { label: 'Contenido', href: '/instagram/contenido', match: '/instagram/contenido' },
]

export default function InstagramLayout({ children }: { children: React.ReactNode }) {
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
