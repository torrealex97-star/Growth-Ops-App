'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Lightbulb, Bug, MessageSquare, Loader2, Send, Inbox, Trophy, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn, formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { SuggestionType, SuggestionStatus, SuggestionWithUser, SuggestionTeamStat } from '@/lib/types/database'
import { useSesion, useTenant } from '@/lib/tenant-context'

const TYPES: { value: SuggestionType; label: string; icon: React.ElementType; hint: string }[] = [
  { value: 'mejora', label: 'Mejora', icon: Lightbulb, hint: 'Una idea para mejorar la plataforma' },
  { value: 'error', label: 'Error', icon: Bug, hint: 'Algo que falla o no funciona bien' },
  { value: 'comentario', label: 'Comentario', icon: MessageSquare, hint: 'Cualquier otro comentario' },
]

const TYPE_ICON: Record<SuggestionType, React.ElementType> = {
  mejora: Lightbulb,
  error: Bug,
  comentario: MessageSquare,
}

const STATUS_META: Record<SuggestionStatus, { label: string; color: string }> = {
  nueva: { label: 'Nueva', color: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  en_revision: { label: 'En revisión', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  planificada: { label: 'Planificada', color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  en_progreso: { label: 'En progreso', color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  resuelta: { label: 'Resuelta', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  descartada: { label: 'Descartada', color: 'bg-zinc-500/15 text-muted-foreground border-border/30' },
}

export function FeedbackDialog() {
  const tenant = useTenant()
  const sesion = useSesion()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'enviar' | 'mias' | 'equipo'>('enviar')
  const [type, setType] = useState<SuggestionType>('mejora')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [mine, setMine] = useState<SuggestionWithUser[]>([])
  const [loadingMine, setLoadingMine] = useState(false)

  // Kaizen: ranking del equipo — visible a todos, no solo a admin/director.
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [teamStats, setTeamStats] = useState<SuggestionTeamStat[]>([])
  const [loadingTeam, setLoadingTeam] = useState(false)

  const reset = () => {
    setType('mejora')
    setTitle('')
    setMessage('')
  }

  const loadMine = async () => {
    setLoadingMine(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/suggestions?mine=1`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMine((data.suggestions ?? []) as SuggestionWithUser[])
    } catch {
      setMine([])
    } finally {
      setLoadingMine(false)
    }
  }

  // Al abrir el tablón "Mis sugerencias" (o al enviar una nueva) refrescamos la lista.
  useEffect(() => {
    if (open && tab === 'mias') loadMine()
  }, [open, tab])

  const loadTeam = async () => {
    setLoadingTeam(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/suggestions/team-stats`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setTeamStats((data.stats ?? []) as SuggestionTeamStat[])
    } catch {
      setTeamStats([])
    } finally {
      setLoadingTeam(false)
    }
  }

  useEffect(() => {
    if (open && tab === 'equipo') loadTeam()
  }, [open, tab])

  useEffect(() => {
    if (!open || myUserId) return
    setMyUserId(sesion?.userId ?? null)
  }, [open, myUserId, sesion])

  const submit = async () => {
    if (!title.trim() || !message.trim()) {
      toast.error('Rellena el título y el mensaje')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, title, message, page_url: pathname }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al enviar')
      toast.success('¡Gracias! Tu sugerencia se ha enviado.')
      reset()
      setTab('mias')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al enviar')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-brand-300 gap-1.5"
        onClick={() => setOpen(true)}
        title="Enviar sugerencia o reportar un error"
      >
        <Lightbulb className="w-4 h-4" />
        <span className="hidden sm:inline text-xs">Sugerencias</span>
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!submitting) setOpen(v)
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Sugerencias y mejoras</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Cuéntanos qué mejorarías, reporta un error o déjanos un comentario. Lo revisamos todo.
            </DialogDescription>
          </DialogHeader>

          {/* Pestañas: enviar nueva / ver las mías */}
          <div className="flex gap-1 rounded-lg bg-background border border-border p-1">
            <button
              type="button"
              onClick={() => setTab('enviar')}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                tab === 'enviar' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Enviar
            </button>
            <button
              type="button"
              onClick={() => setTab('mias')}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                tab === 'mias' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Mis sugerencias
            </button>
            <button
              type="button"
              onClick={() => setTab('equipo')}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors flex items-center justify-center gap-1',
                tab === 'equipo' ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Trophy className="w-3.5 h-3.5" /> Equipo
            </button>
          </div>

          {tab === 'enviar' ? (
            <>
              <div className="space-y-4 py-1">
                <div className="grid grid-cols-3 gap-2">
                  {TYPES.map((t) => {
                    const Icon = t.icon
                    const active = type === t.value
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setType(t.value)}
                        className={cn(
                          'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs transition-colors',
                          active
                            ? 'border-brand-500/60 bg-brand-500/10 text-brand-300'
                            : 'border-border text-muted-foreground hover:border-border hover:text-foreground'
                        )}
                      >
                        <Icon className="w-4 h-4" />
                        {t.label}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-muted-foreground -mt-2">{TYPES.find((t) => t.value === type)?.hint}</p>

                <div className="space-y-1.5">
                  <Label htmlFor="fb-title" className="text-foreground">
                    Título
                  </Label>
                  <Input
                    id="fb-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Resumen en una frase"
                    maxLength={200}
                    className="bg-background border-border text-foreground"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="fb-message" className="text-foreground">
                    Detalle
                  </Label>
                  <Textarea
                    id="fb-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Describe con detalle qué te gustaría, qué falla o tu comentario…"
                    rows={5}
                    className="bg-background border-border text-foreground resize-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="text-muted-foreground"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={submit}
                  disabled={submitting}
                  className="bg-brand-600 hover:bg-brand-500 text-white gap-1.5"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Enviar
                </Button>
              </div>
            </>
          ) : tab === 'mias' ? (
            <div className="py-1 max-h-[60vh] overflow-y-auto space-y-2">
              {loadingMine ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : mine.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                  <Inbox className="w-7 h-7" />
                  <p className="text-sm">Aún no has enviado ninguna sugerencia.</p>
                </div>
              ) : (
                mine.map((s) => {
                  const Icon = TYPE_ICON[s.type]
                  const st = STATUS_META[s.status]
                  return (
                    <div key={s.id} className="rounded-lg border border-border bg-background/60 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Icon className="w-3.5 h-3.5" />
                          {formatDateTime(s.created_at)}
                        </div>
                        <span
                          className={cn('shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium', st.color)}
                        >
                          {st.label}
                        </span>
                      </div>
                      <h4 className="text-sm font-medium text-foreground mt-1.5">{s.title}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap line-clamp-3">
                        {s.message}
                      </p>
                      {s.admin_notes && (
                        <p className="text-xs text-brand-300 mt-2 border-t border-border pt-2">
                          <span className="text-muted-foreground">Respuesta del equipo:</span> {s.admin_notes}
                        </p>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          ) : (
            <div className="py-1 max-h-[60vh] overflow-y-auto space-y-3">
              <p className="text-xs text-muted-foreground">
                Ranking Kaizen: reconocimiento al equipo por las ideas que propone y las que ya se han implementado en
                la plataforma.
              </p>
              {loadingTeam ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : teamStats.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                  <Trophy className="w-7 h-7" />
                  <p className="text-sm">Aún no hay sugerencias del equipo.</p>
                </div>
              ) : (
                teamStats.map((t, i) => {
                  const isMe = t.user_id === myUserId
                  const medal =
                    i === 0 && t.resolved_total > 0
                      ? '🏆'
                      : i === 1 && t.resolved_total > 0
                        ? '🥈'
                        : i === 2 && t.resolved_total > 0
                          ? '🥉'
                          : `#${i + 1}`
                  return (
                    <div
                      key={t.user_id}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border p-3',
                        isMe ? 'border-brand-500/50 bg-brand-500/10' : 'border-border bg-background/60'
                      )}
                    >
                      <div className="w-6 text-center text-sm font-semibold text-muted-foreground shrink-0">
                        {medal}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {t.full_name || t.email || 'Sin nombre'}
                          {isMe ? ' (tú)' : ''}
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          <span className="text-[11px] rounded-md border px-1.5 py-0.5 bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                            {t.resolved_total} implementada{t.resolved_total === 1 ? '' : 's'}
                          </span>
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
                  )
                })
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
