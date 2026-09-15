'use client'
import { useTenant } from '@/lib/tenant-context'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { upload } from '@vercel/blob/client'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { DEFAULT_CONFIG, type VslConfig } from '@/lib/vsl/types'
import { Plus, Copy, Check, Trash2, Upload, Loader2, Play, Eye, Users, Flag, Percent } from 'lucide-react'

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
  const [editing, setEditing] = useState<Partial<Video> | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [copied, setCopied] = useState(false)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const loadVideos = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/${tenant}/evergreen/vsl/videos`)
    const d = await r.json()
    setVideos(d.videos || [])
    setLoading(false)
    if (!selected && d.videos?.[0]) setSelected(d.videos[0].slug)
  }, [selected])

  useEffect(() => {
    loadVideos()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMetrics = useCallback(async (slug: string) => {
    setMetrics(null)
    const r = await fetch(`/api/${tenant}/evergreen/vsl/metrics/${slug}`)
    if (r.ok) setMetrics(await r.json())
  }, [])

  useEffect(() => {
    if (selected) loadMetrics(selected)
  }, [selected, loadMetrics])

  const snippet = useMemo(() => {
    if (!selected) return ''
    return `<!-- VSL -->
<iframe src="${origin}/embed/vsl/${selected}"
  style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px"
  allow="autoplay; fullscreen" allowfullscreen></iframe>
<script src="${origin}/embed/loader.js"></script>
<!-- Tras enviar el formulario, llama a: window.tccVSL.identify('EMAIL_DEL_LEAD') -->`
  }, [selected, origin])

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

  return (
    <div className="dashboard-surface mx-auto max-w-6xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">VSL / Vídeos</h1>
          <p className="text-sm text-muted-foreground">
            Aloja tu VSL, incrústalo en la landing y trackea toda la retención.
          </p>
        </div>
        <Button onClick={() => setEditing({ config: { ...DEFAULT_CONFIG } })} style={{ backgroundColor: BLUE }}>
          <Plus className="mr-1 h-4 w-4" /> Nuevo vídeo
        </Button>
      </div>

      {/* Selector de vídeos */}
      <div className="flex flex-wrap gap-2">
        {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        {videos.map((v) => (
          <button
            key={v.id}
            onClick={() => setSelected(v.slug)}
            className={`rounded-lg border px-3 py-2 text-sm transition ${
              selected === v.slug
                ? 'border-brand-500 bg-brand-500/15 text-foreground'
                : 'dashboard-card text-foreground hover:border-white/20'
            }`}
          >
            {v.name}
          </button>
        ))}
        {!loading && videos.length === 0 && (
          <p className="text-sm text-muted-foreground">Aún no hay vídeos. Crea el primero.</p>
        )}
      </div>

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

      {selected && metrics && (
        <>
          {/* Snippet de embed */}
          <Card className="dashboard-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base text-foreground">Código para la landing</CardTitle>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const v = videos.find((x) => x.slug === selected)
                    if (v) setEditing(v)
                  }}
                >
                  Editar / configurar
                </Button>
                <Button size="sm" variant="outline" onClick={copySnippet}>
                  {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
                  {copied ? 'Copiado' : 'Copiar'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-lg bg-black/40 p-3 text-xs text-foreground">{snippet}</pre>
            </CardContent>
          </Card>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi icon={Eye} label="Impresiones" value={metrics.totals.impressions} />
            <Kpi
              icon={Play}
              label="Play rate"
              value={`${metrics.totals.playRate}%`}
              sub={`${metrics.totals.plays} plays`}
            />
            <Kpi icon={Percent} label="% medio visto" value={`${metrics.totals.avgPercent}%`} />
            <Kpi
              icon={Flag}
              label="Completado"
              value={`${metrics.totals.completionRate}%`}
              sub={`${metrics.totals.completed} llegan al final`}
            />
          </div>

          {/* Curva de retención */}
          <Card className="dashboard-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-foreground">Retención (cuánta gente sigue viendo)</CardTitle>
            </CardHeader>
            <CardContent>
              {metrics.retention.length > 1 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={metrics.retention} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ret" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={BLUE} stopOpacity={0.55} />
                        <stop offset="100%" stopColor={BLUE} stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="sec" tickFormatter={fmt} stroke="#64748b" fontSize={11} minTickGap={40} />
                    <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} stroke="#64748b" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        background: '#12121f',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelFormatter={(l) => `Min ${fmt(Number(l))}`}
                      formatter={(v: any, _n, p: any) => [`${v}% · ${p.payload.viewers} personas`, 'Retención']}
                    />
                    <Area type="monotone" dataKey="pct" stroke={BLUE} strokeWidth={2} fill="url(#ret)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">Sin datos de visionado todavía.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Puntos de caída */}
            <Card className="dashboard-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-foreground">Mayores caídas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {metrics.drops.length === 0 && <p className="text-sm text-muted-foreground">Sin caídas relevantes.</p>}
                {metrics.drops.map((d, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-black/30 px-3 py-2 text-sm">
                    <span className="text-foreground">
                      Min <span className="font-semibold text-foreground">{fmt(d.sec)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {d.from}% → {d.to}%
                    </span>
                    <span className="font-semibold text-brand-400">−{d.delta}%</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Dispositivos */}
            <Card className="dashboard-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-foreground">Dispositivos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {metrics.devices.map((d) => {
                  const totalDev = metrics.devices.reduce((a, b) => a + b.n, 0) || 1
                  const w = Math.round((d.n / totalDev) * 100)
                  return (
                    <div key={d.device}>
                      <div className="mb-1 flex justify-between text-xs text-foreground">
                        <span className="capitalize">{d.device}</span>
                        <span>
                          {d.n} ({w}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-white/10">
                        <div className="h-full rounded-full" style={{ width: `${w}%`, backgroundColor: BLUE }} />
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>

          {/* Leads identificados */}
          <Card className="dashboard-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base text-foreground">
                <Users className="mr-1 inline h-4 w-4" /> Leads y dónde se quedan
              </CardTitle>
              <span className="text-xs text-muted-foreground">{metrics.leads.length} identificados</span>
            </CardHeader>
            <CardContent>
              {metrics.leads.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nadie identificado aún. Llama a <code className="text-brand-400">tccVSL.identify(email)</code> al
                  enviar el form.
                </p>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="pb-2">Lead</th>
                        <th className="pb-2">Visto</th>
                        <th className="pb-2 text-right">Se queda en</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.leads.map((l, i) => (
                        <tr key={i} className="border-t border-white/5">
                          <td className="py-2">
                            <div className="text-[#e2e8f0]">{l.email}</div>
                            {l.name && <div className="text-xs text-muted-foreground">{l.name}</div>}
                          </td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-24 rounded-full bg-white/10">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${l.pct}%`, backgroundColor: l.reachedEnd ? '#22c55e' : BLUE }}
                                />
                              </div>
                              <span className="text-xs text-foreground">{l.pct}%</span>
                            </div>
                          </td>
                          <td className="py-2 text-right text-foreground">
                            {l.reachedEnd ? '✅ Final' : fmt(l.maxPosition)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const v = videos.find((x) => x.slug === selected)
                if (v) del(v.id)
              }}
              className="text-red-400 hover:text-red-300"
            >
              <Trash2 className="mr-1 h-4 w-4" /> Borrar vídeo
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub }: { icon: any; label: string; value: any; sub?: string }) {
  return (
    <Card className="dashboard-card">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <div className="mt-1 text-2xl font-bold text-foreground">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
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
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const setCfg = (k: keyof VslConfig, v: any) => setConfig((c) => ({ ...c, [k]: v }))

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
    setUploading(kind)
    try {
      if (kind === 'video') {
        const d = await readDuration(file)
        if (d) setDuration(Math.round(d))
      }
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: `/api/${tenant}/evergreen/vsl/upload`,
        contentType: file.type,
      })
      if (kind === 'video') setSourceUrl(blob.url)
      else setPosterUrl(blob.url)
    } catch (e) {
      setErr((e as Error).message || 'Error al subir. ¿Está configurado Vercel Blob (BLOB_READ_WRITE_TOKEN)?')
    } finally {
      setUploading(null)
    }
  }

  const save = async () => {
    setErr(null)
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

          {/* Prueba social */}
          <div className="md:col-span-2 border-t border-white/10 pt-3">
            <Label className="text-foreground">Contador de prueba social</Label>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <select
                value={config.socialProof}
                onChange={(e) => setCfg('socialProof', e.target.value)}
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
