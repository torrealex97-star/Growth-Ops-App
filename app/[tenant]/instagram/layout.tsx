'use client'

import { usePathname } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

const TABS: RouteTab[] = [
  { label: 'Rendimiento', href: '/instagram', match: '/instagram', exact: true },
  { label: 'Reels del día', href: '/instagram/reels', match: '/instagram/reels' },
  { label: 'Carruseles y Flyers', href: '/instagram/carruseles', match: '/instagram/carruseles' },
  { label: 'Competencia', href: '/instagram/competencia', match: '/instagram/competencia' },
  { label: 'Investigación', href: '/instagram/investigacion', match: '/instagram/investigacion' },
]

export default function InstagramLayout({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const pathname = usePathname()
  const relPathname = pathname.replace(new RegExp(`^/${tenant}`), '') || '/'
  const tabs = TABS.map((t) => ({ ...t, href: `/${tenant}${t.href}` }))

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-400">Biblioteca de contenido</p>
        <h1 className="text-2xl font-display font-bold text-foreground">Contenido</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Investiga, planifica y mide vídeos cortos para Instagram y TikTok, y contenido largo para YouTube.
        </p>
      </header>
      <div className="max-w-full overflow-x-auto pb-1">
        <RouteTabs tabs={tabs} relPathname={relPathname} />
      </div>
      {children}
    </div>
  )
}
