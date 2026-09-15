'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  PlayCircle,
  AtSign,
  ExternalLink,
  Columns3,
  MessageSquarePlus,
  StickyNote,
  Ban,
  UserCheck,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { SearchBox, normalizeText, phoneMatches } from '@/components/ui/search-box'
import { ContactForm, type ContactFormData } from '@/components/contacts/ContactForm'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LEAD_STATUSES, leadStatusMeta, type LeadStatus } from '@/lib/lead-status'
import { useSesion, useTenant } from '@/lib/tenant-context'

type Channel = 'whatsapp' | 'llamada' | 'email' | 'otro' | ''
type SetSource = 'closer' | 'setter' | 'cold_caller' | 'affiliate' | null

const STATUS = LEAD_STATUSES
const statusMeta = leadStatusMeta

// Umbral de "lead caliente": ha visto al menos este % del VSL antes de agendar/registrarse.
const HOT_PCT = 75

// Cadencia de seguimiento (estilo CRM): agrupa los leads por días desde el último contacto para
// trabajar el "día 1 / día 2 / día 3" y detectar los que llevan sin tocarse o sin contactar nunca.
const FOLLOWUP: {
  value: 'sin_contacto' | 'hoy' | 'd1' | 'd2' | 'd3' | 'd4plus'
  label: string
  color: string
  dot: string
}[] = [
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

type LeadRow = {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  instagram: string | null
  lead_status: LeadStatus
  lead_channel: Channel
  vsl_watch_pct: number | null
  created_at: string
  set_source: SetSource
  first_contact_at: string | null
  contact_attempts: number | null
  contact_attributions: Attribution[]
  contact_notes: Note[]
}

type ApptLite = { contact_id: string | null; appointment_datetime: string | null; created_at: string; status: string }

const DAY_MS = 1000 * 60 * 60 * 24

// Última actividad conocida con un lead = lo más reciente entre: la última nota, la última cita
// (fecha de la cita o, si es futura/nula, cuándo se creó) y el primer contacto registrado.
function lastActivityAt(l: LeadRow, appts: ApptLite[]): number | null {
  const times: number[] = []
  for (const n of l.contact_notes || []) {
    const t = new Date(n.created_at).getTime()
    if (!isNaN(t)) times.push(t)
  }
  for (const a of appts) {
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

// Bucket de cadencia de seguimiento a partir de los días transcurridos desde la última actividad
// (o desde el alta si nunca se contactó). Devuelve la clave usada por el filtro y las columnas.
type FollowupBucket = 'sin_contacto' | 'hoy' | 'd1' | 'd2' | 'd3' | 'd4plus'

function followupBucket(l: LeadRow, appts: ApptLite[], now: number): { bucket: FollowupBucket; days: number | null } {
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

type ColumnKey =
  | 'nombre'
  | 'telefono'
  | 'email'
  | 'instagram'
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
  | 'ult_contacto'
  | 'seguimiento'
  | 'notas'
  | 'creado'

const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'email', label: 'Email' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'ult_contacto', label: 'Último contacto' },
  { key: 'seguimiento', label: 'Seguimiento (día)' },
  { key: 'fuente', label: 'Fuente' },
  { key: 'utm_source', label: 'UTM Source (actual)' },
  { key: 'utm_medium', label: 'UTM Medium (actual)' },
  { key: 'utm_campaign', label: 'UTM Campaign (actual)' },
  { key: 'utm_content', label: 'UTM Content (actual)' },
  { key: 'utm_term', label: 'UTM Term (actual)' },
  { key: 'first_source', label: 'First Source' },
  { key: 'first_campaign', label: 'First Campaign' },
  { key: 'last_source', label: 'Last Source' },
  { key: 'last_campaign', label: 'Last Campaign' },
  { key: 'vsl', label: '% VSL' },
  { key: 'estado', label: 'Estado' },
  { key: 'canal', label: 'Canal' },
  { key: 'notas', label: 'Notas' },
  { key: 'creado', label: 'Creado' },
]

const DEFAULT_COLS: ColumnKey[] = ['nombre', 'telefono', 'email', 'ult_contacto', 'seguimiento', 'estado', 'canal']
const COLS_STORAGE_KEY = 'leads_cols'

export function ContactsLeadsView() {
  const tenant = useTenant()
  const sesion = useSesion()
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [appts, setAppts] = useState<ApptLite[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<LeadStatus | 'all'>('all')
  const [followup, setFollowup] = useState<FollowupBucket | 'all'>('all')
  const [q, setQ] = useState('')
  const [hotOnly, setHotOnly] = useState(false) // solo leads calientes (VSL ≥ 75%)
  const [sortByVsl, setSortByVsl] = useState(false) // priorizar la cola por % visto
  const [visibleCols, setVisibleCols] = useState<ColumnKey[]>(DEFAULT_COLS)
  const [colsMenuOpen, setColsMenuOpen] = useState(false)
  const [noteOpenFor, setNoteOpenFor] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [newOpen, setNewOpen] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLS_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) setVisibleCols(parsed)
      }
    } catch {
      // ignore malformed localStorage
    }
  }, [])

  const toggleCol = (key: ColumnKey) => {
    setVisibleCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      try {
        localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const load = async () => {
    const supabase = createClient()
    const [contactsRes, apptRes] = await Promise.all([
      supabase
        .from('contacts')
        .select(
          `
          id, full_name, email, phone, instagram, lead_status, lead_channel, vsl_watch_pct, created_at, set_source, first_contact_at, contact_attempts,
          contact_attributions(source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, is_primary, first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content, first_utm_term, last_utm_source, last_utm_medium, last_utm_campaign, last_utm_content, last_utm_term),
          contact_notes(note, created_at)
        `
        )
        .is('merged_into', null)
        .order('created_at', { ascending: false }),
      supabase.from('appointments').select('contact_id, appointment_datetime, created_at, status'),
    ])
    // Sin esto, un fallo de RLS en contacts/appointments dejaba el tablón de Leads vacío en
    // silencio, indistinguible de "no hay leads todavía".
    if (contactsRes.error) toast.error('Error al cargar los leads', { description: contactsRes.error.message })
    if (apptRes.error) toast.error('Error al cargar las agendas', { description: apptRes.error.message })
    const sorted = ((contactsRes.data as LeadRow[]) || [])
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setLeads(sorted)
    setAppts((apptRes.data as ApptLite[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const primaryAttribution = (l: LeadRow) =>
    l.contact_attributions?.find((x) => x.is_primary) ?? l.contact_attributions?.[0]
  const sourceOf = (l: LeadRow) => primaryAttribution(l)?.source || primaryAttribution(l)?.utm_source || '—'
  const utmOf = (l: LeadRow, field: keyof Attribution) => (primaryAttribution(l)?.[field] as string | null) || '—'

  const latestNote = (l: LeadRow): Note | null => {
    if (!l.contact_notes || l.contact_notes.length === 0) return null
    return [...l.contact_notes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
  }

  const update = async (id: string, patch: Partial<Pick<LeadRow, 'lead_status' | 'lead_channel'>>) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
    // Vía API con service-role: contacts solo tiene política RLS de SELECT, un UPDATE directo
    // desde el cliente lo bloqueaba en silencio para roles no-admin (0 filas, sin error).
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
      toast.error('Error al crear el contacto', { description: json.error })
      return
    }
    toast.success('Contacto creado correctamente')
    setNewOpen(false)
    await load()
  }

  const openNoteFor = (id: string) => {
    setNoteOpenFor(noteOpenFor === id ? null : id)
    setNoteDraft('')
  }

  const submitNote = async (id: string) => {
    const note = noteDraft.trim()
    if (!note) return
    setSavingNote(true)
    const supabase = createClient()
    const { error } = await supabase.from('contact_notes').insert({
      contact_id: id,
      author_id: sesion?.userId ?? null,
      note,
    })
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

  const isNoCall = (l: LeadRow) =>
    l.set_source === 'setter' || l.lead_status === 'agendado' || l.lead_status === 'cliente'

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

  // Seguimiento (última actividad + bucket de cadencia) por lead. Se recalcula al cambiar los datos.
  const followupByLead = useMemo(() => {
    const now = Date.now()
    const m = new Map<string, { bucket: FollowupBucket; days: number | null }>()
    for (const l of leads) m.set(l.id, followupBucket(l, apptsByContact.get(l.id) ?? [], now))
    return m
  }, [leads, apptsByContact])

  const filtered = useMemo(() => {
    let base = filter === 'all' ? leads : leads.filter((l) => l.lead_status === filter)
    if (followup !== 'all') base = base.filter((l) => followupByLead.get(l.id)?.bucket === followup)
    if (hotOnly) base = base.filter((l) => Number(l.vsl_watch_pct ?? 0) >= HOT_PCT)
    const nq = normalizeText(q.trim())
    const searched = nq
      ? base.filter(
          (l) =>
            normalizeText(l.full_name || '').includes(nq) ||
            normalizeText(l.email || '').includes(nq) ||
            normalizeText(l.instagram || '').includes(nq) ||
            phoneMatches(l.phone, q)
        )
      : base
    return [...searched].sort((a, b) => {
      // Prioridad por % de VSL visto (cola de llamadas: el que más vio, primero); si no, por fecha.
      if (sortByVsl) {
        const d = Number(b.vsl_watch_pct ?? 0) - Number(a.vsl_watch_pct ?? 0)
        if (d !== 0) return d
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [leads, filter, followup, followupByLead, q, hotOnly, sortByVsl])
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

  const isVisible = (key: ColumnKey) => visibleCols.includes(key)
  const colCount = visibleCols.length + 1 // + acciones

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-end">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white hover:bg-brand-500"
          >
            <UserPlus className="w-3.5 h-3.5" /> Nuevo contacto
          </button>
          <div className="relative">
            <button
              onClick={() => setColsMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-card text-foreground border-border hover:border-border"
            >
              <Columns3 className="w-3.5 h-3.5" /> Columnas
            </button>
            {colsMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setColsMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-card shadow-xl z-20 p-2 max-h-80 overflow-y-auto">
                  {COLUMNS.map((c) => (
                    <label
                      key={c.key}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer text-xs text-foreground"
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
              </>
            )}
          </div>
        </div>
      </div>

      <SearchBox
        value={q}
        onChange={setQ}
        placeholder="Buscar por nombre, email, teléfono o Instagram..."
        className="w-full sm:w-96"
      />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${filter === 'all' ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-muted-foreground border-border'}`}
        >
          Todos ({leads.length})
        </button>
        {STATUS.map((s) => (
          <button
            key={s.value}
            onClick={() => setFilter(s.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${filter === s.value ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-muted-foreground border-border'}`}
          >
            {s.label} ({counts[s.value] || 0})
          </button>
        ))}
      </div>

      {/* Prioridad por VSL: leads calientes (vieron ≥75%) y orden por % visto para la cola de llamadas */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setHotOnly((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${hotOnly ? 'bg-orange-500/20 text-orange-300 border-orange-500/50' : 'bg-card text-muted-foreground border-border'}`}
        >
          🔥 Calientes · VSL ≥ {HOT_PCT}% ({leads.filter((l) => Number(l.vsl_watch_pct ?? 0) >= HOT_PCT).length})
        </button>
        <button
          onClick={() => setSortByVsl((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${sortByVsl ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-muted-foreground border-border'}`}
        >
          <PlayCircle className="w-3.5 h-3.5" /> Ordenar por % visto
        </button>
      </div>

      {/* Seguimiento (cadencia CRM): filtra los leads por días desde el último contacto */}
      <div>
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          Seguimiento — días desde el último contacto
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFollowup('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${followup === 'all' ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-muted-foreground border-border'}`}
          >
            Todos ({leads.length})
          </button>
          {FOLLOWUP.map((f) => (
            <button
              key={f.value}
              onClick={() => setFollowup(followup === f.value ? 'all' : f.value)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${followup === f.value ? f.color : 'bg-card text-muted-foreground border-border'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />
              {f.label} ({followupCounts[f.value] || 0})
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
              {isVisible('nombre') && <th className="text-left font-medium p-3">Nombre</th>}
              {isVisible('telefono') && <th className="text-left font-medium p-3">Teléfono</th>}
              {isVisible('email') && <th className="text-left font-medium p-3">Email</th>}
              {isVisible('instagram') && <th className="text-left font-medium p-3">Instagram</th>}
              {isVisible('ult_contacto') && <th className="text-left font-medium p-3">Último contacto</th>}
              {isVisible('seguimiento') && <th className="text-left font-medium p-3">Seguimiento</th>}
              {isVisible('fuente') && <th className="text-left font-medium p-3">Fuente</th>}
              {isVisible('utm_source') && <th className="text-left font-medium p-3">UTM Source</th>}
              {isVisible('utm_medium') && <th className="text-left font-medium p-3">UTM Medium</th>}
              {isVisible('utm_campaign') && <th className="text-left font-medium p-3">UTM Campaign</th>}
              {isVisible('utm_content') && <th className="text-left font-medium p-3">UTM Content</th>}
              {isVisible('utm_term') && <th className="text-left font-medium p-3">UTM Term</th>}
              {isVisible('first_source') && <th className="text-left font-medium p-3">First Source</th>}
              {isVisible('first_campaign') && <th className="text-left font-medium p-3">First Campaign</th>}
              {isVisible('last_source') && <th className="text-left font-medium p-3">Last Source</th>}
              {isVisible('last_campaign') && <th className="text-left font-medium p-3">Last Campaign</th>}
              {isVisible('vsl') && <th className="text-center font-medium p-3">% VSL</th>}
              {isVisible('estado') && <th className="text-left font-medium p-3">Estado</th>}
              {isVisible('canal') && <th className="text-left font-medium p-3">Canal</th>}
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
                  Sin leads.
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
                        <td className="p-3 text-foreground">
                          <div className="flex flex-col gap-1">
                            <span>{l.full_name}</span>
                            {l.set_source === 'setter' && (
                              <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-md text-[10px] font-semibold bg-brand-500/20 text-brand-300 border border-brand-500/40">
                                <UserCheck className="w-3 h-3" /> De setter
                              </span>
                            )}
                            {isNoCall(l) && (
                              <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-md text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/40">
                                <Ban className="w-3 h-3" /> No llamar (agendado por setter)
                              </span>
                            )}
                            {Number(l.vsl_watch_pct ?? 0) >= HOT_PCT && (
                              <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-md text-[10px] font-semibold bg-orange-500/20 text-orange-300 border border-orange-500/40">
                                🔥 Lead caliente · {Number(l.vsl_watch_pct)}% VSL
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      {isVisible('telefono') && <td className="p-3 text-muted-foreground">{l.phone || '—'}</td>}
                      {isVisible('email') && <td className="p-3 text-muted-foreground">{l.email || '—'}</td>}
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
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                      {isVisible('ult_contacto') && (
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center gap-1.5 text-xs ${fu.days == null ? 'text-red-400' : fu.days <= 0 ? 'text-emerald-400' : fu.days <= 3 ? 'text-amber-400' : 'text-red-400'}`}
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
                      {isVisible('seguimiento') && (
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${fuMeta.color}`}
                          >
                            {fuMeta.label}
                          </span>
                        </td>
                      )}
                      {isVisible('fuente') && <td className="p-3 text-muted-foreground">{sourceOf(l)}</td>}
                      {isVisible('utm_source') && (
                        <td className="p-3 text-muted-foreground">{utmOf(l, 'utm_source')}</td>
                      )}
                      {isVisible('utm_medium') && (
                        <td className="p-3 text-muted-foreground">{utmOf(l, 'utm_medium')}</td>
                      )}
                      {isVisible('utm_campaign') && (
                        <td className="p-3 text-muted-foreground">{utmOf(l, 'utm_campaign')}</td>
                      )}
                      {isVisible('utm_content') && (
                        <td className="p-3 text-muted-foreground">{utmOf(l, 'utm_content')}</td>
                      )}
                      {isVisible('utm_term') && <td className="p-3 text-muted-foreground">{utmOf(l, 'utm_term')}</td>}
                      {isVisible('first_source') && (
                        <td className="p-3 text-muted-foreground">{utmOf(l, 'first_utm_source')}</td>
                      )}
                      {isVisible('first_campaign') && (
                        <td className="p-3 text-muted-foreground">{utmOf(l, 'first_utm_campaign')}</td>
                      )}
                      {isVisible('last_source') && (
                        <td className="p-3 text-muted-foreground">{utmOf(l, 'last_utm_source')}</td>
                      )}
                      {isVisible('last_campaign') && (
                        <td className="p-3 text-muted-foreground">{utmOf(l, 'last_utm_campaign')}</td>
                      )}
                      {isVisible('vsl') && (
                        <td className="p-3 text-center">
                          {l.vsl_watch_pct != null ? (
                            <span
                              className={`inline-flex items-center gap-1 ${Number(l.vsl_watch_pct) >= 75 ? 'text-emerald-400' : 'text-foreground'}`}
                            >
                              <PlayCircle className="w-3 h-3" />
                              {Number(l.vsl_watch_pct)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                      {isVisible('estado') && (
                        <td className="p-3">
                          <select
                            value={l.lead_status}
                            onChange={(e) => update(l.id, { lead_status: e.target.value as LeadStatus })}
                            className={`text-xs rounded-md border px-2 py-1 bg-transparent ${statusMeta(l.lead_status).color}`}
                          >
                            {STATUS.map((s) => (
                              <option key={s.value} value={s.value} className="bg-card text-foreground">
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      {isVisible('canal') && (
                        <td className="p-3">
                          <select
                            value={l.lead_channel || ''}
                            onChange={(e) => update(l.id, { lead_channel: e.target.value as Channel })}
                            className="text-xs rounded-md border border-border bg-muted text-foreground px-2 py-1"
                          >
                            <option value="">—</option>
                            <option value="whatsapp">WhatsApp</option>
                            <option value="llamada">Llamada</option>
                            <option value="email">Email</option>
                            <option value="otro">Otro</option>
                          </select>
                        </td>
                      )}
                      {isVisible('notas') && (
                        <td className="p-3 max-w-[220px]">
                          <div className="flex items-start gap-1.5">
                            <button
                              onClick={() => openNoteFor(l.id)}
                              className="text-muted-foreground hover:text-brand-400 shrink-0"
                              title="Añadir nota"
                            >
                              <MessageSquarePlus className="w-3.5 h-3.5" />
                            </button>
                            <div className="min-w-0">
                              {lNote ? (
                                <div className="text-xs text-muted-foreground truncate" title={lNote.note}>
                                  <StickyNote className="w-3 h-3 inline mr-1 text-muted-foreground" />
                                  {lNote.note}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">Sin notas</span>
                              )}
                              {l.contact_notes?.length > 0 && (
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  {l.contact_notes.length} nota{l.contact_notes.length > 1 ? 's' : ''}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      )}
                      {isVisible('creado') && (
                        <td className="p-3 text-muted-foreground text-xs">
                          {new Date(l.created_at).toLocaleDateString('es-ES')}
                        </td>
                      )}
                      <td className="p-3 text-right whitespace-nowrap">
                        <Link
                          href={`/${tenant}/crm/contactos/${l.id}`}
                          className="text-brand-400 hover:text-brand-300 inline-flex items-center gap-1 text-xs"
                        >
                          Ficha <ExternalLink className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                    {noteOpenFor === l.id && (
                      <tr className="border-b border-border/50 bg-card/40">
                        <td colSpan={colCount} className="p-3">
                          <div className="flex items-center gap-2">
                            <input
                              autoFocus
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') submitNote(l.id)
                              }}
                              placeholder={`Nota rápida sobre ${l.full_name}…`}
                              className="flex-1 bg-muted border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-500"
                            />
                            <button
                              onClick={() => submitNote(l.id)}
                              disabled={savingNote || !noteDraft.trim()}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white disabled:opacity-50"
                            >
                              Guardar
                            </button>
                            <button
                              onClick={() => setNoteOpenFor(null)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground border border-border"
                            >
                              Cancelar
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

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo Contacto</DialogTitle>
          </DialogHeader>
          <ContactForm onSubmit={createContact} onCancel={() => setNewOpen(false)} submitLabel="Crear Contacto" />
        </DialogContent>
      </Dialog>
    </div>
  )
}
