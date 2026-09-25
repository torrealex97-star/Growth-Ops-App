'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ROLE_LABELS, ROLE_COLORS, DEPARTMENT_LABELS, type AppRole } from '@/lib/auth/permissions'
import { LogOut, ChevronRight, ChevronDown, X } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { getInitials } from '@/lib/utils'
import { performLogout } from '@/lib/auth/logout'
import { useState, useEffect, useMemo } from 'react'
import { Loader2, Handshake } from 'lucide-react'
import type { User } from '@/lib/types/database'
import { NAV_SECTIONS, makeNavFilter, navHrefForRole, type NavItem } from '@/lib/nav'
import { useTenant, useTenantBranding, useTenantId } from '@/lib/tenant-context'
import { createClient } from '@/lib/supabase/client'

interface SidebarProps {
  user: User & { roles: { key: string; name: string } }
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ user, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tenant = useTenant()
  const tenantId = useTenantId()
  const branding = useTenantBranding()
  const relPathname = pathname.replace(new RegExp(`^/${tenant}`), '') || '/'
  const role = user.roles.key as AppRole
  const u = user as unknown as { dept_overrides?: string[] | null; page_overrides?: string[] | null }
  const deptOverrides = u?.dept_overrides
  const pageOverrides = u?.page_overrides
  const isVisible = useMemo(
    () => makeNavFilter(role, deptOverrides, pageOverrides),
    [role, deptOverrides, pageOverrides]
  )
  // NAV_SECTIONS es estática y `isVisible` solo cambia si cambian rol/overrides — sin memo, cada
  // render del Sidebar (incluido cada toggle de una sola sección) recorría y filtraba TODO el
  // árbol de navegación de nuevo.
  const visibleSections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({ section, visibleItems: section.items.filter(isVisible) })).filter(
        ({ visibleItems }) => visibleItems.length > 0
      ),
    [isVisible]
  )

  // Un socio sin rol de dirección (p.ej. closer) no ve Finanzas por rol, pero si tiene su propia
  // fila en `partners` (vinculada por user_id, ver Configuración > Socios) debe poder llegar a ver
  // sus ganancias reales igualmente — sin que un admin tenga que sacrificar el resto de su menú
  // con "Páginas que puede ver" (ese mecanismo SUSTITUYE el menú entero, no lo amplía). Se añade
  // como item suelto en vez de tocar el filtro de roles: así ningún otro rol se ve afectado.
  const [esSocioVinculado, setEsSocioVinculado] = useState(false)
  useEffect(() => {
    let mounted = true
    createClient()
      .from('partners')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .then(({ data }) => {
        if (mounted) setEsSocioVinculado(!!data && data.length > 0)
      })
    return () => {
      mounted = false
    }
  }, [tenantId, user.id])

  const finalSections = useMemo(() => {
    const yaVisible = visibleSections.some(({ visibleItems }) =>
      visibleItems.some((i) => i.href === '/finanzas/socios')
    )
    if (!esSocioVinculado || yaVisible) return visibleSections
    const socioItem: NavItem = { label: 'Mis ganancias (socio)', href: '/finanzas/socios', icon: Handshake }
    return [...visibleSections, { section: { dept: null, items: [socioItem] }, visibleItems: [socioItem] }]
  }, [visibleSections, esSocioVinculado])

  const [loggingOut, setLoggingOut] = useState(false)

  // Secciones colapsables (estilo Notion). Se recuerda el estado en localStorage.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  useEffect(() => {
    try {
      const raw = localStorage.getItem('growth-ops-sidebar-collapsed')
      if (raw) setCollapsed(JSON.parse(raw))
    } catch {
      /* ignore */
    }
  }, [])
  const toggleSection = (dept: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [dept]: !prev[dept] }
      try {
        localStorage.setItem('growth-ops-sidebar-collapsed', JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    await performLogout(`/${tenant}/login`)
  }

  const isActive = (href: string) => {
    const hrefPath = href.split('?')[0]
    if (hrefPath === '/dashboard') return relPathname === '/dashboard'
    return relPathname.startsWith(hrefPath)
  }

  const isChildActive = (href: string, siblings: NavItem[]) => {
    const [hrefPath, hrefQuery] = href.split('?')
    if (relPathname !== hrefPath) return false
    if (!hrefQuery) {
      const querySiblingIsActive = siblings.some((sibling) => {
        const [siblingPath, siblingQuery] = sibling.href.split('?')
        if (siblingPath !== hrefPath || !siblingQuery) return false
        return Array.from(new URLSearchParams(siblingQuery)).every(([key, value]) => searchParams.get(key) === value)
      })
      return !querySiblingIsActive
    }
    return Array.from(new URLSearchParams(hrefQuery)).every(([key, value]) => searchParams.get(key) === value)
  }

  return (
    <>
      {/* Mobile overlay. z-40/z-[45] (no z-50): Dialog/Popover (components/ui) usan z-50 — si
          quedan por debajo, un modal abierto con el drawer también abierto siempre gana el
          empate visual de forma determinista, en vez de depender del orden de montado en el DOM. */}
      {isOpen && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={onClose} />}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-[45] h-full w-64 flex-col bg-[#0A0A0B] border-r border-[#26262A] transition-transform duration-300 lg:static lg:flex lg:translate-x-0',
          isOpen ? 'flex translate-x-0' : '-translate-x-full hidden lg:flex'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-6 py-6 border-b border-[#26262A]">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-9 w-9 items-center justify-center" aria-label={branding.name}>
              <span className="text-[34px] font-semibold leading-none tracking-[-0.18em] text-white">
                {branding.name.charAt(0)}
              </span>
            </div>
            <span className="font-sans font-semibold text-white text-lg tracking-tight">{branding.name}</span>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {finalSections.map(({ section, visibleItems }) => {
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
                    <ChevronDown
                      className={cn('w-3 h-3 transition-transform', isCollapsed ? '-rotate-90' : 'rotate-0')}
                    />
                  </button>
                )}
                {!isCollapsed &&
                  visibleItems.map((item) => {
                    const itemHref = navHrefForRole(item, role)
                    return (
                      <div key={item.href}>
                        <Link
                          href={`/${tenant}${itemHref}`}
                          onClick={() => onClose()}
                          className={cn(
                            'relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 group',
                            isActive(itemHref)
                              ? 'bg-[#1C1C1F] text-white border border-[#343438] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                              : 'text-[#A1A1AA] hover:text-white hover:bg-[#141416] border border-transparent'
                          )}
                        >
                          {/* Barra de acento del item activo */}
                          {isActive(itemHref) && (
                            <span className="absolute right-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-white" />
                          )}
                          <item.icon
                            className={cn(
                              'w-4 h-4 shrink-0 transition-colors',
                              isActive(itemHref) ? 'text-white' : 'text-[#6B6B70] group-hover:text-white'
                            )}
                          />
                          {item.label}
                          {item.children && <ChevronRight className="w-3 h-3 ml-auto text-muted-foreground" />}
                        </Link>

                        {/* Children (settings submenu) */}
                        {item.children && isActive(itemHref) && (
                          <div className="ml-4 mt-1 space-y-1 border-l border-border pl-3">
                            {item.children.filter(isVisible).map((child) => (
                              <Link
                                key={child.href}
                                href={`/${tenant}${child.href}`}
                                onClick={() => onClose()}
                                className={cn(
                                  'flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors',
                                  isChildActive(child.href, item.children ?? [])
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
                    )
                  })}
              </div>
            )
          })}
        </nav>

        <Separator className="bg-muted" />

        {/* User section */}
        <div className="p-4">
          <div className="flex items-center gap-3 px-2 py-3">
            <Avatar className="w-8 h-8">
              <AvatarFallback className="text-xs">{getInitials(user.full_name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{user.full_name}</p>
              <Badge className={cn('text-xs px-1.5 py-0 border mt-0.5', ROLE_COLORS[role])}>{ROLE_LABELS[role]}</Badge>
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
