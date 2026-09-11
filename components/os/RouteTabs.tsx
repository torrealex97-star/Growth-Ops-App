"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface RouteTab {
  label: string
  href: string
  /** Ruta relativa (sin tenant) para saber cuándo esta pestaña está activa, p.ej. '/ventas/registro'. */
  match: string
  /**
   * Si es true, solo se marca activa con coincidencia EXACTA (no por prefijo). Necesario cuando
   * la ruta de esta pestaña es también el prefijo del grupo entero (p.ej. '/instagram' es a la vez
   * la pestaña "Rendimiento" y el prefijo de '/instagram/reels', '/instagram/carruseles'...).
   */
  exact?: boolean
}

// Fila de pestañas navegable por URL real (deep-linkable), con el mismo estilo visual que
// components/ui/tabs.tsx (Radix) pero usando <Link> en vez de estado de cliente, para que cada
// pestaña sea una ruta de verdad: se puede compartir, recargar, abrir en pestaña nueva y el
// buscador ⌘K puede llevar directo a ella.
export function RouteTabs({ tabs, relPathname }: { tabs: RouteTab[]; relPathname: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
      {tabs.map((t) => {
        const active = t.exact ? relPathname === t.match : relPathname === t.match || relPathname.startsWith(`${t.match}/`)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all',
              active ? 'bg-card text-foreground shadow' : 'hover:text-foreground'
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
