"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Menu, Bell, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ROLE_LABELS, ROLE_COLORS, isLeadership, type AppRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/client'
import { getInitials, cn, formatDateTime } from '@/lib/utils'
import { FeedbackDialog } from '@/components/os/FeedbackDialog'
import { ThemeToggle } from '@/components/os/ThemeToggle'
import { GlobalSearch } from '@/components/os/GlobalSearch'
import type { User } from '@/lib/types/database'

interface HeaderProps {
  user: User & { roles: { key: string; name: string } }
  onMenuClick: () => void
  title?: string
}

type MissingLinkAppt = { id: string; appointment_datetime: string; contacts: { full_name: string | null } | null }

export function Header({ user, onMenuClick, title }: HeaderProps) {
  const role = user.roles.key as AppRole
  const [missing, setMissing] = useState<MissingLinkAppt[]>([])

  // Alerta de obligación: agendas ASISTIDAS (show) SIN enlace de llamada (recording_url). El closer
  // debe añadirlo. Liderazgo ve todas; el resto solo las suyas (además la RLS por scope las acota).
  useEffect(() => {
    let active = true
    ;(async () => {
      const sb = createClient()
      let q = sb
        .from('appointments')
        .select('id, appointment_datetime, contacts(full_name)')
        .eq('status', 'show')
        .is('recording_url', null)
        .order('appointment_datetime', { ascending: false })
        .limit(30)
      if (!isLeadership(role)) q = q.eq('closer_id', user.id)
      const { data } = await q
      if (active) setMissing((data as unknown as MissingLinkAppt[]) ?? [])
    })()
    return () => { active = false }
  }, [role, user.id])

  const count = missing.length

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center border-b border-border bg-background/70 backdrop-blur-xl px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden mr-2 text-muted-foreground"
        onClick={onMenuClick}
      >
        <Menu className="w-5 h-5" />
      </Button>

      <div className="flex-1">
        {title && (
          <h1 className="text-sm font-medium text-muted-foreground">{title}</h1>
        )}
      </div>

      <div className="flex items-center gap-3">
        <GlobalSearch user={user} />
        <ThemeToggle />
        <FeedbackDialog />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
              <Bell className="w-4 h-4" />
              {count > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-foreground text-[10px] font-bold flex items-center justify-center">
                  {count > 9 ? '9+' : count}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 bg-card border-border p-0">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-sm font-semibold text-foreground">Notificaciones</p>
            </div>
            {count === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">Todo al día. Sin pendientes.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y divide-border">
                <div className="px-4 py-2 flex items-center gap-2 text-amber-400 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {count} reunión{count === 1 ? '' : 'es'} asistida{count === 1 ? '' : 's'} sin enlace de llamada
                </div>
                {missing.map((a) => (
                  <Link
                    key={a.id}
                    href="/evergreen/appointments"
                    className="block px-4 py-2.5 hover:bg-muted/60 transition-colors"
                  >
                    <p className="text-sm text-foreground truncate">{a.contacts?.full_name || 'Contacto'}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(a.appointment_datetime)} · Falta enlace de la llamada</p>
                  </Link>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>

        <Link
          href="/evergreen/perfil"
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          title="Mi perfil y contraseña"
        >
          <Avatar className="w-7 h-7">
            <AvatarFallback className="text-xs">
              {getInitials(user.full_name)}
            </AvatarFallback>
          </Avatar>
          <div className="hidden sm:block">
            <span className="text-sm text-foreground font-medium">{user.full_name}</span>
            <Badge className={cn('ml-2 text-xs px-1.5 py-0 border', ROLE_COLORS[role])}>
              {ROLE_LABELS[role]}
            </Badge>
          </div>
        </Link>
      </div>
    </header>
  )
}
