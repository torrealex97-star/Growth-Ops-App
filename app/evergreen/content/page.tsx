'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Clapperboard, Plus, X, ExternalLink, LayoutGrid, Table2, Maximize2, SlidersHorizontal, Users, ArrowDownUp, ChevronUp, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { testimonioPitch, type Testimonio } from '@/lib/testimonios-shared'

const STATUSES = [
  { value: 'idea', label: 'Idea' },
  { value: 'guionizado', label: 'Guionizado' },
  { value: 'grabado', label: 'Grabado' },
  { value: 'editando', label: 'Editando' },
  { value: 'editado', label: 'Editado' },
  { value: 'publicado', label: 'Publicado' },
] as const
const STATUS_COLORS: Record<string, string> = {
  idea: 'bg-muted/60 text-foreground',
  guionizado: 'bg-sky-500/15 text-sky-300 border border-sky-500/30',
  grabado: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  editando: 'bg-orange-500/15 text-orange-300 border border-orange-500/30',
  editado: 'bg-brand-500/15 text-brand-300 border border-brand-500/30',
  publicado: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
}
const TYPES = [
  { value: 'reel', label: 'Reel' }, { value: 'short', label: 'Short' },
  { value: 'video_largo', label: 'Vídeo largo' }, { value: 'carrusel', label: 'Carrusel' },
  { value: 'email', label: 'Email' }, { value: 'otro', label: 'Otro' },
] as const

// Columnas conmutables de la tabla (# y Reel/Idea van siempre). El orden aquí
// también es el orden del selector de columnas.
type ColKey = 'editor' | 'solution_explanation' | 'solution_link' | 'reference_reel_url' | 'reference_transcript' | 'our_reel_url' | 'script' | 'testimonio' | 'status' | 'price' | 'publish_date' | 'created_at'
const COLUMNS: { key: ColKey; label: string }[] = [
  { key: 'editor', label: 'Editor' },
  { key: 'solution_explanation', label: 'Explicación solución' },
  { key: 'solution_link', label: 'Link solución' },
  { key: 'reference_reel_url', label: 'Reel referencia' },
  { key: 'reference_transcript', label: 'Transcripción ref.' },
  { key: 'our_reel_url', label: 'Nuestro reel' },
  { key: 'script', label: 'Guion' },
  { key: 'testimonio', label: 'Testimonio' },
  { key: 'status', label: 'Estado' },
  { key: 'price', label: 'Precio' },
  { key: 'publish_date', label: 'Fecha' },
  { key: 'created_at', label: 'Añadido' },
]
const COLS_STORAGE_KEY = 'iaw_content_cols'
const SORT_STORAGE_KEY = 'iaw_content_sort'
const defaultCols = (): Record<ColKey, boolean> => Object.fromEntries(COLUMNS.map((c) => [c.key, true])) as Record<ColKey, boolean>

// Orden de la lista. Por defecto por fecha de inclusión (las nuevas arriba): así una pieza NO se
// mueve de sitio al cambiarle el estado, que es lo que despistaba al editor. El orden por pipeline
// sigue disponible para quien quiera ver el flujo idea → publicado.
type SortKey = 'created_desc' | 'created_asc' | 'pipeline' | 'publish_asc' | 'title_asc' | 'manual'
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'created_desc', label: 'Añadido: nuevo primero' },
  { value: 'created_asc', label: 'Añadido: antiguo primero' },
  { value: 'pipeline', label: 'Fase del pipeline' },
  { value: 'publish_asc', label: 'Fecha de publicación' },
  { value: 'title_asc', label: 'Título (A-Z)' },
  { value: 'manual', label: 'Manual (arrastrar con flechas)' },
]

type Content = {
  id: string; title: string; content_type: string; status: string; link_url: string | null
  publish_date: string | null; assigned_to: string | null; notes: string | null
  solution_explanation: string | null; solution_link: string | null
  reference_reel_url: string | null; reference_transcript: string | null
  our_reel_url: string | null; script: string | null
  testimonio_id: string | null
  price: number | null
  sort_order: number | null
  created_at?: string | null
  assignee?: { full_name: string } | null
}
type DbUser = { id: string; full_name: string }
type View = 'tabla' | 'kanban'

const statusIndex = (s: string) => {
  const i = STATUSES.findIndex((x) => x.value === s)
  return i === -1 ? 99 : i
}

export default function ContentPage() {
  const [items, setItems] = useState<Content[]>([])
  const [users, setUsers] = useState<DbUser[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('tabla')
  const [showNew, setShowNew] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [nc, setNc] = useState({ title: '', content_type: 'reel', link_url: '', publish_date: '', assigned_to: '', notes: '' })
  const [myId, setMyId] = useState<string | null>(null)
  const [myRole, setMyRole] = useState('')
  // Filtro por editor: '' = todos, 'none' = sin asignar, o el id del usuario.
  const [editorFilter, setEditorFilter] = useState<string>('')
  // Filtros de estado y tipo ('' = todos) + orden elegido (persistido).
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [sort, setSort] = useState<SortKey>('created_desc')
  // Visibilidad de columnas (persistida en localStorage) + popover.
  const [cols, setCols] = useState<Record<ColKey, boolean>>(defaultCols)
  const [showCols, setShowCols] = useState(false)
  const [testimonios, setTestimonios] = useState<Testimonio[]>([])

  const load = async () => {
    const supabase = createClient()
    const [cRes, uRes, authRes] = await Promise.all([
      supabase.from('content_items').select('*, assignee:assigned_to(full_name)').order('created_at', { ascending: false }),
      supabase.from('users').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase.auth.getUser(),
    ])
    setItems((cRes.data as Content[]) || [])
    setUsers((uRes.data as DbUser[]) || [])
    setLoading(false)
    const uid = authRes.data.user?.id
    if (uid) {
      setMyId(uid)
      const { data: urow } = await supabase.from('users').select('roles(key)').eq('id', uid).single()
      setMyRole((urow?.roles as { key?: string } | null)?.key || '')
    }
  }
  useEffect(() => { load() }, [])
  // Catálogo de casos de éxito, para marcar qué testimonio lleva cada pieza.
  useEffect(() => {
    fetch('/api/evergreen/testimonios')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setTestimonios((j.testimonios || []).filter((t: Testimonio) => t.active)))
      .catch(() => {})
  }, [])

  // Recupera la configuración de columnas y el orden guardados.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLS_STORAGE_KEY)
      if (raw) setCols((prev) => ({ ...prev, ...JSON.parse(raw) }))
      const s = localStorage.getItem(SORT_STORAGE_KEY)
      if (s && SORTS.some((x) => x.value === s)) setSort(s as SortKey)
    } catch { /* noop */ }
  }, [])
  const changeSort = (s: SortKey) => {
    setSort(s)
    try { localStorage.setItem(SORT_STORAGE_KEY, s) } catch { /* noop */ }
  }
  const toggleCol = (k: ColKey) => setCols((prev) => {
    const next = { ...prev, [k]: !prev[k] }
    try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(next)) } catch { /* noop */ }
    return next
  })

  // Orden para ambas vistas, según lo elegido en la barra. El desempate siempre es la fecha de
  // inclusión (más reciente primero) para que la lista sea estable entre recargas.
  const sorted = useMemo(() => {
    const byCreated = (a: Content, b: Content) => (b.created_at || '').localeCompare(a.created_at || '')
    return [...items].sort((a, b) => {
      if (sort === 'manual') return (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) || byCreated(a, b)
      if (sort === 'created_desc') return byCreated(a, b)
      if (sort === 'created_asc') return (a.created_at || '').localeCompare(b.created_at || '')
      if (sort === 'title_asc') return (a.title || '').localeCompare(b.title || '', 'es') || byCreated(a, b)
      if (sort === 'publish_asc') {
        const ad = a.publish_date || '9999-12-31', bd = b.publish_date || '9999-12-31'
        if (ad !== bd) return ad < bd ? -1 : 1
        return byCreated(a, b)
      }
      // 'pipeline': fase → fecha prevista → más reciente.
      const s = statusIndex(a.status) - statusIndex(b.status)
      if (s) return s
      const ad = a.publish_date || '9999-12-31', bd = b.publish_date || '9999-12-31'
      if (ad !== bd) return ad < bd ? -1 : 1
      return byCreated(a, b)
    })
  }, [items, sort])

  // Aplica los filtros (editor, estado, tipo) sobre el orden elegido.
  const filtered = useMemo(() => {
    return sorted.filter((c) => {
      if (editorFilter === 'none' ? !!c.assigned_to : editorFilter && c.assigned_to !== editorFilter) return false
      if (statusFilter && c.status !== statusFilter) return false
      if (typeFilter && c.content_type !== typeFilter) return false
      return true
    })
  }, [sorted, editorFilter, statusFilter, typeFilter])

  // Edición inline: actualización optimista + persistencia.
  const patch = (id: string, field: keyof Content, value: string | number | null) => {
    setItems((prev) => prev.map((c) => {
      if (c.id !== id) return c
      const next = { ...c, [field]: value }
      // Mantén el nombre del editor sincronizado al reasignar (para el orden/filtro/kanban).
      if (field === 'assigned_to') next.assignee = value ? { full_name: users.find((u) => u.id === value)?.full_name || '' } : null
      return next
    }))
  }
  const persist = async (id: string, field: keyof Content, value: string | number | null) => {
    const supabase = createClient()
    const { error } = await supabase.from('content_items').update({ [field]: value }).eq('id', id)
    if (error) toast.error('No se pudo guardar', { description: error.message })
  }

  // Reordena manualmente: intercambia sort_order con el vecino visible (arriba/abajo) y persiste
  // ambos. Solo tiene sentido con el orden "Manual" seleccionado.
  const moveItem = async (id: string, direction: 'up' | 'down') => {
    const idx = filtered.findIndex((c) => c.id === id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (idx === -1 || swapIdx < 0 || swapIdx >= filtered.length) return
    const a = filtered[idx], b = filtered[swapIdx]
    const aOrder = a.sort_order ?? idx, bOrder = b.sort_order ?? swapIdx
    setItems((prev) => prev.map((c) => {
      if (c.id === a.id) return { ...c, sort_order: bOrder }
      if (c.id === b.id) return { ...c, sort_order: aOrder }
      return c
    }))
    const supabase = createClient()
    const [r1, r2] = await Promise.all([
      supabase.from('content_items').update({ sort_order: bOrder }).eq('id', a.id),
      supabase.from('content_items').update({ sort_order: aOrder }).eq('id', b.id),
    ])
    if (r1.error || r2.error) toast.error('No se pudo reordenar', { description: r1.error?.message || r2.error?.message })
  }

  const create = async () => {
    if (!nc.title.trim()) { toast.error('Pon un título'); return }
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    // Un editor solo puede crear RLS-mente piezas asignadas a sí mismo (content_editor_insert,
    // v60): si dejaba "Editor" sin elegir o elegía a otra persona, el insert lo rechazaba la
    // base de datos y la pieza no llegaba a la tabla.
    const assignedTo = myRole === 'editor' ? myId : nc.assigned_to || null
    const { error } = await supabase.from('content_items').insert({
      title: nc.title.trim(), content_type: nc.content_type, link_url: nc.link_url || null,
      publish_date: nc.publish_date || null, assigned_to: assignedTo, notes: nc.notes || null,
      status: 'idea', created_by: user?.id,
    })
    if (error) { toast.error('Error al crear', { description: error.message }); return }
    toast.success('Pieza creada'); setShowNew(false)
    setNc({ title: '', content_type: 'reel', link_url: '', publish_date: '', assigned_to: '', notes: '' }); load()
  }

  const detailItem = detailId ? items.find((c) => c.id === detailId) || null : null

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Clapperboard className="w-6 h-6 text-brand-400" /> Contenido</h1>
          <p className="text-muted-foreground text-sm mt-1">Pipeline editorial — idea → guionizado → grabado → editando → editado → publicado</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setView('tabla')} className={`flex items-center gap-1.5 px-3 py-2 text-sm ${view === 'tabla' ? 'bg-brand-600 text-white' : 'bg-card text-muted-foreground hover:text-foreground'}`}><Table2 className="w-4 h-4" /> Tabla</button>
            <button onClick={() => setView('kanban')} className={`flex items-center gap-1.5 px-3 py-2 text-sm ${view === 'kanban' ? 'bg-brand-600 text-white' : 'bg-card text-muted-foreground hover:text-foreground'}`}><LayoutGrid className="w-4 h-4" /> Kanban</button>
          </div>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-brand-600 text-white hover:bg-brand-500">
            <Plus className="w-4 h-4" /> Nueva pieza
          </button>
        </div>
      </div>

      {/* Barra de filtros / vistas */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="w-4 h-4" />
          <select
            value={editorFilter}
            onChange={(e) => setEditorFilter(e.target.value)}
            className="text-sm rounded-lg border border-border bg-card text-foreground px-3 py-2 focus:outline-none focus:border-brand-500"
          >
            <option value="">Todos los editores</option>
            <option value="none">Sin asignar</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>

        {/* Estado y tipo: para aislar "solo ideas", "solo grabados", etc. */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm rounded-lg border border-border bg-card text-foreground px-3 py-2 focus:outline-none focus:border-brand-500"
        >
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="text-sm rounded-lg border border-border bg-card text-foreground px-3 py-2 focus:outline-none focus:border-brand-500"
        >
          <option value="">Todos los formatos</option>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        {/* Orden: por defecto por fecha de inclusión, para que nada salte al cambiar de estado. */}
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <ArrowDownUp className="w-4 h-4" />
          <select
            value={sort}
            onChange={(e) => changeSort(e.target.value as SortKey)}
            title="Con el orden por fase, una pieza cambia de sitio al cambiarle el estado"
            className="text-sm rounded-lg border border-border bg-card text-foreground px-3 py-2 focus:outline-none focus:border-brand-500"
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {(statusFilter || typeFilter || editorFilter) && (
          <button
            onClick={() => { setStatusFilter(''); setTypeFilter(''); setEditorFilter('') }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Limpiar filtros
          </button>
        )}

        {view === 'tabla' && (
          <div className="relative">
            <button onClick={() => setShowCols((s) => !s)} className="flex items-center gap-1.5 text-sm rounded-lg border border-border bg-card text-foreground px-3 py-2 hover:bg-card/70">
              <SlidersHorizontal className="w-4 h-4" /> Columnas
              <span className="text-xs text-muted-foreground">({COLUMNS.filter((c) => cols[c.key]).length}/{COLUMNS.length})</span>
            </button>
            {showCols && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowCols(false)} />
                <div className="absolute left-0 mt-2 z-40 w-56 bg-card border border-border rounded-lg p-2 shadow-xl">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 py-1">Mostrar columnas</p>
                  {COLUMNS.map((col) => (
                    <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm text-foreground">
                      <input type="checkbox" checked={!!cols[col.key]} onChange={() => toggleCol(col.key)} className="accent-brand-500" />
                      {col.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} pieza{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {loading ? (
        <div className="h-64 bg-card rounded-lg animate-pulse" />
      ) : view === 'kanban' ? (
        <KanbanView items={filtered} users={users} patch={patch} persist={persist} onOpen={setDetailId} />
      ) : (
        <>
          <TableView items={filtered} users={users} cols={cols} testimonios={testimonios} patch={patch} persist={persist} onOpen={setDetailId} onMove={sort === 'manual' ? moveItem : undefined} />
          {cols.price && <MonthlyPriceSummary items={filtered} />}
        </>
      )}

      {/* Tarjeta de detalle: leer/editar TODO el reel */}
      {detailItem && (
        <DetailCard item={detailItem} users={users} testimonios={testimonios} patch={patch} persist={persist} onClose={() => setDetailId(null)} />
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowNew(false)}>
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">Nueva pieza de contenido</h3>
              <button onClick={() => setShowNew(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <input value={nc.title} onChange={(e) => setNc({ ...nc, title: e.target.value })} placeholder="Título" className={cls} />
            <div className="grid grid-cols-2 gap-3">
              <select value={nc.content_type} onChange={(e) => setNc({ ...nc, content_type: e.target.value })} className={cls}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input type="date" value={nc.publish_date} onChange={(e) => setNc({ ...nc, publish_date: e.target.value })} className={cls} />
            </div>
            <input value={nc.link_url} onChange={(e) => setNc({ ...nc, link_url: e.target.value })} placeholder="Enlace (Drive, etc.)" className={cls} />
            {myRole === 'editor' ? (
              <p className="text-xs text-muted-foreground">Se te asignará a ti la pieza ({users.find((u) => u.id === myId)?.full_name || 'tú'}).</p>
            ) : (
              <select value={nc.assigned_to} onChange={(e) => setNc({ ...nc, assigned_to: e.target.value })} className={cls}>
                <option value="">— asignar editor —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            )}
            <textarea value={nc.notes} onChange={(e) => setNc({ ...nc, notes: e.target.value })} rows={2} placeholder="Notas" className={cls} />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowNew(false)} className="px-3 py-2 text-sm text-muted-foreground">Cancelar</button>
              <button onClick={create} className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg">Crear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type EditProps = {
  items: Content[]
  users: DbUser[]
  patch: (id: string, field: keyof Content, value: string | number | null) => void
  persist: (id: string, field: keyof Content, value: string | number | null) => void
  onOpen: (id: string) => void
}

// Suma el precio de las piezas por mes (fecha de publicación si existe, si no fecha de alta), para
// llevar el pago a editores por pieza. Se agrupa de más reciente a más antiguo.
function MonthlyPriceSummary({ items }: { items: Content[] }) {
  const byMonth = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of items) {
      if (typeof c.price !== 'number' || !c.price) continue
      const date = c.publish_date || c.created_at || ''
      const month = date.slice(0, 7) // YYYY-MM
      if (!month) continue
      map.set(month, (map.get(month) || 0) + c.price)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [items])

  if (byMonth.length === 0) return null
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Total por mes (precio de las piezas)</p>
      <div className="flex flex-wrap gap-3">
        {byMonth.map(([month, total]) => (
          <div key={month} className="rounded-lg border border-border px-3 py-2 min-w-[110px]">
            <p className="text-[11px] text-muted-foreground">{month}</p>
            <p className="text-sm font-semibold text-foreground">{total.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Vista tabla ───────────────────────────────────────────────────────────────
function TableView({ items, users, cols, testimonios, patch, persist, onOpen, onMove }: EditProps & { cols: Record<ColKey, boolean>; testimonios: Testimonio[]; onMove?: (id: string, direction: 'up' | 'down') => void }) {
  // Selector de testimonio: el editor ve de un vistazo qué caso lleva la pieza.
  const testimonioCell = (c: Content) => (
    <td className="px-2 py-1 align-middle min-w-[170px]">
      <select
        value={c.testimonio_id || ''}
        onChange={(e) => { const v = e.target.value || null; patch(c.id, 'testimonio_id', v); persist(c.id, 'testimonio_id', v) }}
        className="w-full bg-transparent border border-transparent hover:border-border focus:border-brand-500 rounded px-2 py-1 text-xs text-foreground focus:outline-none"
      >
        <option value="" className="bg-muted text-foreground">— sin testimonio —</option>
        {testimonios.map((t) => (
          <option key={t.id} value={t.id} className="bg-muted text-foreground">{t.name}</option>
        ))}
      </select>
    </td>
  )
  const cell = (id: string, field: keyof Content, value: string | null, placeholder: string, w = 'min-w-[160px]') => (
    <td className={`px-2 py-1 align-middle ${w}`}>
      <input
        defaultValue={value || ''}
        onBlur={(e) => { if ((e.target.value || null) !== value) { patch(id, field, e.target.value || null); persist(id, field, e.target.value || null) } }}
        placeholder={placeholder}
        className="w-full bg-transparent border border-transparent hover:border-border focus:border-brand-500 rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none truncate"
      />
    </td>
  )
  const linkCell = (id: string, field: keyof Content, value: string | null) => (
    <td className="px-2 py-1 align-middle min-w-[140px]">
      <div className="flex items-center gap-1">
        <input
          defaultValue={value || ''}
          onBlur={(e) => { if ((e.target.value || null) !== value) { patch(id, field, e.target.value || null); persist(id, field, e.target.value || null) } }}
          placeholder="https://…"
          className="w-full bg-transparent border border-transparent hover:border-border focus:border-brand-500 rounded px-2 py-1 text-sm text-sky-400 placeholder:text-muted-foreground focus:outline-none truncate"
        />
        {value && <a href={value} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-sky-400 shrink-0"><ExternalLink className="w-3.5 h-3.5" /></a>}
      </div>
    </td>
  )
  const readCell = (id: string, value: string | null, placeholder: string) => (
    <td className="px-2 py-1 align-middle min-w-[150px] max-w-[220px]">
      <button onClick={() => onOpen(id)} className="block text-left w-full text-sm text-foreground hover:text-foreground border border-transparent hover:border-border rounded px-2 py-1 truncate">
        {value ? <span className="truncate">{value.replace(/\s+/g, ' ')}</span> : <span className="text-muted-foreground">{placeholder}</span>}
      </button>
    </td>
  )
  const priceCell = (c: Content) => (
    <td className="px-2 py-1 align-middle min-w-[100px]">
      <input
        type="number" step="0.01" min="0"
        defaultValue={c.price ?? ''}
        onBlur={(e) => {
          const v = e.target.value === '' ? null : parseFloat(e.target.value)
          if (v !== c.price) { patch(c.id, 'price', v); persist(c.id, 'price', v) }
        }}
        placeholder="0,00 €"
        className="w-full bg-transparent border border-transparent hover:border-border focus:border-brand-500 rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
    </td>
  )
  const editorCell = (c: Content) => (
    <td className="px-2 py-1 align-middle min-w-[150px]">
      <select
        value={c.assigned_to || ''}
        onChange={(e) => { const v = e.target.value || null; patch(c.id, 'assigned_to', v); persist(c.id, 'assigned_to', v) }}
        className={`w-full text-xs rounded px-2 py-1 focus:outline-none ${c.assigned_to ? 'border border-brand-500/30 bg-brand-500/10 text-brand-300' : 'border border-border bg-muted text-muted-foreground'}`}
      >
        <option value="" className="bg-muted text-foreground">— sin asignar —</option>
        {users.map((u) => <option key={u.id} value={u.id} className="bg-muted text-foreground">{u.full_name}</option>)}
      </select>
    </td>
  )

  const colCount = 2 + COLUMNS.filter((c) => cols[c.key]).length

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-card/50">
            <th className="px-3 py-2 font-semibold w-10">#</th>
            <th className="px-3 py-2 font-semibold">Reel / Idea</th>
            {cols.editor && <th className="px-3 py-2 font-semibold">Editor</th>}
            {cols.solution_explanation && <th className="px-3 py-2 font-semibold">Explicación solución</th>}
            {cols.solution_link && <th className="px-3 py-2 font-semibold">Link solución</th>}
            {cols.reference_reel_url && <th className="px-3 py-2 font-semibold">Reel referencia</th>}
            {cols.reference_transcript && <th className="px-3 py-2 font-semibold">Transcripción ref.</th>}
            {cols.our_reel_url && <th className="px-3 py-2 font-semibold">Nuestro reel</th>}
            {cols.script && <th className="px-3 py-2 font-semibold">Guion</th>}
            {cols.testimonio && <th className="px-3 py-2 font-semibold">Testimonio</th>}
            {cols.status && <th className="px-3 py-2 font-semibold">Estado</th>}
            {cols.price && <th className="px-3 py-2 font-semibold">Precio</th>}
            {cols.publish_date && <th className="px-3 py-2 font-semibold">Fecha</th>}
            {cols.created_at && <th className="px-3 py-2 font-semibold">Añadido</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((c, i) => (
            <tr key={c.id} className="border-b border-border/60 hover:bg-card/30">
              <td className="px-3 py-1 align-middle text-xs text-muted-foreground tabular-nums">
                {onMove ? (
                  <div className="flex items-center gap-1">
                    <span>{i + 1}</span>
                    <div className="flex flex-col -space-y-1">
                      <button onClick={() => onMove(c.id, 'up')} disabled={i === 0} className="text-muted-foreground hover:text-brand-400 disabled:opacity-20" title="Subir"><ChevronUp className="w-3 h-3" /></button>
                      <button onClick={() => onMove(c.id, 'down')} disabled={i === items.length - 1} className="text-muted-foreground hover:text-brand-400 disabled:opacity-20" title="Bajar"><ChevronDown className="w-3 h-3" /></button>
                    </div>
                  </div>
                ) : i + 1}
              </td>
              {/* Título prominente + botón para abrir la tarjeta completa */}
              <td className="px-2 py-1 align-middle min-w-[220px] max-w-[300px]">
                <div className="flex items-center gap-1.5">
                  <button onClick={() => onOpen(c.id)} className="text-muted-foreground hover:text-brand-400 shrink-0" title="Abrir tarjeta">
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                  <input
                    defaultValue={c.title || ''}
                    onBlur={(e) => { if ((e.target.value || null) !== c.title) { patch(c.id, 'title', e.target.value || null); persist(c.id, 'title', e.target.value || null) } }}
                    placeholder="(sin título)"
                    className="w-full min-w-0 bg-transparent border border-transparent hover:border-border focus:border-brand-500 rounded px-2 py-1 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none truncate"
                  />
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{TYPES.find((t) => t.value === c.content_type)?.label}</span>
                </div>
              </td>
              {cols.editor && editorCell(c)}
              {cols.solution_explanation && cell(c.id, 'solution_explanation', c.solution_explanation, 'Qué resuelve…', 'min-w-[200px]')}
              {cols.solution_link && linkCell(c.id, 'solution_link', c.solution_link)}
              {cols.reference_reel_url && linkCell(c.id, 'reference_reel_url', c.reference_reel_url)}
              {cols.reference_transcript && readCell(c.id, c.reference_transcript, 'Abrir…')}
              {cols.our_reel_url && linkCell(c.id, 'our_reel_url', c.our_reel_url)}
              {cols.script && readCell(c.id, c.script, 'Abrir…')}
              {cols.testimonio && testimonioCell(c)}
              {cols.status && (
                <td className="px-2 py-1 align-middle">
                  <select value={c.status} onChange={(e) => { patch(c.id, 'status', e.target.value); persist(c.id, 'status', e.target.value) }} className={`text-xs rounded px-2 py-1 ${STATUS_COLORS[c.status] || 'border border-border bg-muted text-foreground'}`}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value} className="bg-muted text-foreground">{s.label}</option>)}
                  </select>
                </td>
              )}
              {cols.price && priceCell(c)}
              {cols.publish_date && (
                <td className="px-2 py-1 align-middle">
                  <input type="date" defaultValue={c.publish_date || ''} onBlur={(e) => { patch(c.id, 'publish_date', e.target.value || null); persist(c.id, 'publish_date', e.target.value || null) }} className="text-xs rounded border border-border bg-muted text-foreground px-2 py-1" />
                </td>
              )}
              {/* Fecha de inclusión: solo lectura, es el criterio de orden por defecto. */}
              {cols.created_at && (
                <td className="px-3 py-1 align-middle text-xs text-muted-foreground whitespace-nowrap">
                  {c.created_at ? new Date(c.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'}
                </td>
              )}
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={colCount} className="text-center text-muted-foreground py-10">Aún no hay contenido. Crea una pieza o añádela desde Competencia.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ── Vista kanban ───────────────────────────────────────────────────────────────
function KanbanView({ items, users, patch, persist, onOpen }: EditProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
      {STATUSES.map((col) => {
        const cards = items.filter((c) => c.status === col.value)
        return (
          <div key={col.value} className="bg-card/50 border border-border rounded-lg p-3">
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs font-semibold px-2 py-1 rounded ${STATUS_COLORS[col.value] || 'bg-muted/60 text-foreground'}`}>{col.label}</span>
              <span className="text-xs text-muted-foreground">{cards.length}</span>
            </div>
            <div className="space-y-2">
              {cards.map((c) => (
                <div
                  key={c.id}
                  onClick={() => onOpen(c.id)}
                  className="group card-interactive bg-card border border-border rounded-lg p-3 space-y-2 hover:bg-card/80"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-foreground leading-snug group-hover:text-foreground">{c.title || '(sin título)'}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{TYPES.find((t) => t.value === c.content_type)?.label}</span>
                  </div>
                  {c.notes && <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{c.notes}</p>}
                  {c.publish_date && <p className="text-xs text-muted-foreground">📅 {c.publish_date}</p>}
                  {c.our_reel_url && <a onClick={(e) => e.stopPropagation()} href={c.our_reel_url} target="_blank" rel="noreferrer" className="text-xs text-brand-400 hover:text-brand-300 inline-flex items-center gap-1">Nuestro reel <ExternalLink className="w-3 h-3" /></a>}
                  {/* Editor asignado — editable en la propia tarjeta */}
                  <select
                    onClick={(e) => e.stopPropagation()}
                    value={c.assigned_to || ''}
                    onChange={(e) => { const v = e.target.value || null; patch(c.id, 'assigned_to', v); persist(c.id, 'assigned_to', v) }}
                    className={`w-full text-xs rounded px-2 py-1 focus:outline-none ${c.assigned_to ? 'border border-brand-500/30 bg-brand-500/10 text-brand-300' : 'border border-border bg-muted text-muted-foreground'}`}
                  >
                    <option value="" className="bg-muted text-foreground">✎ sin asignar</option>
                    {users.map((u) => <option key={u.id} value={u.id} className="bg-muted text-foreground">✎ {u.full_name}</option>)}
                  </select>
                  <select onClick={(e) => e.stopPropagation()} value={c.status} onChange={(e) => { patch(c.id, 'status', e.target.value); persist(c.id, 'status', e.target.value) }} className={`w-full text-xs rounded px-2 py-1 ${STATUS_COLORS[c.status] || 'border border-border bg-muted text-foreground'}`}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value} className="bg-muted text-foreground">{s.label}</option>)}
                  </select>
                </div>
              ))}
              {cards.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">—</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Tarjeta de detalle: lee/edita todo el reel ─────────────────────────────────
function DetailCard({ item, users, testimonios, patch, persist, onClose }: {
  item: Content
  users: DbUser[]
  testimonios: Testimonio[]
  patch: (id: string, field: keyof Content, value: string | number | null) => void
  persist: (id: string, field: keyof Content, value: string | null) => void
  onClose: () => void
}) {
  const testimonio = item.testimonio_id ? testimonios.find((t) => t.id === item.testimonio_id) : undefined

  const field = (label: string, key: keyof Content, rows: number, placeholder: string) => (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</label>
      <textarea
        defaultValue={(item[key] as string) || ''}
        onBlur={(e) => { const v = e.target.value || null; if (v !== item[key]) { patch(item.id, key, v); persist(item.id, key, v) } }}
        rows={rows} placeholder={placeholder} className={cls + ' whitespace-pre-wrap'}
      />
    </div>
  )
  const linkField = (label: string, key: keyof Content) => (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          defaultValue={(item[key] as string) || ''}
          onBlur={(e) => { const v = e.target.value || null; if (v !== item[key]) { patch(item.id, key, v); persist(item.id, key, v) } }}
          placeholder="https://…" className={cls + ' text-sky-400'}
        />
        {item[key] && <a href={item[key] as string} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-sky-400 shrink-0"><ExternalLink className="w-4 h-4" /></a>}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_COLORS[item.status] || 'bg-muted text-muted-foreground'}`}>{STATUSES.find((s) => s.value === item.status)?.label}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{TYPES.find((t) => t.value === item.content_type)?.label}</span>
            </div>
            <input
              defaultValue={item.title || ''}
              onBlur={(e) => { const v = e.target.value || null; if (v !== item.title) { patch(item.id, 'title', v); persist(item.id, 'title', v) } }}
              placeholder="(sin título)"
              className="w-full bg-transparent text-lg font-semibold text-foreground focus:outline-none border-b border-transparent focus:border-brand-500"
            />
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Estado</label>
              <select value={item.status} onChange={(e) => { patch(item.id, 'status', e.target.value); persist(item.id, 'status', e.target.value) }} className={`w-full text-sm rounded px-3 py-2 focus:outline-none ${STATUS_COLORS[item.status] || 'border border-border bg-muted text-foreground'}`}>
                {STATUSES.map((s) => <option key={s.value} value={s.value} className="bg-muted text-foreground">{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Fecha de publicación</label>
              <input type="date" defaultValue={item.publish_date || ''} onBlur={(e) => { const v = e.target.value || null; if (v !== item.publish_date) { patch(item.id, 'publish_date', v); persist(item.id, 'publish_date', v) } }} className={cls} />
            </div>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Editor asignado</label>
            <select value={item.assigned_to || ''} onChange={(e) => { const v = e.target.value || null; patch(item.id, 'assigned_to', v); persist(item.id, 'assigned_to', v) }} className={cls}>
              <option value="">— sin asignar —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>

          {field('La idea / notas', 'notes', 5, 'Descripción completa de la idea…')}
          {field('Explicación de la solución', 'solution_explanation', 3, 'Qué problema resuelve y cómo…')}
          {linkField('Link de la solución', 'solution_link')}
          {linkField('Reel de referencia', 'reference_reel_url')}
          {field('Transcripción del reel de referencia', 'reference_transcript', 6, 'Transcripción…')}
          {linkField('Nuestro reel', 'our_reel_url')}
          {field('Guion de nuestro reel', 'script', 10, 'Escribe o pega el guion…')}

          {/* Testimonio de la pieza: el editor coge de aquí la foto, la historia y el vídeo. */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Testimonio que lleva</label>
            <select
              value={item.testimonio_id || ''}
              onChange={(e) => { const v = e.target.value || null; patch(item.id, 'testimonio_id', v); persist(item.id, 'testimonio_id', v) }}
              className={cls}
            >
              <option value="">— sin testimonio —</option>
              {testimonios.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.sector ? ` — ${t.sector}` : ''}</option>
              ))}
            </select>

            {testimonio && (
              <div className="mt-2 rounded-lg border border-brand-500/25 bg-brand-600/5 p-3">
                <div className="flex gap-3">
                  {testimonio.photoUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={testimonio.photoUrl} alt={testimonio.name} className="w-28 h-20 object-cover rounded border border-border shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground">
                      {testimonio.name}
                      {!testimonio.hasRevenue && <span className="ml-1.5 text-[10px] font-normal text-amber-400">sin cifras</span>}
                      {testimonio.kind === 'cliente' && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">cliente, no alumno</span>}
                    </p>
                    {testimonio.cifra && testimonio.hasRevenue && <p className="text-[11px] text-brand-300 mt-0.5">{testimonio.cifra}</p>}
                    {testimonio.hook && <p className="text-[11px] text-muted-foreground mt-0.5">{testimonio.hook}</p>}
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground space-y-1 mt-2 leading-relaxed">
                  {testimonio.puntoA && <p><span className="text-foreground/70 font-medium">Antes:</span> {testimonio.puntoA}</p>}
                  {testimonio.puntoB && <p><span className="text-foreground/70 font-medium">Ahora:</span> {testimonio.puntoB}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-2.5">
                  <Link href={`/evergreen/testimonios/${testimonio.id}`} className="text-[11px] text-brand-300 hover:underline">Ver ficha completa</Link>
                  {testimonio.youtubeUrl && (
                    <a href={testimonio.youtubeUrl} target="_blank" rel="noreferrer" className="text-[11px] text-sky-400 hover:underline flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> Vídeo original
                    </a>
                  )}
                  <button
                    onClick={() => { navigator.clipboard.writeText(testimonioPitch(testimonio)); toast.success('Testimonio copiado') }}
                    className="text-[11px] text-muted-foreground hover:text-foreground ml-auto"
                  >
                    Copiar historia
                  </button>
                </div>
                {!testimonio.youtubeUrl && (
                  <p className="text-[10px] text-amber-400/90 mt-2">
                    Este testimonio todavía no tiene el vídeo cargado: añádelo desde su ficha.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const cls = 'w-full bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-500'
