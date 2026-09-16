'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Clapperboard,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Images,
  AlertTriangle,
  Play,
  Award,
  PlayCircle,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { testimonioPitch, type Testimonio } from '@/lib/testimonios-shared'
import { useTenant } from '@/lib/tenant-context'
import { CalendarPopover } from '@/components/ui/calendar-popover'

type Draft = {
  id: string
  source_media_id: string | null
  source_permalink: string | null
  source_account: string | null
  thumbnail_url: string | null
  caption: string | null
  transcript: string | null
  adapted_script: string | null
  carousel_idea: string | null
  testimonio_id: string | null
  status: 'pendiente' | 'aprobado' | 'descartado'
  gen_error: string | null
  created_at: string
  draft_day: string
}

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function ReelsDelDiaPage() {
  const tenant = useTenant()
  const router = useRouter()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)
  const [day, setDay] = useState(todayStr())
  const [status, setStatus] = useState<'' | 'pendiente' | 'aprobado' | 'descartado'>('')
  const [expandedTranscript, setExpandedTranscript] = useState<Record<string, boolean>>({})
  const [scriptDrafts, setScriptDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [testimonios, setTestimonios] = useState<Testimonio[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (day) params.set('day', day)
      if (status) params.set('status', status)
      const res = await fetch(`/api/${tenant}/evergreen/reels?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setDrafts(json.drafts || [])
      const scripts: Record<string, string> = {}
      for (const d of json.drafts || []) scripts[d.id] = d.adapted_script || ''
      setScriptDrafts(scripts)
    } catch (e) {
      toast.error('No se pudieron cargar los reels', { description: e instanceof Error ? e.message : '' })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [day, status])
  // Catálogo de testimonios para poder marcar cuál lleva cada reel.
  useEffect(() => {
    fetch(`/api/${tenant}/evergreen/testimonios`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setTestimonios((j.testimonios || []).filter((t: Testimonio) => t.active)))
      .catch(() => {})
  }, [])

  const setBusyFor = (id: string, v: boolean) => setBusy((b) => ({ ...b, [id]: v }))

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusyFor(id, true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/reels/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setDrafts((prev) => prev.map((d) => (d.id === id ? json.draft : d)))
      if (json.draft?.adapted_script !== undefined) {
        setScriptDrafts((prev) => ({ ...prev, [id]: json.draft.adapted_script || '' }))
      }
      return json.draft as Draft
    } catch (e) {
      toast.error('No se pudo actualizar', { description: e instanceof Error ? e.message : '' })
      return null
    } finally {
      setBusyFor(id, false)
    }
  }

  const approve = async (id: string) => {
    const d = await patch(id, { status: 'aprobado', adapted_script: scriptDrafts[id] })
    if (d) toast.success('Reel aprobado')
  }
  const discard = async (id: string) => {
    const d = await patch(id, { status: 'descartado' })
    if (d) toast.success('Reel descartado')
  }
  const regenerate = async (id: string) => {
    setBusyFor(id, true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/reels/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setDrafts((prev) => prev.map((d) => (d.id === id ? json.draft : d)))
      setScriptDrafts((prev) => ({ ...prev, [id]: json.draft?.adapted_script || '' }))
      toast.success('Guión regenerado')
    } catch (e) {
      toast.error('No se pudo regenerar', { description: e instanceof Error ? e.message : '' })
    } finally {
      setBusyFor(id, false)
    }
  }

  const setTestimonio = async (id: string, testimonioId: string) => {
    const d = await patch(id, { testimonio_id: testimonioId || null })
    if (d) toast.success(testimonioId ? 'Testimonio asignado al reel' : 'Testimonio quitado')
  }

  const copyScript = (id: string) => {
    const text = scriptDrafts[id] || ''
    if (!text) return
    navigator.clipboard.writeText(text)
    toast.success('Guión copiado')
  }

  const goToCarousel = (d: Draft) => {
    const idea = d.carousel_idea || ''
    router.push(`/${tenant}/instagram/carruseles${idea ? `?idea=${encodeURIComponent(idea)}` : ''}`)
  }

  const sorted = useMemo(
    () => [...drafts].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [drafts]
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Clapperboard className="w-6 h-6 text-pink-400" /> Reels del día
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Cada día minamos ~5 reels de las cuentas de Competencia y te dejamos aquí el guión adaptado (hook + CTA
            Growth Ops), la transcripción original y una idea de carrusel. Tú decides qué aprobar.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-muted text-foreground hover:bg-muted"
        >
          <RefreshCw className="w-4 h-4" /> Actualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Día</label>
          <CalendarPopover
            value={day}
            onChange={setDay}
            disablePast={false}
            label="Día de los reels"
            className="h-8 w-44"
          />
        </div>
        <div className="flex items-center gap-1">
          {(['', 'pendiente', 'aprobado', 'descartado'] as const).map((s) => (
            <button
              key={s || 'todos'}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs ${status === s ? 'bg-pink-600 text-foreground' : 'bg-muted text-foreground hover:bg-muted'}`}
            >
              {s === '' ? 'Todos' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-64 bg-card rounded-lg animate-pulse" />
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/50 p-6 text-sm text-muted-foreground">
          No hay reels para este filtro. El cron corre una vez al día; si aún no ha corrido hoy, prueba a cambiar el
          filtro de día o vuelve más tarde.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sorted.map((d) => {
            const isBusy = !!busy[d.id]
            const transcriptOpen = !!expandedTranscript[d.id]
            const testimonio = d.testimonio_id ? testimonios.find((t) => t.id === d.testimonio_id) : undefined
            return (
              <div key={d.id} className="rounded-xl border border-border bg-card/50 flex flex-col overflow-hidden">
                <div className="flex gap-3 p-4 border-b border-border">
                  {d.thumbnail_url ? (
                    <img src={d.thumbnail_url} alt="" className="w-16 h-20 object-cover rounded-lg bg-muted shrink-0" />
                  ) : (
                    <div className="w-16 h-20 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Play className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground truncate">
                        {d.source_account ? `@${d.source_account}` : 'Cuenta desconocida'}
                      </p>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
                          d.status === 'aprobado'
                            ? 'bg-emerald-950/50 text-emerald-300'
                            : d.status === 'descartado'
                              ? 'bg-red-950/50 text-red-300'
                              : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {d.status}
                      </span>
                    </div>
                    {testimonio && (
                      <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-pink-950/50 text-pink-300 text-[10px] font-medium">
                        <Award className="w-2.5 h-2.5" /> Lleva testimonio: {testimonio.name}
                      </span>
                    )}
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{d.caption || 'Sin descripción'}</p>
                    {d.source_permalink && (
                      <a
                        href={d.source_permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-sky-400 hover:underline flex items-center gap-1 mt-1"
                      >
                        <ExternalLink className="w-3 h-3" /> Ver reel original
                      </a>
                    )}
                  </div>
                </div>

                {d.gen_error && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-amber-950/30 border-b border-border text-xs text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span className="flex-1">{d.gen_error}</span>
                    <button
                      onClick={() => regenerate(d.id)}
                      disabled={isBusy}
                      className="shrink-0 flex items-center gap-1 text-amber-200 hover:text-foreground disabled:opacity-50"
                    >
                      {isBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}{' '}
                      Regenerar
                    </button>
                  </div>
                )}

                <div className="p-4 space-y-3 flex-1">
                  {/* Transcripción original (colapsable) */}
                  {d.transcript && (
                    <div>
                      <button
                        onClick={() => setExpandedTranscript((p) => ({ ...p, [d.id]: !p[d.id] }))}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {transcriptOpen ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                        Transcripción original
                      </button>
                      {transcriptOpen && (
                        <p className="mt-1 text-xs text-muted-foreground bg-background/50 rounded-lg p-3 whitespace-pre-wrap max-h-40 overflow-y-auto">
                          {d.transcript}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Guión adaptado (editable) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-muted-foreground">
                        Guión adaptado (hook + CTA Growth Ops)
                      </label>
                      <button
                        onClick={() => copyScript(d.id)}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" /> Copiar guion
                      </button>
                    </div>
                    <textarea
                      value={scriptDrafts[d.id] ?? ''}
                      onChange={(e) => setScriptDrafts((p) => ({ ...p, [d.id]: e.target.value }))}
                      rows={7}
                      placeholder={d.gen_error ? 'Sin generar aún — pulsa Regenerar.' : 'Guión adaptado...'}
                      className="w-full bg-muted border border-border rounded-lg p-3 text-sm text-foreground focus:outline-none focus:border-pink-500"
                    />
                  </div>

                  {/* Testimonio del reel: el editor marca cuál lleva y coge de aquí el material. */}
                  <div>
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Award className="w-3.5 h-3.5 text-pink-400" /> Testimonio del reel
                    </label>
                    <select
                      value={d.testimonio_id || ''}
                      onChange={(e) => setTestimonio(d.id, e.target.value)}
                      disabled={isBusy}
                      className="w-full mt-1 bg-muted border border-border rounded-lg p-2 text-xs text-foreground focus:outline-none focus:border-pink-500 disabled:opacity-50"
                    >
                      <option value="">Sin testimonio</option>
                      {testimonios.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.sector ? ` — ${t.sector}` : ''}
                        </option>
                      ))}
                    </select>

                    {testimonio && (
                      <div className="mt-2 rounded-lg border border-pink-500/25 bg-pink-950/10 p-3">
                        <div className="flex gap-3">
                          {testimonio.photoUrl && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={testimonio.photoUrl}
                              alt={testimonio.name}
                              className="w-24 h-16 object-cover rounded border border-border shrink-0"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-foreground">
                              {testimonio.name}
                              {!testimonio.hasRevenue && (
                                <span className="ml-1.5 text-[10px] font-normal text-amber-300">sin cifras</span>
                              )}
                              {testimonio.kind === 'cliente' && (
                                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                                  cliente, no alumno
                                </span>
                              )}
                            </p>
                            {testimonio.cifra && testimonio.hasRevenue && (
                              <p className="text-[11px] text-pink-300 mt-0.5">{testimonio.cifra}</p>
                            )}
                            {testimonio.hook && (
                              <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{testimonio.hook}</p>
                            )}
                          </div>
                        </div>
                        <div className="text-[11px] text-muted-foreground space-y-1 mt-2 leading-relaxed">
                          {testimonio.puntoA && (
                            <p>
                              <span className="text-foreground/70 font-medium">Antes:</span> {testimonio.puntoA}
                            </p>
                          )}
                          {testimonio.puntoB && (
                            <p>
                              <span className="text-foreground/70 font-medium">Ahora:</span> {testimonio.puntoB}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-2.5">
                          <Link
                            href={`/${tenant}/recursos/testimonios/${testimonio.id}`}
                            className="text-[11px] text-pink-300 hover:underline flex items-center gap-1"
                          >
                            <Award className="w-3 h-3" /> Ver ficha
                          </Link>
                          {testimonio.youtubeUrl && (
                            <a
                              href={testimonio.youtubeUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-sky-400 hover:underline flex items-center gap-1"
                            >
                              <PlayCircle className="w-3 h-3" /> Vídeo original
                            </a>
                          )}
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(testimonioPitch(testimonio))
                              toast.success('Testimonio copiado')
                            }}
                            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 ml-auto"
                          >
                            <Copy className="w-3 h-3" /> Copiar historia
                          </button>
                        </div>
                        {!testimonio.youtubeUrl && (
                          <p className="text-[10px] text-amber-300/90 mt-2">
                            Este testimonio todavía no tiene el vídeo cargado: pídelo o añádelo desde su ficha.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Idea de carrusel/flyer */}
                  {d.carousel_idea && (
                    <div>
                      <label className="text-xs text-muted-foreground">Idea de carrusel/flyer</label>
                      <p className="mt-1 text-xs text-foreground bg-background/50 rounded-lg p-3 whitespace-pre-wrap">
                        {d.carousel_idea}
                      </p>
                      <button
                        onClick={() => goToCarousel(d)}
                        className="mt-2 flex items-center gap-1 text-xs text-pink-300 bg-pink-950/40 hover:bg-pink-900/40 px-2 py-1 rounded"
                      >
                        <Images className="w-3.5 h-3.5" /> Crear carrusel
                      </button>
                    </div>
                  )}
                </div>

                <div className="border-t border-border p-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => approve(d.id)}
                    disabled={isBusy || d.status === 'aprobado'}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-emerald-600 text-foreground hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" /> Aprobar
                  </button>
                  <button
                    onClick={() => discard(d.id)}
                    disabled={isBusy || d.status === 'descartado'}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-muted text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    <X className="w-4 h-4" /> Descartar
                  </button>
                  <button
                    onClick={() => regenerate(d.id)}
                    disabled={isBusy}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 ml-auto"
                  >
                    {isBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{' '}
                    Regenerar
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
