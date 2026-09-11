'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ListChecks, Plus, Sparkles, X, Loader2, Trash2, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import { SearchBox, normalizeText } from '@/components/ui/search-box'

const STAGES = [
  { value: 'backlog', label: 'Sin empezar' },
  { value: 'en_curso', label: 'En curso' },
  { value: 'en_revision', label: 'En revisión' },
  { value: 'hecho', label: 'Completadas' },
] as const
type Stage = typeof STAGES[number]['value']

type Priority = 'baja' | 'media' | 'alta' | 'urgente'
const PRIORITIES: { value: Priority; label: string; badge: string; select: string }[] = [
  { value: 'baja', label: 'Baja', badge: 'bg-zinc-500/20 text-foreground border-border/30', select: 'border-border' },
  { value: 'media', label: 'Media', badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30', select: 'border-blue-700/50' },
  { value: 'alta', label: 'Alta', badge: 'bg-amber-500/20 text-amber-400 border-amber-500/30', select: 'border-amber-700/50' },
  { value: 'urgente', label: 'Urgente', badge: 'bg-red-500/20 text-red-400 border-red-500/30', select: 'border-red-700/50' },
]

type Task = {
  id: string; title: string; description: string | null; assignee_id: string | null
  status: string; stage: string | null; notes: string | null; due_date: string | null
  source: string; is_proposal: boolean | null; priority: Priority | null
  created_by: string | null; created_at: string
  assignee?: { full_name: string } | null
}
type DbUser = { id: string; full_name: string }

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [users, setUsers] = useState<DbUser[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [canDelete, setCanDelete] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [scope, setScope] = useState<'mias' | 'todas'>('todas')
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null)

  // Generación de tareas por IA desde una transcripción (con confirmación previa)
  const [showAI, setShowAI] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSummary, setAiSummary] = useState('')
  const [aiCreating, setAiCreating] = useState(false)
  const [proposals, setProposals] = useState<{
    selected: boolean; title: string; description: string; assignee_id: string; stage: Stage; priority: Priority
  }[]>([])

  const [nt, setNt] = useState({
    title: '', description: '', assignee_id: '', stage: 'backlog' as Stage,
    priority: 'media' as Priority, due_date: '',
  })

  const load = async () => {
    const supabase = createClient()
    const [tRes, uRes, authRes] = await Promise.all([
      supabase.from('tasks').select('*, assignee:assignee_id(full_name)').order('created_at', { ascending: false }),
      supabase.from('users').select('id, full_name').eq('is_active', true).order('full_name'),
      supabase.auth.getUser(),
    ])
    setTasks((tRes.data as Task[]) || [])
    setUsers((uRes.data as DbUser[]) || [])

    if (authRes.data.user) {
      setCurrentUserId(authRes.data.user.id)
      const { data: userData } = await supabase
        .from('users')
        .select('roles(key)')
        .eq('id', authRes.data.user.id)
        .single()
      const roleKey = (userData as { roles?: { key?: string } } | null)?.roles?.key
      const admin = roleKey === 'admin' || roleKey === 'director' || roleKey === 'manager'
      setCanDelete(roleKey === 'admin' || roleKey === 'director')
      setIsAdmin(admin)
      // El equipo ve por defecto SUS tareas; el liderazgo ve todas.
      setScope(admin ? 'todas' : 'mias')
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const patch = async (id: string, p: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)))
    const supabase = createClient()
    const { error } = await supabase.from('tasks').update(p).eq('id', id)
    if (error) { toast.error('No se pudo actualizar'); load() }
  }

  const removeTask = async (id: string) => {
    if (!confirm('¿Borrar esta tarea? Esta acción no se puede deshacer.')) return
    const prev = tasks
    setTasks((cur) => cur.filter((t) => t.id !== id))
    const supabase = createClient()
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) { toast.error('No se pudo borrar', { description: error.message }); setTasks(prev) }
    else toast.success('Tarea borrada')
  }

  const createTask = async () => {
    if (!nt.title.trim()) { toast.error('Pon un título'); return }
    // Vía endpoint server-side: inserta + avisa por email al responsable.
    const res = await fetch('/api/evergreen/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: nt.title.trim(), description: nt.description || null,
        assignee_id: nt.assignee_id || null, stage: nt.stage,
        priority: nt.priority, due_date: nt.due_date || null, source: 'manual',
      }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error('Error al crear', { description: d?.error }); return }
    toast.success(d.emailed ? 'Tarea creada · aviso enviado por email' : 'Tarea creada')
    setShowNew(false)
    setNt({ title: '', description: '', assignee_id: '', stage: 'backlog', priority: 'media', due_date: '' })
    load()
  }

  // ── IA: genera tareas propuestas desde una transcripción (no las crea aún) ──
  const generateFromTranscript = async () => {
    if (transcript.trim().length < 20) { toast.error('Pega una transcripción más larga'); return }
    setAiLoading(true)
    const res = await fetch('/api/evergreen/tasks/from-transcript', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    })
    const d = await res.json().catch(() => ({}))
    setAiLoading(false)
    if (!res.ok) { toast.error('No se pudieron generar tareas', { description: d?.error }); return }
    setAiSummary(d.summary || '')
    setProposals((d.proposals || []).map((p: { title: string; description: string; assignee_id: string | null; stage: string | null }) => ({
      selected: true,
      title: p.title,
      description: p.description || '',
      assignee_id: p.assignee_id || '',
      stage: (STAGES.find((s) => s.value === p.stage)?.value || 'backlog') as Stage,
      priority: 'media' as Priority,
    })))
    if (!(d.proposals || []).length) toast.info('La IA no encontró tareas en la transcripción')
  }

  const confirmProposals = async () => {
    const chosen = proposals.filter((p) => p.selected && p.title.trim())
    if (!chosen.length) { toast.error('Selecciona al menos una tarea'); return }
    setAiCreating(true)
    const res = await fetch('/api/evergreen/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks: chosen.map((p) => ({
          title: p.title.trim(), description: p.description || null,
          assignee_id: p.assignee_id || null, stage: p.stage, priority: p.priority, source: 'ai',
        })),
      }),
    })
    const d = await res.json().catch(() => ({}))
    setAiCreating(false)
    if (!res.ok) { toast.error('Error al crear tareas', { description: d?.error }); return }
    toast.success(`${d.created} tarea(s) creadas${d.emailed ? ` · ${d.emailed} aviso(s) por email` : ''}`)
    setShowAI(false); setTranscript(''); setProposals([]); setAiSummary('')
    load()
  }

  const grouped = useMemo(() => {
    const map: Record<Stage, Task[]> = { backlog: [], en_curso: [], en_revision: [], hecho: [] }
    const nq = normalizeText(q.trim())
    // Alcance: el equipo ve SUS tareas (asignadas o creadas por él); el admin puede ver todas.
    const scoped = scope === 'mias' && currentUserId
      ? tasks.filter((t) => t.assignee_id === currentUserId || t.created_by === currentUserId)
      : tasks
    const list = nq
      ? scoped.filter((t) =>
          normalizeText(t.title || '').includes(nq) ||
          normalizeText(t.description || '').includes(nq) ||
          normalizeText(t.assignee?.full_name || '').includes(nq))
      : scoped
    for (const t of list) {
      const s = (STAGES.find((st) => st.value === t.stage)?.value || 'backlog') as Stage
      map[s].push(t)
    }
    return map
  }, [tasks, q, scope, currentUserId])

  const onDrop = (stage: Stage) => {
    setDragOverStage(null)
    if (!dragTaskId) return
    const task = tasks.find((t) => t.id === dragTaskId)
    setDragTaskId(null)
    if (!task || task.stage === stage) return
    patch(task.id, { stage })
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2"><ListChecks className="w-6 h-6 text-white" /> Tareas</h1>
          <p className="text-muted-foreground text-sm mt-1">El trabajo del equipo, columna por columna.</p>
        </div>
        <div className="flex items-center gap-3">
          <SearchBox value={q} onChange={setQ} placeholder="Buscar tarea o responsable..." className="w-64" />
          {isAdmin && (
            <div className="flex rounded-lg border border-border overflow-hidden text-sm">
              <button onClick={() => setScope('todas')} className={`px-3 py-2 ${scope === 'todas' ? 'bg-white text-black' : 'bg-card text-muted-foreground hover:text-foreground'}`}>Todas</button>
              <button onClick={() => setScope('mias')} className={`px-3 py-2 ${scope === 'mias' ? 'bg-white text-black' : 'bg-card text-muted-foreground hover:text-foreground'}`}>Mías</button>
            </div>
          )}
          {isAdmin && (
            <button onClick={() => setShowAI(true)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-cyan-600/20 text-cyan-300 border border-cyan-600/40 hover:bg-cyan-600/30 whitespace-nowrap">
              <Sparkles className="w-4 h-4" /> Generar con IA
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-3 py-2 rounded-[10px] text-sm bg-white text-black hover:bg-zinc-200 whitespace-nowrap">
              <Plus className="w-4 h-4" /> Nueva tarea
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="h-64 bg-card rounded-lg animate-pulse" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {STAGES.map((col) => {
            const cards = grouped[col.value]
            const isOver = dragOverStage === col.value
            return (
              <div
                key={col.value}
                onDragOver={(e) => { e.preventDefault(); setDragOverStage(col.value) }}
                onDragLeave={() => setDragOverStage((cur) => (cur === col.value ? null : cur))}
                onDrop={(e) => { e.preventDefault(); onDrop(col.value) }}
                className={`bg-card/50 border rounded-lg p-3 transition-colors ${isOver ? 'border-brand-500 bg-brand-500/5' : 'border-border'}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground">{col.label}</h3>
                  <span className="text-xs text-muted-foreground">{cards.length}</span>
                </div>
                <div className="space-y-2 min-h-[40px]">
                  {cards.map((t) => {
                    const prio = PRIORITIES.find((p) => p.value === (t.priority || 'media'))!
                    return (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={() => setDragTaskId(t.id)}
                        onDragEnd={() => setDragTaskId(null)}
                        className={`lift bg-card border border-border rounded-lg p-3 space-y-2 cursor-grab active:cursor-grabbing hover:border-brand-500/40 ${dragTaskId === t.id ? 'opacity-40' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-foreground leading-snug">{t.title}</p>
                          {canDelete && (
                            <button onClick={() => removeTask(t.id)} className="text-muted-foreground hover:text-red-400 shrink-0" title="Borrar tarea">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        {t.description && <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>}

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${prio.badge}`}>{prio.label}</span>
                          {t.source === 'ai' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">IA</span>}
                        </div>

                        {t.assignee?.full_name && <p className="text-xs text-muted-foreground">✎ {t.assignee.full_name}</p>}
                        {t.due_date && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> {t.due_date}</p>
                        )}

                        <select
                          value={t.priority || 'media'}
                          onChange={(e) => patch(t.id, { priority: e.target.value as Priority })}
                          className={`w-full text-xs rounded border bg-muted text-foreground px-2 py-1 ${prio.select}`}
                        >
                          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                      </div>
                    )
                  })}
                  {cards.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Suelta aquí una tarea</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowNew(false)}>
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">Nueva tarea</h3>
              <button onClick={() => setShowNew(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <Field label="Título"><input value={nt.title} onChange={(e) => setNt({ ...nt, title: e.target.value })} className={inputCls} /></Field>
            <Field label="Descripción"><textarea value={nt.description} onChange={(e) => setNt({ ...nt, description: e.target.value })} rows={3} className={inputCls} /></Field>
            <Field label="Asignar a">
              <select value={nt.assignee_id} onChange={(e) => setNt({ ...nt, assignee_id: e.target.value })} className={inputCls}>
                <option value="">— sin asignar —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Etapa">
                <select value={nt.stage} onChange={(e) => setNt({ ...nt, stage: e.target.value as Stage })} className={inputCls}>
                  {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Prioridad">
                <select value={nt.priority} onChange={(e) => setNt({ ...nt, priority: e.target.value as Priority })} className={inputCls}>
                  {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Vence"><input type="date" value={nt.due_date} onChange={(e) => setNt({ ...nt, due_date: e.target.value })} className={inputCls} /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowNew(false)} className="px-3 py-2 text-sm text-muted-foreground">Cancelar</button>
              <button onClick={createTask} className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg">Crear</button>
            </div>
          </div>
        </div>
      )}

      {showAI && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !aiCreating && setShowAI(false)}>
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4 text-cyan-400" /> Generar tareas desde transcripción</h3>
              <button onClick={() => setShowAI(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>

            {proposals.length === 0 ? (
              <>
                <Field label="Pega la transcripción de la reunión (Fathom, Meet…)">
                  <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={10} className={inputCls} placeholder="Pega aquí la transcripción completa…" />
                </Field>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowAI(false)} className="px-3 py-2 text-sm text-muted-foreground">Cancelar</button>
                  <button onClick={generateFromTranscript} disabled={aiLoading} className="flex items-center gap-2 px-3 py-2 text-sm bg-cyan-600 text-foreground rounded-lg disabled:opacity-50">
                    {aiLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Analizando…</> : <><Sparkles className="w-4 h-4" /> Generar propuestas</>}
                  </button>
                </div>
              </>
            ) : (
              <>
                {aiSummary && <p className="text-xs text-muted-foreground bg-muted/60 rounded-lg p-3">{aiSummary}</p>}
                <p className="text-xs text-muted-foreground">Revisa, edita y selecciona las tareas antes de crearlas. Solo se crearán las marcadas.</p>
                <div className="space-y-2">
                  {proposals.map((p, i) => (
                    <div key={i} className={`rounded-lg border p-3 space-y-2 ${p.selected ? 'border-cyan-600/40 bg-cyan-600/5' : 'border-border bg-card/50 opacity-60'}`}>
                      <div className="flex items-start gap-2">
                        <input type="checkbox" checked={p.selected} onChange={(e) => setProposals((prev) => prev.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))} className="mt-1 h-4 w-4 rounded border-border bg-card accent-cyan-500" />
                        <input value={p.title} onChange={(e) => setProposals((prev) => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} className="flex-1 bg-transparent text-sm text-foreground font-medium focus:outline-none border-b border-transparent focus:border-border" />
                      </div>
                      <textarea value={p.description} onChange={(e) => setProposals((prev) => prev.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} rows={2} className="w-full bg-muted border border-border rounded p-2 text-xs text-foreground" placeholder="Descripción…" />
                      <div className="grid grid-cols-3 gap-2">
                        <select value={p.assignee_id} onChange={(e) => setProposals((prev) => prev.map((x, j) => j === i ? { ...x, assignee_id: e.target.value } : x))} className="text-xs rounded border border-border bg-muted text-foreground px-2 py-1.5">
                          <option value="">— sin asignar —</option>
                          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                        </select>
                        <select value={p.stage} onChange={(e) => setProposals((prev) => prev.map((x, j) => j === i ? { ...x, stage: e.target.value as Stage } : x))} className="text-xs rounded border border-border bg-muted text-foreground px-2 py-1.5">
                          {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                        <select value={p.priority} onChange={(e) => setProposals((prev) => prev.map((x, j) => j === i ? { ...x, priority: e.target.value as Priority } : x))} className="text-xs rounded border border-border bg-muted text-foreground px-2 py-1.5">
                          {PRIORITIES.map((pr) => <option key={pr.value} value={pr.value}>{pr.label}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center gap-2 pt-1">
                  <button onClick={() => { setProposals([]); setAiSummary('') }} className="px-3 py-2 text-sm text-muted-foreground">← Otra transcripción</button>
                  <button onClick={confirmProposals} disabled={aiCreating} className="flex items-center gap-2 px-3 py-2 text-sm bg-brand-600 text-white rounded-lg disabled:opacity-50">
                    {aiCreating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creando…</> : <>Crear {proposals.filter((p) => p.selected).length} tarea(s)</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const inputCls = 'w-full bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>
}
