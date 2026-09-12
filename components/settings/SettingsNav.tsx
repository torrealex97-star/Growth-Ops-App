'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Database, Plug, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTenant } from '@/lib/tenant-context'
import { createClient } from '@/lib/supabase/client'

const ITEMS = [
  { id: 'general', label: 'General', href: '/settings', icon: Settings },
  { id: 'integraciones', label: 'Integraciones', href: '/settings/integraciones', icon: Plug },
  { id: 'data-health', label: 'Data Health', href: '/settings/data-health', icon: Database },
] as const

export function SettingsNav({ current }: { current: (typeof ITEMS)[number]['id'] }) {
  const tenant = useTenant()
  const [canManage, setCanManage] = useState(current !== 'data-health')
  useEffect(() => {
    if (current !== 'data-health') return
    const sb = createClient()
    void sb.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await sb.from('users').select('roles(key)').eq('id', user.id).single()
      const role = (data?.roles as { key?: string } | null)?.key
      setCanManage(role === 'admin' || role === 'director' || role === 'manager')
    })
  }, [current])
  const visibleItems = canManage ? ITEMS : ITEMS.filter((item) => item.id === 'data-health')
  return (
    <nav aria-label="Secciones de configuración" className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
      {visibleItems.map((item) => {
        const Icon = item.icon
        return (
          <Link
            key={item.id}
            href={`/${tenant}${item.href}`}
            aria-current={current === item.id ? 'page' : undefined}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              current === item.id ? 'bg-card text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
