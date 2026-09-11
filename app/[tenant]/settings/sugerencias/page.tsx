'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Lightbulb,
  Bug,
  MessageSquare,
  Loader2,
  Trash2,
  Inbox,
  Trophy,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn, formatDateTime } from '@/lib/utils'
import { SearchBox, normalizeText } from '@/components/ui/search-box'
import { toast } from 'sonner'
import type { SuggestionWithUser, SuggestionStatus, SuggestionType, SuggestionTeamStat } from '@/lib/types/database'
import { useTenant } from '@/lib/tenant-context'

const TYPE_META: Record<SuggestionType, { label: string; icon: React.ElementType; color: string }> = {
  mejora: { label: 'Mejora', icon: Lightbulb, color: 'bg-brand-500/15 text-brand-300 border-brand-500/30' },
  error: { label: 'Error', icon: Bug, color: 'bg-red-500/15 text-red-300 border-red-500/30' },
  comentario: { label: 'Comentario', icon: MessageSquare, color: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
}

const STATUS_META: Record<SuggestionStatus, { label: string; color: string }> = {
  nueva: { label: 'Nueva', color: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  en_revision: { label: 'En revisión', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  planificada: { label: 'Planificada', color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  en_progreso: { label: 'En progreso', color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  resuelta: { label: 'Resuelta', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  descartada: { label: 'Descartada', color: 'bg-zinc-500/15 text-muted-foreground border-border/30' },
}

const STATUS_ORDER: SuggestionStatus[] = [
  'nueva',
  'en_revision',
  'planificada',
  'en_progreso',
  'resuelta',
  'descartada',
]

export default function SugerenciasPage() {
  const tenant = useTenant()
  const [items, setItems] = useState<SuggestionWithUser[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<'all' | SuggestionStatus>('all')
  const [filterType, setFilterType] = useState<'all' | SuggestionType>('all')
  const [search, setSearch] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({})
  const [showTeam, setShowTeam] = useState(true)
  const [teamStats, setTeamStats] = useState<SuggestionTeamStat[]>([])

  const load = async () => {
    try {
      const res = await fetch(`/api/${tenant}/evergreen/suggestions`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const list = (data.suggestions ?? []) as SuggestionWithUser[]
      setItems(list)
      setNotesDraft(Object.fromEntries(list.map((s) => [s.id, s.admin_notes ?? ''])))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }

  // Ranking Kaizen: agregados de TODO el equipo, no solo lo que ve este usuario
  // en `items` (un rep normal solo recibe sus propias sugerencias de /suggestions).
  const loadTeamStats = async () => {
    try {
      const res = await fetch(`/api/${tenant}/evergreen/suggestions/team-stats`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setTeamStats((data.stats ?? []) as SuggestionTeamStat[])
    } catch (err) {
      console.error('[sugerencias] Error al cargar ranking Kaizen:', err)
    }
  }

  useEffect(() => {
    load()
    loadTeamStats()
  }, [])

  const patch = async (id: string, body: Record<string, unknown>) => {
    setSavingId(id)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/suggestions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...data.suggestion } : s)))
      toast.success('Actualizado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSavingId(null)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar esta sugerencia? No se puede deshacer.')) return
    setSavingId(id)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/suggestions/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setItems((prev) => prev.filter((s) => s.id !== id))
      toast.success('Eliminada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setSavingId(null)
    }
  }

  const filtered = useMemo(() => {
    const q = normalizeText(search.trim())
    return items.filter(
      (s) =>
        (filterStatus === 'all' || s.status === filterStatus) &&
        (filterType === 'all' || s.type === filterType) &&
        (q === '' ||
          normalizeText(
            `${s.title} ${s.message} ${s.users?.full_name ?? ''} ${s.users?.email ?? ''} ${s.page_url ?? ''}`
          ).includes(q))
    )
  }, [items, filterStatus, filterType, search])

  const counts = useMemo(() => {
    const c: Record<string, number> = { nueva: 0, en_revision: 0 }
    for (const s of items) c[s.status] = (c[s.status] ?? 0) + 1
    return c
  }, [items])

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-brand-400" /> Sugerencias y mejoras
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Peticiones de mejora, errores y comentarios enviados por el equipo. Gestiona el estado para ir mejorando la
          plataforma.{' '}
          <span className="text-foreground">
            {counts.nueva ?? 0} nueva{counts.nueva === 1 ? '' : 's'}
          </span>
          .
        </p>
      </div>

      {teamStats.length > 0 && (
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <button
            type="button"
            onClick={() => setShowTeam((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Trophy className="w-4 h-4 text-amber-400" /> Kaizen — mejora continua del equipo
            </span>
            {showTeam ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
          {showTeam && (
            <>
              <p className="text-xs text-muted-foreground mt-1">
                Quién más propone y a quién más ideas se le han implementado. Reconocimiento, no gamificación.
              </p>
              <div className="mt-3 space-y-2">
                {teamStats.map((t, i) => (
                  <div
                    key={t.user_id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5"
                  >
                    <div className="w-6 text-center text-sm font-semibold text-muted-foreground shrink-0">
                      {i === 0 && t.resolved_total > 0
                        ? '🏆'
                        : i === 1 && t.resolved_total > 0
                          ? '🥈'
                          : i === 2 && t.resolved_total > 0
                            ? '🥉'
                            : `#${i + 1}`}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {t.full_name || t.email || 'Sin nombre'}
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        <Badge className="border text-[11px] bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                          {t.resolved_total} implementada{t.resolved_total === 1 ? '' : 's'}
                        </Badge>
                        {t.by_status.en_progreso > 0 && (
                          <Badge className="border text-[11px] bg-cyan-500/15 text-cyan-300 border-cyan-500/30">
                            {t.by_status.en_progreso} en progreso
                          </Badge>
                        )}
                        {t.by_status.descartada > 0 && (
                          <Badge className="border text-[11px] bg-zinc-500/15 text-muted-foreground border-border/30">
                            {t.by_status.descartada} descartada{t.by_status.descartada === 1 ? '' : 's'}
                          </Badge>
                        )}
                        {t.resolved_this_month > 0 && (
                          <span className="text-[11px] text-amber-300 flex items-center gap-0.5">
                            <Sparkles className="w-3 h-3" /> {t.resolved_this_month} este mes
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-foreground">{t.total}</p>
                      <p className="text-[11px] text-muted-foreground">tiradas</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Buscar por título, texto, persona…"
          className="w-full sm:w-80"
        />
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as typeof filterStatus)}>
          <SelectTrigger className="w-44 bg-background border-border text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border text-foreground">
            <SelectItem value="all">Todos los estados</SelectItem>
            {STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={(v) => setFilterType(v as typeof filterType)}>
          <SelectTrigger className="w-40 bg-background border-border text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border text-foreground">
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="mejora">Mejora</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="comentario">Comentario</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <Inbox className="w-8 h-8" />
          <p className="text-sm">
            No hay sugerencias {filterStatus !== 'all' || filterType !== 'all' ? 'con estos filtros' : 'todavía'}.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => {
            const TypeIcon = TYPE_META[s.type].icon
            return (
              <div key={s.id} className="rounded-xl border border-border bg-card/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={cn('border gap-1 text-xs', TYPE_META[s.type].color)}>
                        <TypeIcon className="w-3 h-3" /> {TYPE_META[s.type].label}
                      </Badge>
                      <Badge className={cn('border text-xs', STATUS_META[s.status].color)}>
                        {STATUS_META[s.status].label}
                      </Badge>
                    </div>
                    <h3 className="text-foreground font-medium mt-2">{s.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{s.message}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {s.users?.full_name || s.users?.email || 'Anónimo'} · {formatDateTime(s.created_at)}
                      {s.page_url ? (
                        <>
                          {' '}
                          · <span className="text-muted-foreground">{s.page_url}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Select
                      value={s.status}
                      onValueChange={(v) => patch(s.id, { status: v })}
                      disabled={savingId === s.id}
                    >
                      <SelectTrigger className="w-36 h-8 bg-background border-border text-foreground text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border text-foreground">
                        {STATUS_ORDER.map((st) => (
                          <SelectItem key={st} value={st}>
                            {STATUS_META[st].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-red-400"
                      onClick={() => remove(s.id)}
                      disabled={savingId === s.id}
                      title="Eliminar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="mt-3 border-t border-border pt-3">
                  <Textarea
                    value={notesDraft[s.id] ?? ''}
                    onChange={(e) => setNotesDraft((d) => ({ ...d, [s.id]: e.target.value }))}
                    placeholder="Notas internas del admin…"
                    rows={2}
                    className="bg-background border-border text-foreground text-sm resize-none"
                  />
                  {(notesDraft[s.id] ?? '') !== (s.admin_notes ?? '') && (
                    <div className="flex justify-end mt-2">
                      <Button
                        size="sm"
                        className="bg-brand-600 hover:bg-brand-500 text-white h-7 text-xs"
                        onClick={() => patch(s.id, { admin_notes: notesDraft[s.id] ?? '' })}
                        disabled={savingId === s.id}
                      >
                        {savingId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Guardar nota'}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
