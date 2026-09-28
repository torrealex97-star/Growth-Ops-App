'use client'

// Investigación EXTERNA (brief §16): datos públicos de TERCEROS vía proveedor desacoplado (Apify).
// Cero relación con la cuenta propia — esa vive en las otras pestañas con la API oficial de Meta.
// El dato siempre declara su fuente; los jobs corren asíncronos (§7, §15): se crea el trabajo, la
// UI muestra el estado y sondea; ningún submit duplica ejecuciones (§24).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw, Search, ExternalLink, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import { useTenant, useTenantId } from '@/lib/tenant-context'
import { SOURCE_LABEL } from '@/lib/social/types'
import { formatNumber, formatDateTime } from '@/lib/utils'

type Platform = 'instagram' | 'tiktok' | 'youtube'
type JobType = 'profile' | 'reels'

type Job = {
  id: string
  platform: Platform
  job_type: JobType | 'posts' | 'videos'
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'aborted'
  records_processed: number
  error_message: string | null
  created_at: string
  completed_at: string | null
}

type Profile = {
  id: string
  platform: Platform
  username: string
  display_name: string | null
  followers_count: number | null
  posts_count: number | null
  verified: boolean
  profile_url: string | null
  collected_at: string
  source: string
}

type Post = {
  id: string
  platform: Platform
  external_id: string
  content_type: string | null
  caption: string | null
  post_url: string | null
  thumbnail_url: string | null
  published_at: string | null
  views_count: number | null
  likes_count: number | null
  comments_count: number | null
  shares_count: number | null
  source: string
}

const ESTADO: Record<Job['status'], { label: string; cls: string }> = {
  pending: { label: 'Pendiente', cls: 'bg-muted text-muted-foreground' },
  processing: { label: 'Procesando', cls: 'bg-sky-500/15 text-sky-300' },
  completed: { label: 'Completado', cls: 'bg-emerald-500/15 text-emerald-300' },
  failed: { label: 'Error', cls: 'bg-red-500/15 text-red-300' },
  aborted: { label: 'Abortado', cls: 'bg-amber-500/15 text-amber-300' },
}

export default function InvestigacionPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [enabled, setEnabled] = useState<boolean | null>(null) // null = cargando
  const [platform, setPlatform] = useState<Platform>('instagram')
  const [jobType, setJobType] = useState<JobType>('profile')
  const [users, setUsers] = useState('')
  const [resultsLimit, setResultsLimit] = useState(30)
  const [busy, setBusy] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [posts, setPosts] = useState<Post[]>([])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/${tenant}/evergreen/social/research`)
      if (res.status === 403) return
      const j = await res.json()
      setEnabled(j.enabled)
      setJobs(j.jobs || [])
      setProfiles(j.profiles || [])
      setPosts(j.posts || [])
    } catch {
      setEnabled(false)
    }
  }, [tenant])

  useEffect(() => {
    load()
  }, [load])

  // §15: mientras haya jobs en marcha se sondea cada pocos segundos para mover los estados
  // (Pendiente → Procesando → Completado/Error) sin bloquear la UI.
  const hayEnMarcha = jobs.some((j) => j.status === 'pending' || j.status === 'processing')
  useEffect(() => {
    if (!hayEnMarcha) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [hayEnMarcha, load])

  const lanzar = async () => {
    const usernames = users
      .split(/[\n,]/)
      .map((u) => u.trim().replace(/^@/, ''))
      .filter(Boolean)
    if (!usernames.length) {
      toast.error('Introduce al menos un usuario')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/social/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, jobType, usernames, resultsLimit }),
      })
      const j = await res.json()
      if (!res.ok) {
        toast.error(j.error || 'No se pudo lanzar la investigación')
        if (j.code === 'apify_no_configurado') {
          toast.message('Configúralo en Configuración › Integraciones › Apify')
        }
        return
      }
      toast.success('Investigación en marcha')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const fmt = (n: number | null | undefined) =>
    n == null ? '—' : formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 })

  const jobsRecientes = useMemo(() => jobs.slice(0, 8), [jobs])

  return (
    <div className="space-y-6">
      {/* Aviso de separación arquitectónica (§16) */}
      <div className="rounded-lg border border-brand-500/20 bg-brand-500/10 p-4 text-sm text-foreground">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
          <p>
            <strong>Investigación de terceros</strong>: los datos de esta pestaña proceden de un proveedor externo
            (Apify) sobre contenido <em>público</em> de otras cuentas. Tu cuenta de Instagram no participa en estas
            consultas: las métricas de tu propia cuenta se obtienen exclusivamente con la API oficial de Meta.
          </p>
        </div>
      </div>

      {/* Estado de la integración */}
      {enabled === false && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">
          <strong>Apify no configurado.</strong> Conéctalo en{' '}
          <a href={`/${tenant}/settings/integraciones`} className="underline">
            Configuración › Integraciones
          </a>{' '}
          para usar la investigación externa. El resto del módulo de Instagram sigue funcionando con normalidad.
        </div>
      )}

      {/* Formulario */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Search className="h-4 w-4 text-brand-400" />
          <h3 className="text-sm font-semibold text-foreground">Nueva investigación</h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Plataforma</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="youtube">YouTube</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Qué investigar</label>
            <select
              value={jobType}
              onChange={(e) => setJobType(e.target.value as JobType)}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="profile">Perfil (seguidores, bio, últimos posts)</option>
              <option value="reels">Reels / vídeos recientes</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Usuarios (máx. 10)</label>
            <input
              value={users}
              onChange={(e) => setUsers(e.target.value)}
              placeholder="@competidor1, @competidor2"
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Resultados por perfil</label>
            <input
              type="number"
              min={1}
              max={100}
              value={resultsLimit}
              onChange={(e) => setResultsLimit(Number(e.target.value) || 30)}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Ejecución asíncrona: puedes seguir usando la app; el resultado aparece aquí al terminar.{' '}
            <span>Fuente: Apify · datos públicos de terceros.</span>
          </p>
          <button
            onClick={lanzar}
            disabled={busy || !users.trim()}
            className="inline-flex min-h-10 items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Investigar
          </button>
        </div>
      </div>

      {/* Jobs recientes (§15) */}
      {jobsRecientes.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Investigaciones recientes</h3>
          <div className="space-y-2">
            {jobsRecientes.map((job) => {
              const e = ESTADO[job.status]
              return (
                <div
                  key={job.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${e.cls}`}>{e.label}</span>
                    <span className="text-foreground">
                      {job.platform} · {job.job_type}
                    </span>
                    {(job.status === 'pending' || job.status === 'processing') && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {job.status === 'completed' && (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {job.records_processed} contenidos actualizados
                      </span>
                    )}
                    {job.error_message && <span className="text-red-400">{job.error_message}</span>}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDateTime(job.created_at)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Perfiles investigados */}
      {profiles.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Perfiles investigados</h3>
            <button
              onClick={load}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Actualizar
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Usuario</th>
                  <th className="py-2 pr-4 font-medium">Plataforma</th>
                  <th className="py-2 pr-4 text-right font-medium">Seguidores</th>
                  <th className="py-2 pr-4 text-right font-medium">Posts</th>
                  <th className="py-2 pr-4 font-medium">Recogido</th>
                  <th className="py-2 font-medium">Fuente</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-b border-border/60">
                    <td className="py-2 pr-4">
                      <a
                        href={p.profile_url || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-foreground hover:text-brand-300"
                      >
                        {p.display_name || p.username}
                        {p.verified && <span title="verificado">✓</span>}
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </a>
                    </td>
                    <td className="py-2 pr-4 capitalize text-muted-foreground">{p.platform}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmt(p.followers_count)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmt(p.posts_count)}</td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {new Date(p.collected_at).toLocaleDateString('es-ES')}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">{SOURCE_LABEL.external}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Contenido investigado */}
      {posts.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Contenido investigado</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {posts.slice(0, 24).map((p) => (
              <a
                key={p.id}
                href={p.post_url || '#'}
                target="_blank"
                rel="noreferrer"
                className="group rounded-lg border border-border bg-background/30 p-3 transition-colors hover:border-brand-500/40"
              >
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="uppercase">
                    {p.platform} · {p.content_type || 'post'}
                  </span>
                  <ExternalLink className="h-3 w-3" />
                </div>
                {p.caption && <p className="mb-2 line-clamp-2 text-sm text-foreground">{p.caption}</p>}
                <div className="grid grid-cols-4 gap-1 text-center text-xs text-muted-foreground">
                  <div>
                    <div className="font-semibold tabular-nums">{fmt(p.views_count)}</div>
                    <div>views</div>
                  </div>
                  <div>
                    <div className="font-semibold tabular-nums">{fmt(p.likes_count)}</div>
                    <div>likes</div>
                  </div>
                  <div>
                    <div className="font-semibold tabular-nums">{fmt(p.comments_count)}</div>
                    <div>comm</div>
                  </div>
                  <div>
                    <div className="font-semibold tabular-nums">{fmt(p.shares_count)}</div>
                    <div>shares</div>
                  </div>
                </div>
                <div className="mt-2 text-3xs text-muted-foreground">{SOURCE_LABEL.external}</div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Estado vacío honesto */}
      {enabled !== null && enabled !== false && !jobs.length && !profiles.length && !posts.length && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Todavía no hay investigaciones. Lanza la primera arriba.
        </div>
      )}
    </div>
  )
}
