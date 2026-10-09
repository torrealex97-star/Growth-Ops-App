'use client'
import { useTenant } from '@/lib/tenant-context'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { upload } from '@vercel/blob/client'
import { bunnyConfigurado, subirVideoABunny } from './subirABunny'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DEFAULT_CONFIG, derivadosDeSource, type VslConfig } from '@/lib/vsl/types'
import { VslPlayer } from '@/components/vsl/VslPlayer'
import {
  Plus,
  Copy,
  Check,
  Trash2,
  Upload,
  Loader2,
  Play,
  Eye,
  Flag,
  Percent,
  Video,
  AlertTriangle,
  BarChart3,
  Code2,
  RefreshCw,
  Settings2,
} from 'lucide-react'

interface Video {
  id: string
  slug: string
  name: string
  source_url: string | null
  poster_url: string | null
  duration_seconds: number
  config: VslConfig
}

interface Metrics {
  video: Video
  totals: {
    impressions: number
    plays: number
    completed: number
    identified: number
    playRate: number
    avgPercent: number
    completionRate: number
  }
  retention: { sec: number; viewers: number; pct: number }[]
  milestones: { pct: number; sessions: number; rate: number }[]
  drops: { sec: number; from: number; to: number; delta: number }[]
  devices: { device: string; n: number }[]
  leads: {
    email: string
    name: string | null
    maxPosition: number
    pct: number
    reachedEnd: boolean
    updatedAt: string
  }[]
  /** Cuántas personas identificadas NO se muestran por permisos. 0 = las ves todas. */
  leadsOcultos?: number
  heatmaps?: {
    playbackId: string
    viewer: string
    startedAt: string
    duration: number
    watchedPercent: number
    intervals: { start: number; end: number }[]
  }[]
  trackingHealth?: {
    mode: 'precise' | 'legacy'
    precisionPlaybacks: number
    totalTimePlayed: number
    note: string
  }
}

// KPIs agregados de TODOS los vídeos de la subcuenta (criterios idénticos a las métricas por vídeo).
interface Resumen {
  videos: number
  impressions: number
  plays: number
  completed: number
  identified: number
  playRate: number
  completionRate: number
  avgPercent: number
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const BLUE = 'hsl(var(--brand-500))' // acento del tenant

export function VslDashboard() {
  const tenant = useTenant()
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [editing, setEditing] = useState<Partial<Video> | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [metricsError, setMetricsError] = useState(false)
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [copied, setCopied] = useState(false)
  const [previewSlug, setPreviewSlug] = useState<string | null>(null) // hover: preview animado

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const loadVideos = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/${tenant}/evergreen/vsl/videos`)
    const d = await r.json().catch(() => ({}))
    // Un fallo del API nunca se muestra como «sin vídeos» (error ≠ vacío).
    setLoadError(!r.ok)
    setVideos(r.ok ? d.videos || [] : [])
    setLoading(false)
    if (!selected && d.videos?.[0]) setSelected(d.videos[0].slug)
  }, [selected, tenant])

  useEffect(() => {
    loadVideos()
    // Resumen agregado de la subcuenta (error ≠ vacío: se muestra aviso, no ceros).
    fetch(`/api/${tenant}/evergreen/vsl/resumen`)
      .then(async (r) => {
        if (r.ok) setResumen(await r.json())
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMetrics = useCallback(
    async (slug: string) => {
      setMetrics(null)
      setMetricsError(false)
      setMetricsLoading(true)
      try {
        const r = await fetch(`/api/${tenant}/evergreen/vsl/metrics/${slug}`)
        if (!r.ok) throw new Error('No se pudieron cargar las métricas')
        setMetrics(await r.json())
      } catch {
        setMetricsError(true)
      } finally {
        setMetricsLoading(false)
      }
    },
    [tenant]
  )

  useEffect(() => {
    if (selected) loadMetrics(selected)
  }, [selected, loadMetrics])

  const snippet = useMemo(() => {
    if (!selected) return ''
    return `<!-- VSL -->
<iframe src="${origin}/embed/vsl/${selected}?tenant=${encodeURIComponent(tenant)}"
  style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px"
  allow="autoplay; fullscreen" allowfullscreen></iframe>
<script src="${origin}/embed/loader.js"></script>
<!-- Tras enviar el formulario, llama a: window.tccVSL.identify('EMAIL_DEL_LEAD') -->`
  }, [selected, origin, tenant])

  const copySnippet = () => {
    navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const del = async (id: string) => {
    if (!confirm('¿Borrar este vídeo y todas sus métricas?')) return
    await fetch(`/api/${tenant}/evergreen/vsl/videos?id=${id}`, { method: 'DELETE' })
    setSelected(null)
    loadVideos()
  }

  const selectedVideo = videos.find((video) => video.slug === selected) ?? null

  return (
    <div className="dashboard-surface mx-auto max-w-7xl space-y-6 pb-12">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-brand-400">
            <BarChart3 className="h-3.5 w-3.5" /> Video intelligence
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">VSL Analytics</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Reproduce, configura y entiende dónde mantiene la atención cada vídeo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {resumen && (
            <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
              <span>{resumen.videos} vídeos</span>
              <span className="h-1 w-1 rounded-full bg-border" />
              <span>{resumen.plays} reproducciones</span>
            </div>
          )}
          <Button onClick={() => setEditing({ config: { ...DEFAULT_CONFIG } })}>
            <Plus className="mr-1.5 h-4 w-4" /> Nuevo vídeo
          </Button>
        </div>
      </header>

      {loading && (
        <div className="grid gap-5 lg:grid-cols-[248px_minmax(0,1fr)]" aria-label="Cargando vídeos">
          <Skeleton className="h-[430px] rounded-xl" />
          <div className="space-y-4">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        </div>
      )}

      {!loading && loadError && (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 text-center">
          <AlertTriangle className="mb-3 h-7 w-7 text-destructive" />
          <h2 className="font-semibold text-foreground">No pudimos cargar la biblioteca</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            La conexión falló antes de recibir los vídeos. No se ha interpretado el error como una biblioteca vacía.
          </p>
          <Button className="mt-4" variant="outline" onClick={loadVideos}>
            <RefreshCw className="mr-2 h-4 w-4" /> Reintentar
          </Button>
        </div>
      )}

      {!loading && !loadError && videos.length === 0 && (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/10 text-brand-400">
            <Video className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Crea tu primera VSL</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Sube el vídeo, revisa el reproductor real y copia el embed cuando esté listo.
          </p>
          <Button className="mt-5" onClick={() => setEditing({ config: { ...DEFAULT_CONFIG } })}>
            <Plus className="mr-2 h-4 w-4" /> Añadir vídeo
          </Button>
        </div>
      )}

      {editing && (
        <VideoForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(v) => {
            setEditing(null)
            setSelected(v.slug)
            loadVideos()
          }}
        />
      )}

      {!loading && !loadError && selectedVideo && (
        <div className="grid items-start gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-border/70 bg-card/35 p-2 lg:sticky lg:top-20">
            <div className="flex items-center justify-between px-2 pb-2 pt-1">
              <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Biblioteca</span>
              <span className="text-xs tabular-nums text-muted-foreground">{videos.length}</span>
            </div>
            <div className="space-y-1" role="list" aria-label="Vídeos disponibles">
              {videos.map((video) => {
                const derived = derivadosDeSource(video.source_url)
                const active = selected === video.slug
                return (
                  <button
                    key={video.id}
                    type="button"
                    onClick={() => setSelected(video.slug)}
                    onMouseEnter={() => derived.preview && setPreviewSlug(video.slug)}
                    onMouseLeave={() => setPreviewSlug((slug) => (slug === video.slug ? null : slug))}
                    className={`group flex w-full gap-3 rounded-lg p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                      active
                        ? 'bg-brand-500/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    }`}
                    aria-current={active ? 'true' : undefined}
                  >
                    <div className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-md bg-black">
                      {derived.thumbnail || video.poster_url ? (
                        <img
                          src={
                            derived.preview && previewSlug === video.slug
                              ? derived.preview
                              : derived.thumbnail || video.poster_url || ''
                          }
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-white/35">
                          <Video className="h-4 w-4" />
                        </div>
                      )}
                      {!video.source_url && <span className="absolute inset-y-0 left-0 w-0.5 bg-destructive" />}
                    </div>
                    <div className="min-w-0 flex-1 py-0.5">
                      <p className="truncate text-sm font-medium">{video.name}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {video.source_url
                          ? video.duration_seconds > 0
                            ? fmt(video.duration_seconds)
                            : 'Lista'
                          : 'Sin fuente'}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>

          <main className="min-w-0 space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
                    {selectedVideo.name}
                  </h2>
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${selectedVideo.source_url ? 'bg-emerald-400' : 'bg-destructive'}`}
                  />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedVideo.source_url
                    ? 'Vista previa segura · no altera las métricas'
                    : 'Falta conectar el archivo de vídeo'}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing(selectedVideo)}>
                <Settings2 className="mr-2 h-4 w-4" /> Configurar
              </Button>
            </div>

            <div className="overflow-hidden rounded-xl border border-border/70 bg-black shadow-2xl shadow-black/20">
              <VslPlayer
                preview
                video={{
                  tenant,
                  slug: selectedVideo.slug,
                  source_url: selectedVideo.source_url,
                  poster_url: selectedVideo.poster_url,
                  duration_seconds: selectedVideo.duration_seconds,
                  config: selectedVideo.config,
                }}
              />
            </div>

            {metricsLoading && (
              <div className="space-y-4" aria-label="Cargando análisis">
                <Skeleton className="h-10 w-80 max-w-full rounded-lg" />
                <Skeleton className="h-36 w-full rounded-xl" />
                <Skeleton className="h-80 w-full rounded-xl" />
              </div>
            )}

            {metricsError && (
              <div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <div>
                  <p className="font-medium text-foreground">El vídeo carga, pero sus métricas no</p>
                  <p className="mt-1 text-sm text-muted-foreground">Reintenta sin recargar toda la página.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => loadMetrics(selectedVideo.slug)}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Reintentar
                </Button>
              </div>
            )}

            {metrics && !metricsLoading && (
              <Tabs defaultValue="engagement" className="space-y-5">
                <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-none border-b border-border bg-transparent p-0">
                  <TabsTrigger
                    value="engagement"
                    className="rounded-none border-b-2 border-transparent px-4 py-3 shadow-none data-[state=active]:border-brand-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    Engagement
                  </TabsTrigger>
                  <TabsTrigger
                    value="audience"
                    className="rounded-none border-b-2 border-transparent px-4 py-3 shadow-none data-[state=active]:border-brand-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    Audiencia
                  </TabsTrigger>
                  <TabsTrigger
                    value="embed"
                    className="rounded-none border-b-2 border-transparent px-4 py-3 shadow-none data-[state=active]:border-brand-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    Embed
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="engagement" className="space-y-5">
                  <section className="grid gap-4 rounded-xl border border-border/70 bg-card/35 p-5 xl:grid-cols-[minmax(220px,0.85fr)_minmax(0,2fr)]">
                    <div className="flex flex-col justify-between border-b border-border pb-5 xl:border-b-0 xl:border-r xl:pb-0 xl:pr-5">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          Promedio visto
                        </p>
                        <p className="mt-2 text-5xl font-semibold tracking-tight tabular-nums text-foreground">
                          {metrics.totals.plays > 0 ? `${metrics.totals.avgPercent}%` : '—'}
                        </p>
                      </div>
                      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                        {metrics.totals.plays > 0
                          ? 'Cuánto consume, de media, cada reproducción registrada.'
                          : 'Aún no hay reproducciones válidas para medir engagement.'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-4">
                      <Metric label="Impresiones" value={metrics.totals.impressions} icon={Eye} />
                      <Metric label="Reproducciones" value={metrics.totals.plays} icon={Play} />
                      <Metric
                        label="Play rate"
                        value={metrics.totals.impressions > 0 ? `${metrics.totals.playRate}%` : '—'}
                        icon={Percent}
                      />
                      <Metric
                        label="Completado"
                        value={metrics.totals.plays > 0 ? `${metrics.totals.completionRate}%` : '—'}
                        icon={Flag}
                      />
                    </div>
                  </section>

                  <Card className="border-border/70 bg-card/35 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base text-foreground">Retención a lo largo del vídeo</CardTitle>
                      <p className="text-sm text-muted-foreground">¿En qué momento deja de mirar la audiencia?</p>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-4 flex items-start gap-2 rounded-lg bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
                        <span
                          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                            metrics.trackingHealth?.mode === 'precise' ? 'bg-emerald-400' : 'bg-amber-400'
                          }`}
                        />
                        <span>
                          {metrics.trackingHealth?.note ?? 'Histórico aproximado anterior al tracking por intervalos.'}
                        </span>
                      </div>
                      {metrics.totals.plays > 0 && metrics.retention.length > 1 ? (
                        <ResponsiveContainer width="100%" height={300}>
                          <AreaChart data={metrics.retention} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                            <defs>
                              <linearGradient id="retention-fill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={BLUE} stopOpacity={0.28} />
                                <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.55} />
                            <XAxis
                              dataKey="sec"
                              tickFormatter={fmt}
                              stroke="hsl(var(--muted-foreground))"
                              fontSize={11}
                              minTickGap={44}
                              tickLine={false}
                              axisLine={false}
                            />
                            <YAxis
                              domain={[0, 100]}
                              tickFormatter={(value) => `${value}%`}
                              stroke="hsl(var(--muted-foreground))"
                              fontSize={11}
                              tickLine={false}
                              axisLine={false}
                            />
                            <Tooltip
                              contentStyle={{
                                background: 'hsl(var(--popover))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: 10,
                                fontSize: 12,
                              }}
                              labelFormatter={(label) => `Min ${fmt(Number(label))}`}
                              formatter={(value, _name, item) => [
                                `${value}% · ${item.payload.viewers} personas`,
                                'Retención',
                              ]}
                            />
                            <Area
                              type="monotone"
                              dataKey="pct"
                              stroke={BLUE}
                              strokeWidth={2.5}
                              fill="url(#retention-fill)"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <EmptyAnalysis
                          title="Sin curva todavía"
                          description="La retención aparecerá cuando existan reproducciones con progreso registrado."
                        />
                      )}
                    </CardContent>
                  </Card>

                  <details className="group rounded-xl border border-border/70 bg-card/20">
                    <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                      Ver hitos y puntos de caída
                      <span className="ml-2 text-xs font-normal text-muted-foreground">Detalle avanzado</span>
                    </summary>
                    <div className="grid gap-5 border-t border-border p-5 lg:grid-cols-2">
                      <div>
                        <h3 className="mb-3 text-sm font-medium text-foreground">Hitos de visión</h3>
                        <div className="grid grid-cols-5 gap-2">
                          {metrics.milestones.map((milestone) => (
                            <div key={milestone.pct} className="rounded-lg bg-muted/45 px-2 py-3 text-center">
                              <p className="font-semibold tabular-nums text-foreground">
                                {metrics.totals.plays > 0 ? `${milestone.rate}%` : '—'}
                              </p>
                              <p className="mt-1 text-2xs text-muted-foreground">al {milestone.pct}%</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h3 className="mb-3 text-sm font-medium text-foreground">Mayores caídas</h3>
                        <div className="space-y-2">
                          {metrics.drops.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              Sin caídas relevantes con la muestra actual.
                            </p>
                          ) : (
                            metrics.drops.map((drop) => (
                              <div
                                key={`${drop.sec}-${drop.delta}`}
                                className="flex items-center justify-between rounded-lg bg-muted/45 px-3 py-2 text-sm"
                              >
                                <span className="font-medium text-foreground">{fmt(drop.sec)}</span>
                                <span className="text-muted-foreground">
                                  {drop.from}% → {drop.to}%
                                </span>
                                <span className="font-medium text-brand-400">−{drop.delta}%</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </details>
                </TabsContent>

                <TabsContent value="audience" className="space-y-5">
                  {(metrics.heatmaps?.length ?? 0) > 0 && (
                    <Card className="border-border/70 bg-card/35 shadow-none">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base text-foreground">Heatmaps recientes</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Qué fragmentos reprodujo cada espectador; los huecos son segundos no vistos.
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {(metrics.heatmaps ?? []).map((heatmap) => (
                          <div key={heatmap.playbackId} className="space-y-2">
                            <div className="flex items-center justify-between gap-3 text-sm">
                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">{heatmap.viewer}</p>
                                <p className="text-xs text-muted-foreground">
                                  {new Date(heatmap.startedAt).toLocaleString('es-ES')}
                                </p>
                              </div>
                              <span className="shrink-0 font-medium tabular-nums text-foreground">
                                {heatmap.watchedPercent}% visto
                              </span>
                            </div>
                            <div
                              className="relative h-3 overflow-hidden rounded-full bg-muted"
                              aria-label={`${heatmap.watchedPercent}% visto`}
                            >
                              {heatmap.intervals.map((interval, index) => {
                                const duration = Math.max(1, heatmap.duration)
                                const left = Math.min(100, (interval.start / duration) * 100)
                                const width = Math.max(
                                  0.35,
                                  Math.min(100 - left, ((interval.end - interval.start) / duration) * 100)
                                )
                                return (
                                  <span
                                    key={`${interval.start}-${interval.end}-${index}`}
                                    className="absolute inset-y-0 bg-brand-500"
                                    style={{ left: `${left}%`, width: `${width}%` }}
                                  />
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(240px,0.7fr)]">
                    <Card className="border-border/70 bg-card/35 shadow-none">
                      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
                        <div>
                          <CardTitle className="text-base text-foreground">Espectadores identificados</CardTitle>
                          <p className="mt-1 text-sm text-muted-foreground">¿Quién vio el vídeo y hasta dónde llegó?</p>
                        </div>
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {(metrics.leadsOcultos ?? 0) > 0 ? metrics.leadsOcultos : metrics.leads.length}
                        </span>
                      </CardHeader>
                      <CardContent>
                        {(metrics.leadsOcultos ?? 0) > 0 ? (
                          <EmptyAnalysis
                            title="Datos protegidos"
                            description={`Hay ${metrics.leadsOcultos} espectadores identificados. Ver sus datos personales requiere acceso a Contactos.`}
                          />
                        ) : metrics.leads.length === 0 ? (
                          <EmptyAnalysis
                            title="Nadie identificado todavía"
                            description="Conecta identify(email) después del formulario para enlazar la visualización con el CRM."
                          />
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[520px] text-sm">
                              <thead className="text-left text-xs text-muted-foreground">
                                <tr>
                                  <th className="pb-3 font-medium">Espectador</th>
                                  <th className="pb-3 font-medium">Visto</th>
                                  <th className="pb-3 text-right font-medium">Último punto</th>
                                </tr>
                              </thead>
                              <tbody>
                                {metrics.leads.map((lead) => (
                                  <tr key={`${lead.email}-${lead.updatedAt}`} className="border-t border-border/60">
                                    <td className="py-3">
                                      <p className="font-medium text-foreground">{lead.name || lead.email}</p>
                                      {lead.name && <p className="text-xs text-muted-foreground">{lead.email}</p>}
                                    </td>
                                    <td className="py-3">
                                      <div className="flex items-center gap-3">
                                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                                          <div
                                            className={`h-full rounded-full ${lead.reachedEnd ? 'bg-emerald-400' : 'bg-brand-500'}`}
                                            style={{ width: `${lead.pct}%` }}
                                          />
                                        </div>
                                        <span className="text-xs tabular-nums text-foreground">{lead.pct}%</span>
                                      </div>
                                    </td>
                                    <td className="py-3 text-right tabular-nums text-foreground">
                                      {lead.reachedEnd ? 'Final' : fmt(lead.maxPosition)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    <Card className="border-border/70 bg-card/35 shadow-none">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base text-foreground">Dispositivos</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {metrics.devices.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Sin datos de dispositivo.</p>
                        ) : (
                          metrics.devices.map((device) => {
                            const total = metrics.devices.reduce((sum, current) => sum + current.n, 0) || 1
                            const share = Math.round((device.n / total) * 100)
                            return (
                              <div key={device.device}>
                                <div className="mb-1.5 flex justify-between text-xs">
                                  <span className="capitalize text-foreground">{device.device}</span>
                                  <span className="tabular-nums text-muted-foreground">{share}%</span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${share}%` }} />
                                </div>
                              </div>
                            )
                          })
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="embed" className="space-y-5">
                  <Card className="border-border/70 bg-card/35 shadow-none">
                    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base text-foreground">
                          <Code2 className="h-4 w-4 text-brand-400" /> Código para tu landing
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Inserta este reproductor en una página del mismo tenant.
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={copySnippet} disabled={!selectedVideo.source_url}>
                        {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                        {copied ? 'Copiado' : 'Copiar código'}
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {!selectedVideo.source_url && (
                        <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-muted-foreground">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                          <p>Sube o conecta una fuente antes de publicar el embed.</p>
                        </div>
                      )}
                      <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-background/70 p-4 text-xs leading-relaxed text-foreground">
                        <code>{snippet}</code>
                      </pre>
                    </CardContent>
                  </Card>
                  <div className="flex flex-col gap-3 rounded-xl border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-foreground">Configuración del reproductor</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Miniatura, autoplay, progreso, CTA y comportamiento de salida.
                      </p>
                    </div>
                    <Button variant="outline" onClick={() => setEditing(selectedVideo)}>
                      <Settings2 className="mr-2 h-4 w-4" /> Editar reproductor
                    </Button>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => del(selectedVideo.id)}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Borrar vídeo
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </main>
        </div>
      )}
    </div>
  )
}

function Metric({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function EmptyAnalysis({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center px-4 text-center">
      <BarChart3 className="mb-3 h-6 w-6 text-muted-foreground/60" />
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

// ---- Formulario de alta / edición -----------------------------------------
function VideoForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: Partial<Video>
  onClose: () => void
  onSaved: (v: Video) => void
}) {
  const tenant = useTenant()
  const [name, setName] = useState(initial.name || '')
  const [sourceUrl, setSourceUrl] = useState(initial.source_url || '')
  const [posterUrl, setPosterUrl] = useState(initial.poster_url || '')
  const [duration, setDuration] = useState(initial.duration_seconds || 0)
  const [config, setConfig] = useState<VslConfig>({ ...DEFAULT_CONFIG, ...(initial.config || {}) })
  const [uploading, setUploading] = useState<'video' | 'poster' | null>(null)
  const [progreso, setProgreso] = useState<number | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const setCfg = <K extends keyof VslConfig>(key: K, value: VslConfig[K]) =>
    setConfig((current) => ({ ...current, [key]: value }))

  const readDuration = (file: File) =>
    new Promise<number>((resolve) => {
      const el = document.createElement('video')
      el.preload = 'metadata'
      el.onloadedmetadata = () => resolve(el.duration || 0)
      el.onerror = () => resolve(0)
      el.src = URL.createObjectURL(file)
    })

  const onFile = async (file: File, kind: 'video' | 'poster') => {
    setErr(null)
    setAviso(null)
    setUploading(kind)
    try {
      if (kind === 'video') {
        const d = await readDuration(file)
        if (d) setDuration(Math.round(d))
        // Con Bunny configurado el vídeo va a Bunny Stream (HLS por CDN); si no, a la vía anterior,
        // que explica qué falta. Ver lib/vsl/bunny.ts.
        if (await bunnyConfigurado(tenant)) {
          setProgreso(0)
          const { playlist, miniatura } = await subirVideoABunny(tenant, file, setProgreso)
          setSourceUrl(playlist)
          if (!posterUrl) setPosterUrl(miniatura)
          setAviso(
            'Subido a Bunny. Ahora lo está procesando: tardará unos minutos en poder reproducirse. Puedes guardar ya.'
          )
          return
        }
      }
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: `/api/${tenant}/evergreen/vsl/upload`,
        contentType: file.type,
      })
      if (kind === 'video') setSourceUrl(blob.url)
      else setPosterUrl(blob.url)
    } catch (e) {
      setErr((e as Error).message || 'No se pudo subir el archivo. Puedes pegar el enlace del vídeo en su lugar.')
    } finally {
      setUploading(null)
      setProgreso(null)
    }
  }

  const save = async () => {
    setErr(null)
    // No es un bloqueo duro (una subida a Bunny puede seguir procesando y aun así conviene guardar
    // el resto de la configuración), pero sí una confirmación explícita: guardar así deja el vídeo
    // en un estado en el que su embed público muestra "sin fuente configurada" hasta que se complete.
    if (
      !sourceUrl.trim() &&
      !confirm(
        'Este vídeo no tiene ningún archivo ni URL de fuente todavía. Si lo guardas así, su código de embed no reproducirá nada hasta que subas el vídeo. ¿Guardar de todas formas?'
      )
    ) {
      return
    }
    setSaving(true)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/vsl/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: initial.id,
          name,
          source_url: sourceUrl,
          poster_url: posterUrl,
          duration_seconds: duration,
          config,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Error al guardar')
      onSaved(d.video)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="dashboard-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-foreground">{initial.id ? 'Editar vídeo' : 'Nuevo vídeo'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-foreground">Nombre</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VSL principal"
            className="mt-1 bg-black/30"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-foreground">Vídeo</Label>
            <div className="mt-1 flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-foreground hover:border-white/30">
                {uploading === 'video' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Subir archivo
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0], 'video')}
                />
              </label>
            </div>
            <Input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="…o pega una URL (.mp4 o .m3u8 de Bunny)"
              className="mt-2 bg-black/30 text-xs"
            />
            {progreso !== null && (
              <p className="mt-1 text-xs text-muted-foreground" role="status">
                Subiendo a Bunny… {progreso}%
              </p>
            )}
            {aviso && (
              <p className="mt-1 text-xs text-muted-foreground" role="status">
                {aviso}
              </p>
            )}
            {duration > 0 && <p className="mt-1 text-xs text-muted-foreground">Duración: {fmt(duration)}</p>}
          </div>

          <div>
            <Label className="text-foreground">Miniatura (carga instantánea)</Label>
            <div className="mt-1 flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-foreground hover:border-white/30">
                {uploading === 'poster' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Subir imagen
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0], 'poster')}
                />
              </label>
            </div>
            <Input
              value={posterUrl}
              onChange={(e) => setPosterUrl(e.target.value)}
              placeholder="…o URL de imagen"
              className="mt-2 bg-black/30 text-xs"
            />
          </div>
        </div>

        {/* Vista previa en vivo: el mismo VslPlayer que verá quien visite la landing, con la config
            actual del formulario (colores, CTA, autoplay…) aplicada en tiempo real. `preview` corta
            toda escritura de tracking/localStorage — mirar el propio vídeo no puede sumar una
            impresión falsa a sus métricas. Sin esto, la única forma de ver cómo queda era guardar,
            copiar el embed y pegarlo en otra página. */}
        <div>
          <Label className="text-foreground">Vista previa</Label>
          {sourceUrl.trim() ? (
            <div className="mt-1 overflow-hidden rounded-lg">
              <VslPlayer
                preview
                video={{
                  tenant,
                  slug: initial.slug || 'preview',
                  source_url: sourceUrl,
                  poster_url: posterUrl || null,
                  duration_seconds: duration,
                  config,
                }}
              />
            </div>
          ) : (
            <div className="mt-1 flex aspect-video items-center justify-center rounded-lg border border-dashed border-white/15 bg-black/20 text-sm text-muted-foreground">
              Sube o pega la fuente del vídeo para ver aquí la vista previa.
            </div>
          )}
        </div>

        {/* Config del reproductor */}
        <div className="grid gap-4 rounded-lg bg-black/20 p-3 md:grid-cols-2">
          <div className="flex items-center gap-3">
            <Label className="text-foreground">Color de la barra</Label>
            <input
              type="color"
              value={config.barColor}
              onChange={(e) => setCfg('barColor', e.target.value)}
              className="h-8 w-12 cursor-pointer rounded bg-transparent"
            />
          </div>
          <div className="flex items-center gap-3">
            <Label className="text-foreground">Color del botón</Label>
            <input
              type="color"
              value={config.primaryColor}
              onChange={(e) => setCfg('primaryColor', e.target.value)}
              className="h-8 w-12 cursor-pointer rounded bg-transparent"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={config.showBar} onCheckedChange={(v) => setCfg('showBar', !!v)} /> Mostrar barra de
            progreso
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={config.autoplay} onCheckedChange={(v) => setCfg('autoplay', !!v)} /> Autoplay
            (silenciado)
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={config.tryAudioAutoplay} onCheckedChange={(v) => setCfg('tryAudioAutoplay', !!v)} />{' '}
            Intentar autoplay con sonido (fallback a mute en Chrome)
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={config.restartOnUnmute} onCheckedChange={(v) => setCfg('restartOnUnmute', !!v)} />{' '}
            Reiniciar desde el inicio al activar el sonido (no perder el hook)
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={config.lockSeek} onCheckedChange={(v) => setCfg('lockSeek', !!v)} /> Impedir adelantar el
            vídeo
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={config.fakeProgress} onCheckedChange={(v) => setCfg('fakeProgress', !!v)} /> Barra
            acelerada (sensación de que queda poco)
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={config.loop} onCheckedChange={(v) => setCfg('loop', !!v)} /> Repetir en bucle al terminar
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={config.showCentralPlay} onCheckedChange={(v) => setCfg('showCentralPlay', !!v)} /> Botón
            play central al pausar
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={config.showFullscreenBtn} onCheckedChange={(v) => setCfg('showFullscreenBtn', !!v)} />{' '}
            Botón de pantalla completa
          </label>

          {/* Prueba social */}
          <div className="md:col-span-2 border-t border-white/10 pt-3">
            <Label className="text-foreground">Contador de prueba social</Label>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <select
                value={config.socialProof}
                onChange={(e) => setCfg('socialProof', e.target.value as VslConfig['socialProof'])}
                className="rounded-md border border-white/15 bg-black/30 px-2 py-1.5 text-sm text-foreground"
              >
                <option value="off">Desactivado</option>
                <option value="fake">Inventado (para el VSL)</option>
                <option value="real">Real (para la app / herramienta)</option>
              </select>
              {config.socialProof === 'fake' && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Viendo ahora:</span>
                  <Input
                    type="number"
                    value={config.spViewersMin}
                    onChange={(e) => setCfg('spViewersMin', Number(e.target.value))}
                    className="h-8 w-16 bg-black/30"
                  />
                  <span>a</span>
                  <Input
                    type="number"
                    value={config.spViewersMax}
                    onChange={(e) => setCfg('spViewersMax', Number(e.target.value))}
                    className="h-8 w-16 bg-black/30"
                  />
                  <span className="ml-2">Ya lo vieron (base):</span>
                  <Input
                    type="number"
                    value={config.spWatchedBase}
                    onChange={(e) => setCfg('spWatchedBase', Number(e.target.value))}
                    className="h-8 w-24 bg-black/30"
                  />
                </div>
              )}
              {config.socialProof === 'real' && (
                <span className="text-xs text-muted-foreground">
                  Usa sesiones reales del propio VSL (viendo ahora = actividad de los últimos 15s).
                </span>
              )}
            </div>
          </div>

          {/* Gancho de recuperación (idea 6) */}
          <div className="md:col-span-2 border-t border-white/10 pt-3">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={config.exitHook} onCheckedChange={(v) => setCfg('exitHook', !!v)} /> Gancho al pausar /
              intentar salir (recuperación)
            </label>
            {config.exitHook && (
              <Input
                value={config.exitHookText}
                onChange={(e) => setCfg('exitHookText', e.target.value)}
                placeholder="Mensaje del gancho…"
                className="mt-2 bg-black/30 text-sm"
              />
            )}
          </div>

          {/* CTA programado (paridad Vidalytics): botón en un % del vídeo con auto-pausa opcional */}
          <div className="md:col-span-2 border-t border-white/10 pt-3">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={config.ctaEnabled} onCheckedChange={(v) => setCfg('ctaEnabled', !!v)} /> Mostrar un
              botón de acción en un momento del vídeo
            </label>
            {config.ctaEnabled && (
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <Input
                  value={config.ctaText}
                  onChange={(e) => setCfg('ctaText', e.target.value)}
                  placeholder="Texto del botón (p. ej. Reservar llamada)"
                  className="bg-black/30 text-sm"
                />
                <Input
                  value={config.ctaUrl}
                  onChange={(e) => setCfg('ctaUrl', e.target.value)}
                  placeholder="URL de destino (p. ej. https://… o /calendly/…)"
                  className="bg-black/30 text-sm"
                />
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <span className="whitespace-nowrap">Aparece en:</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={config.ctaAtPercent}
                    onChange={(e) => setCfg('ctaAtPercent', Math.min(100, Math.max(0, Number(e.target.value))))}
                    className="h-8 w-20 bg-black/30"
                  />
                  <span className="text-muted-foreground">% del vídeo</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox checked={config.ctaPause} onCheckedChange={(v) => setCfg('ctaPause', !!v)} /> Pausar el
                  vídeo cuando aparece
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox checked={config.ctaOnce} onCheckedChange={(v) => setCfg('ctaOnce', !!v)} /> Cerrable (si el
                  usuario lo cierra no vuelve hasta recargar)
                </label>
              </div>
            )}
          </div>
        </div>

        {err && <p className="text-sm text-red-400">{err}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !name} style={{ backgroundColor: BLUE }}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Guardar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
