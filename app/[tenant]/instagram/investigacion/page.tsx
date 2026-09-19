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
  pending: { label: 'Pendiente', cls: 'bg-zinc-100 text-zinc-600' },
  processing: { label: 'Procesando', cls: 'bg-blue-50 text-blue-600' },
  completed: { label: 'Completado', cls: 'bg-emerald-50 text-emerald-600' },
  failed: { label: 'Error', cls: 'bg-red-50 text-red-600' },
  aborted: { label: 'Abortado', cls: 'bg-amber-50 text-amber-600' },
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
    n == null ? '—' : new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

  const jobsRecientes = useMemo(() => jobs.slice(0, 8), [jobs])

  return (
    <div className="space-y-6">
      {/* Aviso de separación arquitectónica (§16) */}
      <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-900">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          <p>
            <strong>Investigación de terceros</strong>: los datos de esta pestaña proceden de un proveedor externo
            (Apify) sobre contenido <em>público</em> de otras cuentas. Tu cuenta de Instagram no participa en estas
            consultas: las métricas de tu propia cuenta se obtienen exclusivamente con la API oficial de Meta.
          </p>
        </div>
      </div>

      {/* Estado de la integración */}
      {enabled === false && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Apify no configurado.</strong> Conéctalo en{' '}
          <a href={`/${tenant}/settings/integraciones`} className="underline">
            Configuración › Integraciones
          </a>{' '}
          para usar la investigación externa. El resto del módulo de Instagram sigue funcionando con normalidad.
        </div>
      )}

      {/* Formulario */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Search className="h-4 w-4 text-zinc-500" />
          <h3 className="text-sm font-semibold text-zinc-900">Nueva investigación</h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Plataforma</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            >
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="youtube">YouTube</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Qué investigar</label>
            <select
              value={jobType}
              onChange={(e) => setJobType(e.target.value as JobType)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            >
              <option value="profile">Perfil (seguidores, bio, últimos posts)</option>
              <option value="reels">Reels / vídeos recientes</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Usuarios (máx. 10)</label>
            <input
              value={users}
              onChange={(e) => setUsers(e.target.value)}
              placeholder="@competidor1, @competidor2"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Resultados por perfil</label>
            <input
              type="number"
              min={1}
              max={100}
              value={resultsLimit}
              onChange={(e) => setResultsLimit(Number(e.target.value) || 30)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            Ejecución asíncrona: puedes seguir usando la app; el resultado aparece aquí al terminar.{' '}
            <span className="text-zinc-400">Fuente: Apify · datos públicos de terceros.</span>
          </p>
          <button
            onClick={lanzar}
            disabled={busy || !users.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Investigar
          </button>
        </div>
      </div>

      {/* Jobs recientes (§15) */}
      {jobsRecientes.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-zinc-900">Investigaciones recientes</h3>
          <div className="space-y-2">
            {jobsRecientes.map((job) => {
              const e = ESTADO[job.status]
              return (
                <div
                  key={job.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${e.cls}`}>{e.label}</span>
                    <span className="text-zinc-700">
                      {job.platform} · {job.job_type}
                    </span>
                    {(job.status === 'pending' || job.status === 'processing') && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    {job.status === 'completed' && (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {job.records_processed} contenidos actualizados
                      </span>
                    )}
                    {job.error_message && <span className="text-red-600">{job.error_message}</span>}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(job.created_at).toLocaleString('es-ES')}
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
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900">Perfiles investigados</h3>
            <button onClick={load} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800">
              <RefreshCw className="h-3.5 w-3.5" /> Actualizar
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
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
                  <tr key={p.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-4">
                      <a
                        href={p.profile_url || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-zinc-900 hover:underline"
                      >
                        {p.display_name || p.username}
                        {p.verified && <span title="verificado">✓</span>}
                        <ExternalLink className="h-3 w-3 text-zinc-400" />
                      </a>
                    </td>
                    <td className="py-2 pr-4 capitalize text-zinc-600">{p.platform}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmt(p.followers_count)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmt(p.posts_count)}</td>
                    <td className="py-2 pr-4 text-zinc-500">{new Date(p.collected_at).toLocaleDateString('es-ES')}</td>
                    <td className="py-2 text-xs text-zinc-400">{SOURCE_LABEL.external}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Contenido investigado */}
      {posts.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-zinc-900">Contenido investigado</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {posts.slice(0, 24).map((p) => (
              <a
                key={p.id}
                href={p.post_url || '#'}
                target="_blank"
                rel="noreferrer"
                className="group rounded-xl border border-zinc-200 p-3 transition hover:border-zinc-300 hover:shadow-sm"
              >
                <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
                  <span className="uppercase">
                    {p.platform} · {p.content_type || 'post'}
                  </span>
                  <ExternalLink className="h-3 w-3" />
                </div>
                {p.caption && <p className="mb-2 line-clamp-2 text-sm text-zinc-800">{p.caption}</p>}
                <div className="grid grid-cols-4 gap-1 text-center text-xs text-zinc-600">
                  <div>
                    <div className="font-semibold tabular-nums">{fmt(p.views_count)}</div>
                    <div className="text-zinc-400">views</div>
                  </div>
                  <div>
                    <div className="font-semibold tabular-nums">{fmt(p.likes_count)}</div>
                    <div className="text-zinc-400">likes</div>
                  </div>
                  <div>
                    <div className="font-semibold tabular-nums">{fmt(p.comments_count)}</div>
                    <div className="text-zinc-400">comm</div>
                  </div>
                  <div>
                    <div className="font-semibold tabular-nums">{fmt(p.shares_count)}</div>
                    <div className="text-zinc-400">shares</div>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-zinc-400">{SOURCE_LABEL.external}</div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Estado vacío honesto */}
      {enabled !== null && enabled !== false && !jobs.length && !profiles.length && !posts.length && (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500">
          Todavía no hay investigaciones. Lanza la primera arriba.
        </div>
      )}
    </div>
  )
}
