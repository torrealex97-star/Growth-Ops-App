"use client"

import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Video, Search, ExternalLink, FileText, Star, EyeOff, Eye, Drama, Plus, Trash2, X, Loader2 } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { isLeadership, type AppRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/client'
import type { Roleplay } from '@/lib/types/database'
import { toast } from 'sonner'
import { useTenant, useTenantId } from '@/lib/tenant-context'

type Call = {
  id: string
  appointment_datetime: string
  recording_url: string | null
  transcript_drive_url: string | null
  ai_summary: string | null
  ai_call_score: number | null
  status: string
  library_shared: boolean
  contacts: { full_name: string | null } | null
  closer: { id: string; full_name: string | null } | null
}

const STATUS_LABELS: Record<string, string> = {
  show: 'Se presentó', completed: 'Completada', confirmed: 'Confirmada',
  scheduled: 'Programada', no_show: 'No show', rescheduled: 'Reagendada',
  cancelled: 'Cancelada', cancelled_admin: 'Cancelada', cancelled_lead: 'Cancelada',
}

type TeamUser = { id: string; full_name: string }

export default function BibliotecaPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [role, setRole] = useState<AppRole | ''>('')
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(true)
  const [closerFilter, setCloserFilter] = useState('all')
  const [minScore, setMinScore] = useState('all')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'calls' | 'roleplays'>('calls')

  // Roleplays de entrenamiento
  const [roleplays, setRoleplays] = useState<Roleplay[]>([])
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([])
  const [showNewRp, setShowNewRp] = useState(false)
  const [savingRp, setSavingRp] = useState(false)
  const [rp, setRp] = useState({ title: '', participant_id: '', participant_name: '', recording_url: '', transcript_url: '', score: '', notes: '' })

  const leadership = isLeadership(role as AppRole)

  const load = async () => {
    // Vía endpoint server-side (service role): la RLS acota a cada rep sus propias agendas, pero la
    // biblioteca muestra las llamadas COMPARTIDAS de todo el equipo para entrenamiento cruzado.
    try {
      const res = await fetch(`/api/${tenant}/evergreen/biblioteca`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Error')
      setRole((data.leadership ? 'admin' : 'closer') as AppRole)
      setCalls((data.calls as Call[]) ?? [])
    } catch {
      setCalls([])
    }
    setLoading(false)
    // Migración idempotente de library_shared (solo surte efecto para admin/director).
    fetch(`/api/${tenant}/evergreen/admin/migrate-page-overrides`, { method: 'POST' }).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const loadRoleplays = async () => {
    const sb = createClient()
    const [{ data: rps }, { data: us }] = await Promise.all([
      sb.from('roleplays').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      sb.from('users').select('id, full_name').eq('is_active', true).order('full_name'),
    ])
    setRoleplays((rps as Roleplay[]) ?? [])
    setTeamUsers((us as TeamUser[]) ?? [])
  }
  useEffect(() => { loadRoleplays() }, [tenantId])

  const saveRoleplay = async () => {
    if (!rp.title.trim()) { toast.error('Ponle un título al roleplay'); return }
    setSavingRp(true)
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    const { error } = await sb.from('roleplays').insert({
      title: rp.title.trim(),
      participant_id: rp.participant_id || null,
      participant_name: rp.participant_name.trim() || null,
      recording_url: rp.recording_url.trim() || null,
      transcript_url: rp.transcript_url.trim() || null,
      score: rp.score ? Number(rp.score) : null,
      notes: rp.notes.trim() || null,
      shared: true,
      created_by: user?.id ?? null,
      tenant_id: tenantId,
    })
    setSavingRp(false)
    if (error) { toast.error('No se pudo guardar', { description: error.message }); return }
    toast.success('Roleplay añadido')
    setShowNewRp(false)
    setRp({ title: '', participant_id: '', participant_name: '', recording_url: '', transcript_url: '', score: '', notes: '' })
    loadRoleplays()
  }

  const removeRoleplay = async (id: string) => {
    if (!confirm('¿Eliminar este roleplay?')) return
    const sb = createClient()
    const { error } = await sb.from('roleplays').delete().eq('id', id).eq('tenant_id', tenantId)
    if (error) { toast.error('No se pudo eliminar', { description: error.message }); return }
    setRoleplays((prev) => prev.filter((r) => r.id !== id))
    toast.success('Roleplay eliminado')
  }

  const participantLabel = (r: Roleplay) =>
    r.participant_name || teamUsers.find((u) => u.id === r.participant_id)?.full_name || '—'

  const closers = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of calls) if (c.closer?.id) map.set(c.closer.id, c.closer.full_name || '—')
    return Array.from(map, ([id, name]) => ({ id, name }))
  }, [calls])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const min = minScore === 'all' ? 0 : Number(minScore)
    return calls.filter((c) => {
      if (closerFilter !== 'all' && c.closer?.id !== closerFilter) return false
      if (min > 0 && (c.ai_call_score ?? 0) < min) return false
      if (term) {
        const hay = `${c.contacts?.full_name ?? ''} ${c.closer?.full_name ?? ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [calls, closerFilter, minScore, search])

  const toggleShared = async (c: Call) => {
    const res = await fetch(`/api/${tenant}/evergreen/appointments/update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointmentId: c.id, patch: { library_shared: !c.library_shared } }),
    })
    if (!res.ok) { toast.error('No se pudo actualizar'); return }
    setCalls((prev) => prev.map((x) => x.id === c.id ? { ...x, library_shared: !x.library_shared } : x))
    toast.success(c.library_shared ? 'Llamada oculta del equipo' : 'Llamada compartida con el equipo')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Video className="w-6 h-6 text-brand-400" /> Biblioteca de llamadas
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Graba tu progreso y aprende de las llamadas del equipo. Filtra por closer o por nota para encontrar las mejores.</p>
      </div>

      {/* Tabs: Llamadas / Roleplays */}
      <div className="flex items-center gap-1 border-b border-border">
        <button onClick={() => setTab('calls')} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${tab === 'calls' ? 'border-brand-500 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <Video className="w-4 h-4" /> Llamadas
        </button>
        <button onClick={() => setTab('roleplays')} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${tab === 'roleplays' ? 'border-brand-500 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <Drama className="w-4 h-4" /> Roleplays <span className="text-xs text-muted-foreground">{roleplays.length}</span>
        </button>
      </div>

      {tab === 'calls' && (<>
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por cliente o closer…" className="pl-9 bg-card border-border" />
        </div>
        <Select value={closerFilter} onValueChange={setCloserFilter}>
          <SelectTrigger className="w-44 bg-card border-border"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Todos los closers</SelectItem>
            {closers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={minScore} onValueChange={setMinScore}>
          <SelectTrigger className="w-40 bg-card border-border"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Cualquier nota</SelectItem>
            <SelectItem value="7">Nota ≥ 7</SelectItem>
            <SelectItem value="8">Nota ≥ 8</SelectItem>
            <SelectItem value="9">Nota ≥ 9</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="h-48 bg-card rounded-lg animate-pulse" />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Video className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">Sin llamadas</h3>
          <p className="text-muted-foreground text-sm">Las llamadas con enlace de grabación aparecerán aquí.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <div key={c.id} className={`lift rounded-lg border p-4 flex flex-col gap-3 ${c.library_shared ? 'border-border bg-card/50 hover:border-brand-500/40' : 'border-amber-700/40 bg-card/30'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-foreground font-medium truncate">{c.contacts?.full_name || 'Contacto'}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(c.appointment_datetime)}</p>
                </div>
                {c.ai_call_score != null && (
                  <Badge className="bg-brand-500/20 text-brand-300 border-brand-500/30 border flex items-center gap-1 shrink-0">
                    <Star className="w-3 h-3" /> {c.ai_call_score}/10
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-muted-foreground">Closer: <span className="text-foreground">{c.closer?.full_name || '—'}</span></span>
                <Badge className="bg-muted text-foreground border-border border text-[10px]">{STATUS_LABELS[c.status] ?? c.status}</Badge>
                {!c.library_shared && <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 border text-[10px]">Oculta</Badge>}
              </div>
              {c.ai_summary && <p className="text-xs text-muted-foreground line-clamp-3">{c.ai_summary}</p>}
              <div className="flex items-center gap-2 mt-auto pt-1">
                {c.recording_url && (
                  <Button asChild size="sm" className="bg-brand-600 hover:bg-brand-500 h-8">
                    <a href={c.recording_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1" /> Ver llamada</a>
                  </Button>
                )}
                {c.transcript_drive_url && (
                  <Button asChild size="sm" variant="outline" className="border-border text-foreground h-8">
                    <a href={c.transcript_drive_url} target="_blank" rel="noopener noreferrer"><FileText className="w-3.5 h-3.5 mr-1" /> Transcripción</a>
                  </Button>
                )}
                {leadership && (
                  <Button size="sm" variant="ghost" className="ml-auto h-8 text-muted-foreground hover:text-foreground" onClick={() => toggleShared(c)} title={c.library_shared ? 'Ocultar del equipo' : 'Compartir con el equipo'}>
                    {c.library_shared ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </>)}

      {tab === 'roleplays' && (<>
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">Guarda aquí los roleplays de entrenamiento del equipo (grabación + transcripción + nota).</p>
          {leadership && (
            <Button size="sm" className="bg-brand-600 hover:bg-brand-500" onClick={() => setShowNewRp(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Añadir roleplay
            </Button>
          )}
        </div>

        {roleplays.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Drama className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Sin roleplays</h3>
            <p className="text-muted-foreground text-sm">Los roleplays de entrenamiento aparecerán aquí.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roleplays.map((r) => (
              <div key={r.id} className="lift rounded-lg border border-border bg-card/50 p-4 flex flex-col gap-3 hover:border-brand-500/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-foreground font-medium truncate">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{participantLabel(r)} · {formatDateTime(r.created_at)}</p>
                  </div>
                  {r.score != null && (
                    <Badge className="bg-brand-500/20 text-brand-300 border-brand-500/30 border flex items-center gap-1 shrink-0">
                      <Star className="w-3 h-3" /> {r.score}/10
                    </Badge>
                  )}
                </div>
                {r.notes && <p className="text-xs text-muted-foreground line-clamp-3">{r.notes}</p>}
                <div className="flex items-center gap-2 mt-auto pt-1 flex-wrap">
                  {r.recording_url && (
                    <Button asChild size="sm" className="bg-brand-600 hover:bg-brand-500 h-8">
                      <a href={r.recording_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1" /> Ver roleplay</a>
                    </Button>
                  )}
                  {r.transcript_url && (
                    <Button asChild size="sm" variant="outline" className="border-border text-foreground h-8">
                      <a href={r.transcript_url} target="_blank" rel="noopener noreferrer"><FileText className="w-3.5 h-3.5 mr-1" /> Transcripción</a>
                    </Button>
                  )}
                  {leadership && (
                    <Button size="sm" variant="ghost" className="ml-auto h-8 text-muted-foreground hover:text-red-400" onClick={() => removeRoleplay(r.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {showNewRp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !savingRp && setShowNewRp(false)}>
            <div className="bg-card border border-border rounded-xl p-5 w-full max-w-lg space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-foreground font-semibold flex items-center gap-2"><Drama className="w-4 h-4 text-brand-400" /> Nuevo roleplay</h3>
                <button onClick={() => setShowNewRp(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Título</label>
                <Input value={rp.title} onChange={(e) => setRp({ ...rp, title: e.target.value })} className="bg-muted border-border" placeholder="Roleplay objeciones — Jaime" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Participante</label>
                  <Select value={rp.participant_id || '__none'} onValueChange={(v) => setRp({ ...rp, participant_id: v === '__none' ? '' : v })}>
                    <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Del equipo…" /></SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="__none">— libre —</SelectItem>
                      {teamUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Nota (0-10)</label>
                  <Input type="number" min="0" max="10" step="0.5" value={rp.score} onChange={(e) => setRp({ ...rp, score: e.target.value })} className="bg-muted border-border" />
                </div>
              </div>
              {!rp.participant_id && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Nombre del participante (si no es del equipo)</label>
                  <Input value={rp.participant_name} onChange={(e) => setRp({ ...rp, participant_name: e.target.value })} className="bg-muted border-border" />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Enlace de la grabación</label>
                <Input value={rp.recording_url} onChange={(e) => setRp({ ...rp, recording_url: e.target.value })} className="bg-muted border-border" placeholder="https://…" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Enlace de la transcripción (opcional)</label>
                <Input value={rp.transcript_url} onChange={(e) => setRp({ ...rp, transcript_url: e.target.value })} className="bg-muted border-border" placeholder="https://…" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Notas</label>
                <textarea value={rp.notes} onChange={(e) => setRp({ ...rp, notes: e.target.value })} rows={3} className="w-full bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground" placeholder="Qué se practicó, feedback…" />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setShowNewRp(false)} className="px-3 py-2 text-sm text-muted-foreground">Cancelar</button>
                <button onClick={saveRoleplay} disabled={savingRp} className="flex items-center gap-2 px-3 py-2 text-sm bg-brand-600 text-white rounded-lg disabled:opacity-50">
                  {savingRp ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando…</> : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>)}
    </div>
  )
}
