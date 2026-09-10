"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ROLE_LABELS, ROLE_COLORS, DEPARTMENT_LABELS, type AppRole } from '@/lib/auth/permissions'
import {
  LogOut,
  ChevronRight,
  ChevronDown,
  X,
  ArrowLeft,
  Zap,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { getInitials } from '@/lib/utils'
import { performLogout } from '@/lib/auth/logout'
import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import type { User } from '@/lib/types/database'
import { NAV_SECTIONS, makeNavFilter } from '@/lib/nav'

interface SidebarProps {
  user: User & { roles: { key: string; name: string } }
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ user, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()
  const role = user.roles.key as AppRole
  const u = user as unknown as { dept_overrides?: string[] | null; page_overrides?: string[] | null }
  const isVisible = makeNavFilter(role, u?.dept_overrides, u?.page_overrides)
  const [loggingOut, setLoggingOut] = useState(false)

  // Secciones colapsables (estilo Notion). Se recuerda el estado en localStorage.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  useEffect(() => {
    try {
      const raw = localStorage.getItem('iaw_sidebar_collapsed')
      if (raw) setCollapsed(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [])
  const toggleSection = (dept: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [dept]: !prev[dept] }
      try { localStorage.setItem('iaw_sidebar_collapsed', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    await performLogout()
  }

  const isActive = (href: string) => {
    if (href === '/evergreen/dashboard') return pathname === '/evergreen/dashboard'
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 h-full w-64 flex-col bg-card border-r border-border transition-transform duration-300 lg:static lg:flex lg:translate-x-0',
          isOpen ? 'flex translate-x-0' : '-translate-x-full hidden lg:flex'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-[0_0_14px_-3px_rgba(30,158,255,0.7)]">
              <Zap className="w-4 h-4 text-foreground" fill="currentColor" />
            </div>
            <span className="font-display font-bold text-foreground text-lg tracking-tight">IA WINNERS</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-8 w-8"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Back to Hub link */}
        <div className="px-3 pt-3">
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Volver al Hub
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter(isVisible)
            if (visibleItems.length === 0) return null
            // El usuario puede minimizar cualquier sección, aunque contenga la ruta activa
            // (antes "ventas" no se podía recoger nunca porque casi siempre hay una página
            // activa dentro de ella: Leads, Agendas, Ventas... y eso forzaba a mantenerla
            // siempre abierta ignorando el clic de colapsar).
            const isCollapsed = !!section.dept && !!collapsed[section.dept]
            return (
              <div key={section.dept ?? 'top'} className="space-y-1">
                {section.dept && (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.dept as string)}
                    className="w-full flex items-center justify-between px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>{DEPARTMENT_LABELS[section.dept]}</span>
                    <ChevronDown className={cn('w-3 h-3 transition-transform', isCollapsed ? '-rotate-90' : 'rotate-0')} />
                  </button>
                )}
                {!isCollapsed && visibleItems.map((item) => (
                  <div key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => onClose()}
                      className={cn(
                        'relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 group',
                        isActive(item.href)
                          ? 'bg-brand-600/15 text-brand-300 border border-brand-500/30 shadow-[0_0_18px_-8px_rgba(30,158,255,0.7)]'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/80 hover:translate-x-0.5 border border-transparent'
                      )}
                    >
                      {/* Barra de acento del item activo */}
                      {isActive(item.href) && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-brand-400 shadow-[0_0_8px_rgba(30,158,255,0.9)]" />
                      )}
                      <item.icon className={cn(
                        'w-4 h-4 shrink-0 transition-colors',
                        isActive(item.href) ? 'text-brand-400' : 'text-muted-foreground group-hover:text-brand-300'
                      )} />
                      {item.label}
                      {item.children && (
                        <ChevronRight className="w-3 h-3 ml-auto text-muted-foreground" />
                      )}
                    </Link>

                    {/* Children (settings submenu) */}
                    {item.children && isActive(item.href) && (
                      <div className="ml-4 mt-1 space-y-1 border-l border-border pl-3">
                        {item.children.filter(isVisible).map((child) => (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={() => onClose()}
                            className={cn(
                              'flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors',
                              pathname === child.href
                                ? 'text-brand-400'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                            )}
                          >
                            <child.icon className="w-3 h-3" />
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </nav>

        <Separator className="bg-muted" />

        {/* User section */}
        <div className="p-4">
          <div className="flex items-center gap-3 px-2 py-3">
            <Avatar className="w-8 h-8">
              <AvatarFallback className="text-xs">
                {getInitials(user.full_name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{user.full_name}</p>
              <Badge
                className={cn('text-xs px-1.5 py-0 border mt-0.5', ROLE_COLORS[role])}
              >
                {ROLE_LABELS[role]}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-red-400 disabled:opacity-60"
              onClick={handleLogout}
              disabled={loggingOut}
              title="Cerrar sesión"
            >
              {loggingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </aside>
    </>
  )
}
