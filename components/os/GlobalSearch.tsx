"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, ArrowRight, User as UserIcon, Calendar } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { normalizeText } from '@/components/ui/search-box'
import { makeNavFilter, visibleNavItems, type NavItem } from '@/lib/nav'
import { formatDateTime } from '@/lib/utils'
import type { AppRole } from '@/lib/auth/permissions'
import type { User } from '@/lib/types/database'
import { useTenant } from '@/lib/tenant-context'

// Búsqueda global (la "lupa" de la cabecera): abre con clic o con Cmd/Ctrl+K y busca en un mismo
// sitio las PANTALLAS que el usuario tiene permitidas (ventas, objetivos, calendario…), los
// CONTACTOS (nombre, email, teléfono) y las AGENDAS próximas de esos contactos.
// Las pantallas se filtran con el mismo criterio de permisos que el menú lateral.

type ContactHit = { id: string; full_name: string; email: string | null; phone: string | null; lead_status: string | null }
type ApptHit = { id: string; appointment_datetime: string; contacts: { full_name: string | null } | null }

type Result =
  | { kind: 'page'; key: string; label: string; sub: string; href: string; icon: React.ElementType }
  | { kind: 'contact'; key: string; label: string; sub: string; href: string; icon: React.ElementType }
  | { kind: 'appointment'; key: string; label: string; sub: string; href: string; icon: React.ElementType }

const MIN_REMOTE_QUERY = 2

export function GlobalSearch({ user }: { user: User & { roles: { key: string; name: string } } }) {
  const tenant = useTenant()
  const router = useRouter()
  const role = user.roles.key as AppRole
  const u = user as unknown as { dept_overrides?: string[] | null; page_overrides?: string[] | null }

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [contacts, setContacts] = useState<ContactHit[]>([])
  const [appts, setAppts] = useState<ApptHit[]>([])
  const [searching, setSearching] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Pantallas permitidas para este usuario (mismo filtro que el menú lateral).
  const pages = useMemo<NavItem[]>(
    () => visibleNavItems(makeNavFilter(role, u?.dept_overrides, u?.page_overrides)),
    [role, u?.dept_overrides, u?.page_overrides]
  )

  // Atajo de teclado: Cmd+K / Ctrl+K en cualquier pantalla.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Al cerrar, limpia para que la próxima apertura empiece en blanco.
  useEffect(() => {
    if (!open) { setQuery(''); setContacts([]); setAppts([]); setActive(0) }
  }, [open])

  // Búsqueda en BBDD con debounce. La RLS ya acota lo que cada rol puede ver.
  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_REMOTE_QUERY) { setContacts([]); setAppts([]); setSearching(false); return }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      const sb = createClient()
      const digits = q.replace(/[^\d]/g, '')
      const or = [`full_name.ilike.%${q}%`, `email.ilike.%${q}%`]
      if (digits.length >= 3) or.push(`phone.ilike.%${digits}%`)
      const [cRes, aRes] = await Promise.all([
        sb.from('contacts').select('id, full_name, email, phone, lead_status').or(or.join(',')).limit(8),
        sb.from('appointments')
          .select('id, appointment_datetime, contacts!inner(full_name)')
          .ilike('contacts.full_name', `%${q}%`)
          .order('appointment_datetime', { ascending: false })
          .limit(5),
      ])
      if (cancelled) return
      setContacts((cRes.data as ContactHit[]) ?? [])
      setAppts((aRes.data as unknown as ApptHit[]) ?? [])
      setSearching(false)
    }, 220)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  const results = useMemo<Result[]>(() => {
    const q = normalizeText(query.trim())
    const pageHits: Result[] = pages
      .filter((p) => !q || normalizeText(p.label).includes(q) || normalizeText(p.href).includes(q))
      .slice(0, q ? 8 : 6)
      .map((p) => ({ kind: 'page', key: `page:${p.href}`, label: p.label, sub: p.href.replace(`/${tenant}/`, ''), href: p.href, icon: p.icon }))

    const contactHits: Result[] = contacts.map((c) => ({
      kind: 'contact',
      key: `contact:${c.id}`,
      label: c.full_name || 'Contacto sin nombre',
      sub: [c.email, c.phone].filter(Boolean).join(' · ') || 'Contacto',
      href: `/${tenant}/contacts/${c.id}`,
      icon: UserIcon,
    }))

    const apptHits: Result[] = appts.map((a) => ({
      kind: 'appointment',
      key: `appt:${a.id}`,
      label: a.contacts?.full_name || 'Agenda',
      sub: formatDateTime(a.appointment_datetime),
      href: `/${tenant}/appointments`,
      icon: Calendar,
    }))

    return [...pageHits, ...contactHits, ...apptHits]
  }, [pages, query, contacts, appts])

  // Mantén la selección dentro de rango cuando cambian los resultados.
  useEffect(() => { setActive((i) => (i >= results.length ? 0 : i)) }, [results.length])

  const go = useCallback((r: Result) => {
    setOpen(false)
    router.push(r.href)
  }, [router])

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { const r = results[active]; if (r) { e.preventDefault(); go(r) } }
  }

  const groupLabel = (kind: Result['kind']) =>
    kind === 'page' ? 'Pantallas' : kind === 'contact' ? 'Contactos' : 'Agendas'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Buscar (⌘K)"
        className="flex items-center gap-2 h-8 rounded-lg border border-border bg-card/60 px-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      >
        <Search className="w-4 h-4" />
        <span className="hidden md:inline text-xs">Buscar</span>
        <kbd className="hidden md:inline text-[10px] px-1 py-0.5 rounded border border-border bg-muted/60">⌘K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-border p-0 max-w-xl top-[15%] translate-y-0">
          <DialogTitle className="sr-only">Búsqueda global</DialogTitle>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Buscar pantallas, contactos, agendas…"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {searching && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />}
          </div>

          <div className="max-h-[60vh] overflow-y-auto py-2">
            {results.length === 0 ? (
              <p className="px-4 py-8 text-sm text-muted-foreground text-center">
                {query.trim().length < MIN_REMOTE_QUERY ? 'Escribe para buscar…' : 'Sin resultados'}
              </p>
            ) : (
              results.map((r, i) => {
                const prev = results[i - 1]
                const showGroup = !prev || prev.kind !== r.kind
                const Icon = r.icon
                return (
                  <div key={r.key}>
                    {showGroup && (
                      <p className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{groupLabel(r.kind)}</p>
                    )}
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                        i === active ? 'bg-brand-600/15 text-foreground' : 'text-muted-foreground hover:bg-muted/60'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${i === active ? 'text-brand-400' : ''}`} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-foreground truncate">{r.label}</span>
                        <span className="block text-xs text-muted-foreground truncate">{r.sub}</span>
                      </span>
                      {i === active && <ArrowRight className="w-3.5 h-3.5 text-brand-400 shrink-0" />}
                    </button>
                  </div>
                )
              })
            )}
          </div>

          <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>↑↓ moverse</span>
            <span>↵ abrir</span>
            <span>esc cerrar</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
