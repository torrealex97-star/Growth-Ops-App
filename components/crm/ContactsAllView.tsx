'use client'

// VISTA UNIFICADA DE CONTACTOS — reemplaza ContactsAllView y ContactsLeadsView.
// Fusiona la lista de contactos con los leads de VSL en una sola tabla con:
// - Filtros robustos estilo GHL (búsqueda global, filtros por campo, filtros avanzados)
// - Toggle de columnas visible/invisible (persistido en localStorage)
// - Nombre formateado (Primera Letra Mayúscula)
// - Datos de VSL, atribución, seguimiento, notas — todo junto
// - Sin duplicar el menú de navegación

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolverScopeColaborador, contactIdsDeScope } from '@/lib/collaborators/scope'
import {
  Columns3,
  UserPlus,
  Search,
  X,
  ChevronDown,
  PlayCircle,
  AtSign,
  Ban,
  UserCheck,
  StickyNote,
  MessageSquarePlus,
  ExternalLink,
  Filter,
  ListPlus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { SearchBox, normalizeText, phoneMatches } from '@/components/ui/search-box'
import { ContactForm, type ContactFormData } from '@/components/contacts/ContactForm'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { LEAD_STATUSES, leadStatusMeta, type LeadStatus } from '@/lib/lead-status'
import { useSesion, useTenant, useTenantId } from '@/lib/tenant-context'
import { formatDate } from '@/lib/utils'

// ── Tipos ────────────────────────────────────────────────────────────────────

type Channel = 'whatsapp' | 'llamada' | 'email' | 'otro' | ''
type SetSource = 'closer' | 'setter' | 'cold_caller' | 'affiliate' | null

type Attribution = {
  source: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  is_primary: boolean
  first_utm_source: string | null
  first_utm_medium: string | null
  first_utm_campaign: string | null
  first_utm_content: string | null
  first_utm_term: string | null
  last_utm_source: string | null
  last_utm_medium: string | null
  last_utm_campaign: string | null
  last_utm_content: string | null
  last_utm_term: string | null
}

type Note = { note: string; created_at: string }

type ContactRow = {
  id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  country: string | null
  company_name: string | null
  instagram: string | null
  notes: string | null
  lead_status: LeadStatus
  lead_channel: Channel
  vsl_watch_pct: number | null
  lead_score: number | null
  created_at: string
  first_seen_at: string | null
  last_seen_at: string | null
  set_source: SetSource
  first_contact_at: string | null
  contact_attempts: number | null
  custom_fields: Record<string, string | number | boolean | null> | null
  contact_attributions: Attribution[]
  contact_notes: Note[]
}

type CustomFieldDefLite = {
  id: string
  label: string
  field_type: 'text' | 'number' | 'date' | 'boolean'
}

type ApptLite = { contact_id: string | null; appointment_datetime: string | null; created_at: string; status: string }

// ── Constantes ───────────────────────────────────────────────────────────────

const STATUS = LEAD_STATUSES
const statusMeta = leadStatusMeta
const HOT_PCT = 75
const DAY_MS = 1000 * 60 * 60 * 24

const FOLLOWUP: { value: string; label: string; color: string; dot: string }[] = [
  {
    value: 'sin_contacto',
    label: 'Sin contactar',
    color: 'bg-red-500/20 text-red-300 border-red-500/40',
    dot: 'bg-red-500',
  },
  {
    value: 'hoy',
    label: 'Contactado hoy',
    color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    dot: 'bg-emerald-500',
  },
  { value: 'd1', label: 'Día 1', color: 'bg-lime-500/20 text-lime-300 border-lime-500/40', dot: 'bg-lime-500' },
  { value: 'd2', label: 'Día 2', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40', dot: 'bg-amber-500' },
  { value: 'd3', label: 'Día 3', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40', dot: 'bg-orange-500' },
  { value: 'd4plus', label: '+4 días', color: 'bg-red-500/20 text-red-300 border-red-500/40', dot: 'bg-red-500' },
]
const followupMeta = (b: string) => FOLLOWUP.find((x) => x.value === b) ?? FOLLOWUP[0]

type ColumnKey =
  | 'nombre'
  | 'telefono'
  | 'email'
  | 'instagram'
  | 'empresa'
  | 'pais'
  | 'fuente'
  | 'utm_source'
  | 'utm_medium'
  | 'utm_campaign'
  | 'utm_content'
  | 'utm_term'
  | 'first_source'
  | 'first_campaign'
  | 'last_source'
  | 'last_campaign'
  | 'vsl'
  | 'estado'
  | 'canal'
  | 'fuente_lead'
  | 'seguimiento'
  | 'notas'
  | 'creado'

const COLUMNS: { key: ColumnKey; label: string; group: string }[] = [
  { key: 'nombre', label: 'Nombre', group: 'Datos' },
  { key: 'telefono', label: 'Teléfono', group: 'Datos' },
  { key: 'email', label: 'Email', group: 'Datos' },
  { key: 'instagram', label: 'Instagram', group: 'Datos' },
  { key: 'empresa', label: 'Empresa', group: 'Datos' },
  { key: 'pais', label: 'País', group: 'Datos' },
  { key: 'estado', label: 'Estado', group: 'CRM' },
  { key: 'canal', label: 'Canal', group: 'CRM' },
  { key: 'fuente_lead', label: 'Fuente lead', group: 'CRM' },
  { key: 'seguimiento', label: 'Seguimiento', group: 'CRM' },
  { key: 'vsl', label: '% VSL', group: 'VSL' },
  { key: 'fuente', label: 'Fuente', group: 'Atribución' },
  { key: 'utm_source', label: 'UTM Source', group: 'Atribución' },
  { key: 'utm_medium', label: 'UTM Medium', group: 'Atribución' },
  { key: 'utm_campaign', label: 'UTM Campaign', group: 'Atribución' },
  { key: 'utm_content', label: 'UTM Content', group: 'Atribución' },
  { key: 'utm_term', label: 'UTM Term', group: 'Atribución' },
  { key: 'first_source', label: 'First Source', group: 'Atribución' },
  { key: 'first_campaign', label: 'First Campaign', group: 'Atribución' },
  { key: 'last_source', label: 'Last Source', group: 'Atribución' },
  { key: 'last_campaign', label: 'Last Campaign', group: 'Atribución' },
  { key: 'notas', label: 'Notas', group: 'Detalle' },
  { key: 'creado', label: 'Creado', group: 'Detalle' },
]

const DEFAULT_COLS: ColumnKey[] = ['nombre', 'telefono', 'email', 'estado', 'canal', 'seguimiento', 'creado']
// Las columnas visibles son una preferencia POR SUBCUENTA: cada empresa tiene su propio flujo de
// trabajo. Sin el prefijo, la configuración de una se aplicaba a todas al cambiar de cuenta.
const colsKeyFor = (tenant: string) => `tenant:${tenant}:contacts_unified_cols`

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Capitaliza la primera letra de cada palabra: "maria garcia" → "Maria Garcia" */
function capitalizeName(name: string | null): string {
  if (!name) return '—'
  return name
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

function lastActivityAt(l: ContactRow, appts: ApptLite[]): number | null {
  const times: number[] = []
  for (const n of l.contact_notes || []) {
    const t = new Date(n.created_at).getTime()
    if (!isNaN(t)) times.push(t)
  }
  for (const a of appts) {
    if (a.contact_id !== l.id) continue
    const t1 = a.appointment_datetime ? new Date(a.appointment_datetime).getTime() : NaN
    const t2 = a.created_at ? new Date(a.created_at).getTime() : NaN
    if (!isNaN(t1)) times.push(t1)
    if (!isNaN(t2)) times.push(t2)
  }
  if (l.first_contact_at) {
    const t = new Date(l.first_contact_at).getTime()
    if (!isNaN(t)) times.push(t)
  }
  return times.length ? Math.max(...times) : null
}

type FollowupBucket = 'sin_contacto' | 'hoy' | 'd1' | 'd2' | 'd3' | 'd4plus'

function followupBucket(
  l: ContactRow,
  appts: ApptLite[],
  now: number
): { bucket: FollowupBucket; days: number | null } {
  const last = lastActivityAt(l, appts)
  if (last == null) return { bucket: 'sin_contacto', days: null }
  const days = Math.floor((now - last) / DAY_MS)
  if (days <= 0) return { bucket: 'hoy', days: 0 }
  if (days === 1) return { bucket: 'd1', days }
  if (days === 2) return { bucket: 'd2', days }
  if (days === 3) return { bucket: 'd3', days }
  return { bucket: 'd4plus', days }
}

function relativeDays(days: number | null): string {
  if (days == null) return 'Sin contacto'
  if (days <= 0) return 'Hoy'
  if (days === 1) return 'Hace 1 día'
  return `Hace ${days} días`
}

const primaryAttribution = (l: ContactRow) =>
  l.contact_attributions?.find((x) => x.is_primary) ?? l.contact_attributions?.[0]
const sourceOf = (l: ContactRow) => primaryAttribution(l)?.source || primaryAttribution(l)?.utm_source || '—'
const utmOf = (l: ContactRow, field: keyof Attribution) => (primaryAttribution(l)?.[field] as string | null) || '—'
const latestNote = (l: ContactRow): Note | null => {
  if (!l.contact_notes || l.contact_notes.length === 0) return null
  return [...l.contact_notes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
}

// ── Componente principal ─────────────────────────────────────────────────────

export function ContactsAllView() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const sesion = useSesion()
  const [leads, setLeads] = useState<ContactRow[]>([])
  const [appts, setAppts] = useState<ApptLite[]>([])
  const [loading, setLoading] = useState(true)

  // Filtros
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all')
  const [followupFilter, setFollowupFilter] = useState<string>('all')
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [hotOnly, setHotOnly] = useState(false)
  const [sortByVsl, setSortByVsl] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // Campos personalizados (§1): catálogo + filtro por valor no vacío de un campo.
  const [customDefs, setCustomDefs] = useState<CustomFieldDefLite[]>([])
  const [customFilterId, setCustomFilterId] = useState<string>('all')

  // Columnas
  const [visibleCols, setVisibleCols] = useState<ColumnKey[]>(DEFAULT_COLS)
  const [colsMenuOpen, setColsMenuOpen] = useState(false)

  // Notas
  const [noteOpenFor, setNoteOpenFor] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  // Nuevo contacto
  const [newOpen, setNewOpen] = useState(false)

  // Gestión del catálogo de campos personalizados (solo admin/director crea/elimina).
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldType, setNewFieldType] = useState<CustomFieldDefLite['field_type']>('text')
  const [savingField, setSavingField] = useState(false)

  const canManageFields = sesion?.rol === 'admin' || sesion?.rol === 'director'

  const createField = async () => {
    const label = newFieldLabel.trim()
    if (!label) return
    setSavingField(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/contacts/custom-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, field_type: newFieldType }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || 'No se pudo crear el campo')
      toast.success('Campo creado')
      setNewFieldLabel('')
      setNewFieldType('text')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear el campo')
    } finally {
      setSavingField(false)
    }
  }

  const deleteField = async (id: string) => {
    try {
      const res = await fetch(`/api/${tenant}/evergreen/contacts/custom-fields?id=${id}`, {
        method: 'DELETE',
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || 'No se pudo eliminar el campo')
      toast.success('Campo eliminado (y sus valores en los contactos)')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar el campo')
    }
  }

  // Cargar columnas de localStorage — por subcuenta, se re-carga al cambiar de tenant
  useEffect(() => {
    try {
      const raw = localStorage.getItem(colsKeyFor(tenant))
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) setVisibleCols(parsed)
      }
    } catch {
      /* ignore */
    }
  }, [tenant])

  const toggleCol = (key: ColumnKey) => {
    setVisibleCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      try {
        localStorage.setItem(colsKeyFor(tenant), JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  // ── Carga de datos ───────────────────────────────────────────────────────

  const load = async () => {
    const supabase = createClient()

    // SCOPE DE COLABORADOR (capa de datos, no de UI): si el usuario tiene perfil
    // de colaborador activo, sus queries nacen acotadas a SUS contactos y no hay
    // selector "todos" que quitar. Para el resto de roles es un no-op.
    const scope = sesion ? await resolverScopeColaborador(supabase, sesion.userId, tenantId) : { tipo: 'none' as const }
    const contactIds = await contactIdsDeScope(supabase, tenantId, scope)

    // Queries con scope aplicado: para colaboradores, el filtro por SUS contactos
    // va dentro de la propia query (más el backstop RLS); para el resto, sin cambio.
    const contactsQuery = contactIds
      ? supabase
          .from('contacts')
          .select(
            `
          id, full_name, first_name, last_name, email, phone, country, company_name, instagram, notes,
          lead_status, lead_channel, vsl_watch_pct, lead_score, created_at, first_seen_at, last_seen_at,
          set_source, first_contact_at, contact_attempts, custom_fields,
          contact_attributions(source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, is_primary,
            first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content, first_utm_term,
            last_utm_source, last_utm_medium, last_utm_campaign, last_utm_content, last_utm_term),
          contact_notes(note, created_at)
        `
          )
          .is('merged_into', null)
          .in('id', contactIds)
          .order('created_at', { ascending: false })
      : supabase
          .from('contacts')
          .select(
            `
          id, full_name, first_name, last_name, email, phone, country, company_name, instagram, notes,
          lead_status, lead_channel, vsl_watch_pct, lead_score, created_at, first_seen_at, last_seen_at,
          set_source, first_contact_at, contact_attempts, custom_fields,
          contact_attributions(source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, is_primary,
            first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content, first_utm_term,
            last_utm_source, last_utm_medium, last_utm_campaign, last_utm_content, last_utm_term),
          contact_notes(note, created_at)
        `
          )
          .is('merged_into', null)
          .order('created_at', { ascending: false })

    const apptsQuery = contactIds
      ? supabase
          .from('appointments')
          .select('contact_id, appointment_datetime, created_at, status')
          .in('contact_id', contactIds)
      : supabase.from('appointments').select('contact_id, appointment_datetime, created_at, status')

    const [contactsRes, apptRes, defsRes] = await Promise.all([
      contactsQuery,
      apptsQuery,
      supabase
        .from('custom_field_defs')
        .select('id, label, field_type')
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true }),
    ])
    if (!defsRes.error) setCustomDefs((defsRes.data as CustomFieldDefLite[]) ?? [])

    if (contactsRes.error) toast.error('Error al cargar contactos', { description: contactsRes.error.message })
    if (apptRes.error) toast.error('Error al cargar agendas', { description: apptRes.error.message })
    const sorted = ((contactsRes.data as ContactRow[]) || [])
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setLeads(sorted)
    setAppts((apptRes.data as ApptLite[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // ── Derivados ────────────────────────────────────────────────────────────

  const apptsByContact = useMemo(() => {
    const m = new Map<string, ApptLite[]>()
    for (const a of appts) {
      if (!a.contact_id) continue
      const arr = m.get(a.contact_id) ?? []
      arr.push(a)
      m.set(a.contact_id, arr)
    }
    return m
  }, [appts])

  const followupByLead = useMemo(() => {
    const now = Date.now()
    const m = new Map<string, { bucket: FollowupBucket; days: number | null }>()
    for (const l of leads) m.set(l.id, followupBucket(l, apptsByContact.get(l.id) ?? [], now))
    return m
  }, [leads, apptsByContact])

  const filtered = useMemo(() => {
    let base = statusFilter === 'all' ? leads : leads.filter((l) => l.lead_status === statusFilter)
    if (followupFilter !== 'all') base = base.filter((l) => followupByLead.get(l.id)?.bucket === followupFilter)
    if (channelFilter !== 'all') base = base.filter((l) => l.lead_channel === channelFilter)
    if (hotOnly) base = base.filter((l) => Number(l.vsl_watch_pct ?? 0) >= HOT_PCT)
    if (customFilterId !== 'all') {
      base = base.filter((l) => {
        const v = l.custom_fields?.[customFilterId]
        return v !== null && v !== undefined && v !== '' && v !== false
      })
    }
    const nq = normalizeText(q.trim())
    const searched = nq
      ? base.filter(
          (l) =>
            normalizeText(l.full_name || '').includes(nq) ||
            normalizeText(l.email || '').includes(nq) ||
            normalizeText(l.instagram || '').includes(nq) ||
            normalizeText(l.company_name || '').includes(nq) ||
            normalizeText(l.country || '').includes(nq) ||
            phoneMatches(l.phone, q)
        )
      : base
    return [...searched].sort((a, b) => {
      if (sortByVsl) {
        const d = Number(b.vsl_watch_pct ?? 0) - Number(a.vsl_watch_pct ?? 0)
        if (d !== 0) return d
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [leads, statusFilter, followupFilter, channelFilter, followupByLead, q, hotOnly, sortByVsl, customFilterId])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    leads.forEach((l) => {
      c[l.lead_status] = (c[l.lead_status] || 0) + 1
    })
    return c
  }, [leads])

  const followupCounts = useMemo(() => {
    const c: Record<string, number> = {}
    leads.forEach((l) => {
      const b = followupByLead.get(l.id)?.bucket
      if (b) c[b] = (c[b] || 0) + 1
    })
    return c
  }, [leads, followupByLead])

  // ── Acciones ─────────────────────────────────────────────────────────────

  const update = async (id: string, patch: Partial<Pick<ContactRow, 'lead_status' | 'lead_channel'>>) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
    const res = await fetch(`/api/${tenant}/evergreen/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) toast.error('No se pudo actualizar')
  }

  const createContact = async (formData: ContactFormData) => {
    const res = await fetch(`/api/${tenant}/evergreen/contacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error('Error al crear', { description: json.error })
      return
    }
    toast.success('Contacto creado')
    setNewOpen(false)
    await load()
  }

  const submitNote = async (id: string) => {
    const note = noteDraft.trim()
    if (!note) return
    setSavingNote(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('contact_notes')
      .insert({ contact_id: id, author_id: sesion?.userId ?? null, note })
    setSavingNote(false)
    if (error) {
      toast.error('No se pudo guardar la nota')
      return
    }
    toast.success('Nota añadida')
    setNoteDraft('')
    setNoteOpenFor(null)
    await load()
  }

  const isNoCall = (l: ContactRow) =>
    l.set_source === 'setter' || l.lead_status === 'agendado' || l.lead_status === 'cliente'

  const isVisible = (key: ColumnKey) => visibleCols.includes(key)
  const colCount = visibleCols.length + 1 // + acciones

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Barra superior: búsqueda + acciones */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar nombre, email, teléfono, Instagram, empresa…"
            className="w-full pl-9 pr-8 py-2 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          {q && (
            <button
              onClick={() => setQ('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length} de {leads.length}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          {canManageFields && (
            <button
              onClick={() => setFieldsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-card text-foreground border-border hover:border-brand-500/50"
            >
              <ListPlus className="w-3.5 h-3.5" /> Campos
            </button>
          )}
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white hover:bg-brand-500"
          >
            <UserPlus className="w-3.5 h-3.5" /> Nuevo contacto
          </button>
          <div className="relative">
            <button
              onClick={() => setColsMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-card text-foreground border-border hover:border-brand-500/50"
            >
              <Columns3 className="w-3.5 h-3.5" /> Columnas
            </button>
            {colsMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setColsMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-60 rounded-lg border border-border bg-card shadow-xl z-20 p-2 max-h-96 overflow-y-auto">
                  {['Datos', 'CRM', 'VSL', 'Atribución', 'Detalle'].map((group) => (
                    <div key={group}>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pt-2 pb-1">
                        {group}
                      </p>
                      {COLUMNS.filter((c) => c.group === group).map((c) => (
                        <label
                          key={c.key}
                          className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted cursor-pointer text-xs text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={isVisible(c.key)}
                            onChange={() => toggleCol(c.key)}
                            className="accent-brand-500"
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Filtros principales — fila horizontal */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${statusFilter === 'all' ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-muted-foreground border-border hover:border-brand-500/50'}`}
        >
          Todos ({leads.length})
        </button>
        {STATUS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${statusFilter === s.value ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-muted-foreground border-border hover:border-brand-500/50'}`}
          >
            {s.label} ({counts[s.value] || 0})
          </button>
        ))}
      </div>

      {/* Filtros secundarios: seguimiento + canal + VSL */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setHotOnly((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${hotOnly ? 'bg-orange-500/20 text-orange-300 border-orange-500/50' : 'bg-card text-muted-foreground border-border hover:border-brand-500/50'}`}
        >
          🔥 Calientes VSL ≥ {HOT_PCT}%
        </button>
        <button
          onClick={() => setSortByVsl((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${sortByVsl ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-muted-foreground border-border hover:border-brand-500/50'}`}
        >
          <PlayCircle className="w-3.5 h-3.5" /> Ordenar por % VSL
        </button>

        {/* Filtro avanzado: Seguimiento */}
        <div className="relative group">
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-card text-muted-foreground border-border hover:border-brand-500/50">
            <Filter className="w-3 h-3" /> Seguimiento <ChevronDown className="w-3 h-3" />
          </button>
          <div className="hidden group-hover:block absolute left-0 mt-1 w-48 rounded-lg border border-border bg-card shadow-xl z-20 p-1">
            <button
              onClick={() => setFollowupFilter('all')}
              className={`w-full text-left px-2 py-1.5 rounded-md text-xs ${followupFilter === 'all' ? 'bg-brand-600/20 text-brand-300' : 'text-foreground hover:bg-muted'}`}
            >
              Todos ({leads.length})
            </button>
            {FOLLOWUP.map((f) => (
              <button
                key={f.value}
                onClick={() => setFollowupFilter(followupFilter === f.value ? 'all' : f.value)}
                className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-2 ${followupFilter === f.value ? 'bg-brand-600/20 text-brand-300' : 'text-foreground hover:bg-muted'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />
                {f.label} ({followupCounts[f.value] || 0})
              </button>
            ))}
          </div>
        </div>

        {/* Filtro avanzado: Canal */}
        <div className="relative group">
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-card text-muted-foreground border-border hover:border-brand-500/50">
            <Filter className="w-3 h-3" /> Canal <ChevronDown className="w-3 h-3" />
          </button>
          <div className="hidden group-hover:block absolute left-0 mt-1 w-40 rounded-lg border border-border bg-card shadow-xl z-20 p-1">
            <button
              onClick={() => setChannelFilter('all')}
              className={`w-full text-left px-2 py-1.5 rounded-md text-xs ${channelFilter === 'all' ? 'bg-brand-600/20 text-brand-300' : 'text-foreground hover:bg-muted'}`}
            >
              Todos
            </button>
            {[
              { v: 'whatsapp', l: 'WhatsApp' },
              { v: 'llamada', l: 'Llamada' },
              { v: 'email', l: 'Email' },
              { v: 'otro', l: 'Otro' },
            ].map((c) => (
              <button
                key={c.v}
                onClick={() => setChannelFilter(channelFilter === c.v ? 'all' : c.v)}
                className={`w-full text-left px-2 py-1.5 rounded-md text-xs ${channelFilter === c.v ? 'bg-brand-600/20 text-brand-300' : 'text-foreground hover:bg-muted'}`}
              >
                {c.l}
              </button>
            ))}
          </div>
        </div>

        {/* Filtro avanzado: campos personalizados — contactos que TIENEN valor en el campo. */}
        {customDefs.length > 0 && (
          <div className="relative group">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-card text-muted-foreground border-border hover:border-brand-500/50">
              <Filter className="w-3 h-3" /> {customDefs.find((d) => d.id === customFilterId)?.label ?? 'Campos'}{' '}
              <ChevronDown className="w-3 h-3" />
            </button>
            <div className="hidden group-hover:block absolute left-0 mt-1 w-48 rounded-lg border border-border bg-card shadow-xl z-20 p-1">
              <button
                onClick={() => setCustomFilterId('all')}
                className={`w-full text-left px-2 py-1.5 rounded-md text-xs ${customFilterId === 'all' ? 'bg-brand-600/20 text-brand-300' : 'text-foreground hover:bg-muted'}`}
              >
                Todos
              </button>
              {customDefs.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setCustomFilterId(customFilterId === d.id ? 'all' : d.id)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-xs truncate ${customFilterId === d.id ? 'bg-brand-600/20 text-brand-300' : 'text-foreground hover:bg-muted'}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tabla */}
      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
              {isVisible('nombre') && <th className="text-left font-medium p-3">Nombre</th>}
              {isVisible('telefono') && <th className="text-left font-medium p-3">Teléfono</th>}
              {isVisible('email') && <th className="text-left font-medium p-3">Email</th>}
              {isVisible('instagram') && <th className="text-left font-medium p-3">Instagram</th>}
              {isVisible('empresa') && <th className="text-left font-medium p-3">Empresa</th>}
              {isVisible('pais') && <th className="text-left font-medium p-3">País</th>}
              {isVisible('estado') && <th className="text-left font-medium p-3">Estado</th>}
              {isVisible('canal') && <th className="text-left font-medium p-3">Canal</th>}
              {isVisible('fuente_lead') && <th className="text-left font-medium p-3">Fuente</th>}
              {isVisible('seguimiento') && <th className="text-left font-medium p-3">Seguimiento</th>}
              {isVisible('vsl') && <th className="text-center font-medium p-3">% VSL</th>}
              {isVisible('fuente') && <th className="text-left font-medium p-3">Fuente UTM</th>}
              {isVisible('utm_source') && <th className="text-left font-medium p-3">UTM Source</th>}
              {isVisible('utm_medium') && <th className="text-left font-medium p-3">UTM Medium</th>}
              {isVisible('utm_campaign') && <th className="text-left font-medium p-3">UTM Campaign</th>}
              {isVisible('utm_content') && <th className="text-left font-medium p-3">UTM Content</th>}
              {isVisible('utm_term') && <th className="text-left font-medium p-3">UTM Term</th>}
              {isVisible('first_source') && <th className="text-left font-medium p-3">First Source</th>}
              {isVisible('first_campaign') && <th className="text-left font-medium p-3">First Campaign</th>}
              {isVisible('last_source') && <th className="text-left font-medium p-3">Last Source</th>}
              {isVisible('last_campaign') && <th className="text-left font-medium p-3">Last Campaign</th>}
              {isVisible('notas') && <th className="text-left font-medium p-3">Notas</th>}
              {isVisible('creado') && <th className="text-left font-medium p-3">Creado</th>}
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colCount} className="p-8 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-8 text-center text-muted-foreground">
                  Sin contactos.
                </td>
              </tr>
            ) : (
              filtered.map((l) => {
                const lNote = latestNote(l)
                const fu = followupByLead.get(l.id) ?? { bucket: 'sin_contacto' as FollowupBucket, days: null }
                const fuMeta = followupMeta(fu.bucket)
                return (
                  <Fragment key={l.id}>
                    <tr className="border-b border-border/50 last:border-0 hover:bg-card/50 align-top">
                      {isVisible('nombre') && (
                        <td className="p-3">
                          <Link
                            href={`/${tenant}/crm/contactos/${l.id}`}
                            className="font-medium text-foreground hover:text-brand-400 hover:underline"
                          >
                            {capitalizeName(l.full_name)}
                          </Link>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {l.set_source === 'setter' && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-brand-500/20 text-brand-300 border border-brand-500/40">
                                <UserCheck className="w-2.5 h-2.5" /> Setter
                              </span>
                            )}
                            {isNoCall(l) && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/40">
                                <Ban className="w-2.5 h-2.5" /> No llamar
                              </span>
                            )}
                            {Number(l.vsl_watch_pct ?? 0) >= HOT_PCT && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/20 text-orange-300 border border-orange-500/40">
                                🔥 {Number(l.vsl_watch_pct)}%
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      {isVisible('telefono') && <td className="p-3 text-muted-foreground text-xs">{l.phone || '—'}</td>}
                      {isVisible('email') && (
                        <td className="p-3 text-muted-foreground text-xs max-w-[200px] truncate">{l.email || '—'}</td>
                      )}
                      {isVisible('instagram') && (
                        <td className="p-3">
                          {l.instagram ? (
                            <a
                              href={
                                l.instagram.startsWith('http')
                                  ? l.instagram
                                  : `https://instagram.com/${l.instagram.replace('@', '')}`
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-0.5 text-pink-400 text-xs"
                            >
                              <AtSign className="w-3 h-3" />
                              {l.instagram}
                            </a>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                      )}
                      {isVisible('empresa') && (
                        <td className="p-3 text-muted-foreground text-xs">{l.company_name || '—'}</td>
                      )}
                      {isVisible('pais') && <td className="p-3 text-muted-foreground text-xs">{l.country || '—'}</td>}
                      {isVisible('estado') && (
                        <td className="p-3">
                          <select
                            value={l.lead_status}
                            onChange={(e) => update(l.id, { lead_status: e.target.value as LeadStatus })}
                            className="text-[11px] bg-muted border border-border rounded px-2 py-1 text-foreground cursor-pointer"
                          >
                            {STATUS.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      {isVisible('canal') && (
                        <td className="p-3">
                          <select
                            value={l.lead_channel ?? ''}
                            onChange={(e) => update(l.id, { lead_channel: e.target.value as Channel })}
                            className="text-[11px] bg-muted border border-border rounded px-2 py-1 text-foreground cursor-pointer"
                          >
                            <option value="">—</option>
                            <option value="whatsapp">WhatsApp</option>
                            <option value="llamada">Llamada</option>
                            <option value="email">Email</option>
                            <option value="otro">Otro</option>
                          </select>
                        </td>
                      )}
                      {isVisible('fuente_lead') && (
                        <td className="p-3 text-muted-foreground text-xs">{l.set_source || '—'}</td>
                      )}
                      {isVisible('seguimiento') && (
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${fuMeta.color}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${fuMeta.dot}`} />
                            {relativeDays(fu.days)}
                          </span>
                          {(l.contact_attempts ?? 0) > 0 && (
                            <span className="block text-[10px] text-muted-foreground mt-0.5">
                              {l.contact_attempts} intento{(l.contact_attempts ?? 0) > 1 ? 's' : ''}
                            </span>
                          )}
                        </td>
                      )}
                      {isVisible('vsl') && (
                        <td className="p-3 text-center">
                          {l.vsl_watch_pct != null ? (
                            <span
                              className={`text-xs font-medium ${Number(l.vsl_watch_pct) >= HOT_PCT ? 'text-orange-400' : 'text-muted-foreground'}`}
                            >
                              {Number(l.vsl_watch_pct)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                      )}
                      {isVisible('fuente') && <td className="p-3 text-muted-foreground text-xs">{sourceOf(l)}</td>}
                      {isVisible('utm_source') && (
                        <td className="p-3 text-muted-foreground text-xs">{utmOf(l, 'utm_source')}</td>
                      )}
                      {isVisible('utm_medium') && (
                        <td className="p-3 text-muted-foreground text-xs">{utmOf(l, 'utm_medium')}</td>
                      )}
                      {isVisible('utm_campaign') && (
                        <td className="p-3 text-muted-foreground text-xs">{utmOf(l, 'utm_campaign')}</td>
                      )}
                      {isVisible('utm_content') && (
                        <td className="p-3 text-muted-foreground text-xs">{utmOf(l, 'utm_content')}</td>
                      )}
                      {isVisible('utm_term') && (
                        <td className="p-3 text-muted-foreground text-xs">{utmOf(l, 'utm_term')}</td>
                      )}
                      {isVisible('first_source') && (
                        <td className="p-3 text-muted-foreground text-xs">{utmOf(l, 'first_utm_source')}</td>
                      )}
                      {isVisible('first_campaign') && (
                        <td className="p-3 text-muted-foreground text-xs">{utmOf(l, 'first_utm_campaign')}</td>
                      )}
                      {isVisible('last_source') && (
                        <td className="p-3 text-muted-foreground text-xs">{utmOf(l, 'last_utm_source')}</td>
                      )}
                      {isVisible('last_campaign') && (
                        <td className="p-3 text-muted-foreground text-xs">{utmOf(l, 'last_utm_campaign')}</td>
                      )}
                      {isVisible('notas') && (
                        <td className="p-3 max-w-[180px]">
                          {lNote ? (
                            <p className="text-xs text-muted-foreground truncate" title={lNote.note}>
                              {lNote.note}
                            </p>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                      )}
                      {isVisible('creado') && (
                        <td className="p-3 text-muted-foreground text-xs">{formatDate(l.created_at)}</td>
                      )}
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setNoteOpenFor(noteOpenFor === l.id ? null : l.id)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            title="Nota"
                          >
                            <MessageSquarePlus className="w-3.5 h-3.5" />
                          </button>
                          <Link
                            href={`/${tenant}/crm/contactos/${l.id}`}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-brand-400"
                            title="Ver ficha"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                    {/* Fila de nota inline */}
                    {noteOpenFor === l.id && (
                      <tr className="bg-muted/30">
                        <td colSpan={colCount} className="p-3">
                          <div className="flex gap-2">
                            <input
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') submitNote(l.id)
                              }}
                              placeholder="Escribe una nota…"
                              className="flex-1 bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
                              autoFocus
                            />
                            <button
                              onClick={() => submitNote(l.id)}
                              disabled={savingNote || !noteDraft.trim()}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-50"
                            >
                              {savingNote ? '…' : 'Guardar'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Diálogo nuevo contacto */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">Nuevo contacto</DialogTitle>
          </DialogHeader>
          <ContactForm onSubmit={createContact} onCancel={() => setNewOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Diálogo: gestión de campos personalizados de la subcuenta */}
      <Dialog open={fieldsOpen} onOpenChange={setFieldsOpen}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">Campos personalizados</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {customDefs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay campos personalizados en esta subcuenta.</p>
            ) : (
              <div className="space-y-1.5">
                {customDefs.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{d.label}</p>
                      <p className="text-[11px] text-muted-foreground">{d.field_type}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      onClick={() => deleteField(d.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-border pt-4 space-y-2">
              <Label className="text-xs text-muted-foreground">Nuevo campo</Label>
              <div className="flex gap-2">
                <Input
                  value={newFieldLabel}
                  onChange={(e) => setNewFieldLabel(e.target.value)}
                  placeholder="Nombre del campo (p.ej. Nivel de inglés)"
                  className="bg-muted border-border"
                />
                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as CustomFieldDefLite['field_type'])}
                  className="rounded-md bg-muted border border-border px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="text">Texto</option>
                  <option value="number">Número</option>
                  <option value="date">Fecha</option>
                  <option value="boolean">Sí/No</option>
                </select>
                <Button onClick={createField} disabled={savingField || !newFieldLabel.trim()}>
                  {savingField ? 'Creando…' : 'Crear'}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Se añaden a la ficha de todos los contactos. Al eliminar un campo se borran también sus valores.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
