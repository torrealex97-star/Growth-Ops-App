'use client'
import { useTenant } from '@/lib/tenant-context'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import type { Testimonio } from '@/lib/testimonios-shared'
import {
  Camera, RefreshCw, Zap, Play, Heart, MessageCircle, Bookmark, Share2, Eye,
  Users, UserPlus, TrendingUp, Sparkles, FileText, ExternalLink, X, Clock,
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar,
} from 'recharts'

type Media = {
  id: string; external_id: string; media_type: string | null; media_product_type: string | null
  caption: string | null; permalink: string | null; thumbnail_url: string | null; media_url: string | null
  published_at: string | null; reach: number; views: number; likes: number; comments: number
  shares: number; saved: number; total_interactions: number; avg_watch_time: number
  reach_followers: number; reach_non_followers: number; follows: number; engagement_rate: number
  transcript: string | null; transcript_status: string; ai_analysis: ReelAI | null; ai_analyzed_at: string | null
}
type ReelAI = { hook: string; estructura: string; tema: string; por_que_funciona: string; tags: string[] }
type Daily = { snapshot_date: string; followers_count: number; reach: number; profile_views: number; new_follows: number; reach_non_followers: number }
type FbMedia = { external_id: string; description: string | null; permalink: string | null; created_time: string | null; views: number; likes: number; comments: number }
type YoutubeUpload = { ig_media_external_id: string; youtube_video_id: string | null; status: string; views: number; likes: number; comments: number }
type Audience = { dimension: string; bucket: string; value: number }
type Convo = { snapshot_date: string; total_conversations: number; unique_people: number; total_messages: number }

type Tab = 'reels' | 'crecimiento' | 'captacion' | 'conversaciones'
type SortKey = 'views' | 'reach' | 'engagement_rate' | 'saved' | 'follows' | 'published_at'
type Platform = 'all' | 'instagram' | 'facebook' | 'youtube'

const nf = (n: number | null | undefined) => new Intl.NumberFormat('es-ES').format(Math.round(n || 0))
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '—')

export default function InstagramPage() {
  const tenant = useTenant()
  const [media, setMedia] = useState<Media[]>([])
  const [fbMedia, setFbMedia] = useState<FbMedia[]>([])
  const [youtube, setYoutube] = useState<YoutubeUpload[]>([])
  const [daily, setDaily] = useState<Daily[]>([])
  const [audience, setAudience] = useState<Audience[]>([])
  const [convos, setConvos] = useState<Convo[]>([])
  const [detail, setDetail] = useState<Media | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('reels')
  const [platform, setPlatform] = useState<Platform>('all')
  const [sortKey, setSortKey] = useState<SortKey>('views')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [croning, setCroning] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [scriptModal, setScriptModal] = useState<{ mediaId: string; draft: ScriptDraft | null; loading: boolean } | null>(null)
  // Prueba social aplicada a los guiones generados desde esta página.
  const [testimonios, setTestimonios] = useState<Testimonio[]>([])
  const [testimonioPick, setTestimonioPick] = useState('')

  const isAdmin = role === 'admin' || role === 'director' || role === 'manager' || role === 'marketing'

  const load = async () => {
    const sb = createClient()
    const [m, d, a, c, fb, yt] = await Promise.all([
      sb.from('ig_media').select('*').order('published_at', { ascending: false }).limit(500),
      sb.from('ig_account_daily').select('snapshot_date, followers_count, reach, profile_views, new_follows, reach_non_followers').order('snapshot_date'),
      sb.from('ig_audience').select('dimension, bucket, value'),
      sb.from('ig_conversations_daily').select('snapshot_date, total_conversations, unique_people, total_messages').order('snapshot_date'),
      sb.from('fb_media').select('external_id, description, permalink, created_time, views, likes, comments'),
      sb.from('youtube_uploads').select('ig_media_external_id, youtube_video_id, status, views, likes, comments'),
    ])
    setMedia((m.data as Media[]) || [])
    setDaily((d.data as Daily[]) || [])
    setAudience((a.data as Audience[]) || [])
    setConvos((c.data as Convo[]) || [])
    setFbMedia((fb.data as FbMedia[]) || [])
    setYoutube((yt.data as YoutubeUpload[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    const sb = createClient()
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: row } = await sb.from('users').select('roles(key)').eq('id', data.user.id).single()
      setRole((row?.roles as { key?: string } | null)?.key ?? null)
    })
    // Catálogo de casos de éxito para el selector de prueba social.
    fetch(`/api/${tenant}/evergreen/testimonios`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setTestimonios((j.testimonios || []).filter((t: Testimonio) => t.active)))
      .catch(() => {})
    load()
  }, [])

  const runSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/instagram/sync`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Instagram sincronizado', { description: `@${json.username ?? ''} · ${nf(json.followers)} seguidores · ${json.mediaSynced} reels/posts` })
      await load()
    } catch (e) { toast.error('Error al sincronizar', { description: e instanceof Error ? e.message : '' }) }
    finally { setSyncing(false) }
  }
  const runMigrate = async () => {
    setMigrating(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/admin/migrate-instagram`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Base de datos lista', { description: 'Tablas de Instagram creadas' })
    } catch (e) { toast.error('Error en la migración', { description: e instanceof Error ? e.message : '' }) }
    finally { setMigrating(false) }
  }
  const runCron = async () => {
    setCroning(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/admin/setup-instagram-cron`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Sincronización automática activada', { description: 'Cada 6 horas (Supabase pg_cron)' })
    } catch (e) { toast.error('Error activando el cron', { description: e instanceof Error ? e.message : '' }) }
    finally { setCroning(false) }
  }

  const transcribe = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/instagram/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaId: id }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Reel transcrito y analizado')
      await load()
      setExpanded(id)
    } catch (e) { toast.error('No se pudo transcribir', { description: e instanceof Error ? e.message : '' }) }
    finally { setBusyId(null) }
  }

  const genScript = async (id: string, saveAsIdea: boolean) => {
    setScriptModal({ mediaId: id, draft: null, loading: true })
    try {
      const res = await fetch(`/api/${tenant}/evergreen/instagram/script`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaId: id, saveAsIdea, testimonio: testimonioPick || undefined }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setScriptModal({ mediaId: id, draft: json.draft, loading: false })
      if (saveAsIdea && json.ideaId) toast.success('Guión guardado como idea en Contenido')
    } catch (e) {
      toast.error('No se pudo generar el guión', { description: e instanceof Error ? e.message : '' })
      setScriptModal(null)
    }
  }

  const youtubeUploadedCount = youtube.filter((y) => y.status === 'uploaded').length
  const youtubePendingCount = youtube.filter((y) => y.status === 'pending').length
  const youtubeTotalViews = youtube.reduce((s, y) => s + (y.views || 0), 0)
  const matchYoutube = (m: Media): YoutubeUpload | null => youtube.find((y) => y.ig_media_external_id === m.external_id) ?? null

  // Empareja un reel de IG con su cross-post de Facebook. Como algunos captions se
  // repiten, entre los candidatos elige el creado más cerca del publicado en IG:
  // 1) coincidencia de caption (primeros ~40 chars) + fecha más próxima;
  // 2) si no hay caption, el FB creado dentro de ±30 min del publicado en IG.
  const matchFb = (m: Media): FbMedia | null => {
    const norm = (s: string | null) => (s || '').trim().slice(0, 40).toLowerCase()
    const cap = norm(m.caption)
    const igTime = m.published_at ? new Date(m.published_at).getTime() : 0
    const dist = (f: FbMedia) => (igTime && f.created_time ? Math.abs(new Date(f.created_time).getTime() - igTime) : Number.MAX_SAFE_INTEGER)
    let byCaption: FbMedia | null = null
    let byTime: FbMedia | null = null
    for (const f of fbMedia) {
      if (cap && norm(f.description) === cap) {
        if (!byCaption || dist(f) < dist(byCaption)) byCaption = f
      }
      if (igTime && f.created_time && dist(f) < 30 * 60 * 1000) {
        if (!byTime || dist(f) < dist(byTime)) byTime = f
      }
    }
    return byCaption || byTime
  }

  // Filtra por plataforma: "Instagram" = todos (es la base), "Facebook"/"YouTube" = solo los
  // reels que además tengan cross-post/espejo publicado en esa plataforma.
  const platformFiltered = useMemo(() => {
    if (platform === 'facebook') return media.filter((m) => !!matchFb(m))
    if (platform === 'youtube') return media.filter((m) => matchYoutube(m)?.status === 'uploaded')
    return media
  }, [media, platform, fbMedia, youtube])

  const sorted = useMemo(() => {
    const arr = [...platformFiltered]
    arr.sort((a, b) => (sortKey === 'published_at'
      ? new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime()
      : (b[sortKey] as number) - (a[sortKey] as number)))
    return arr
  }, [platformFiltered, sortKey])

  const latest = daily[daily.length - 1]
  const first30 = daily.length > 1 ? daily[Math.max(0, daily.length - 30)] : null
  const growth30 = latest && first30 ? latest.followers_count - first30.followers_count : 0
  const totalReach = media.reduce((s, m) => s + m.reach, 0)
  const analyzed = media.filter((m) => m.ai_analysis).length
  const facebookMatchedCount = media.filter((m) => !!matchFb(m)).length

  const demoBy = (dim: string) => audience.filter((a) => a.dimension === dim).sort((x, y) => y.value - x.value).slice(0, 6)

  if (loading) return <div className="p-6 text-muted-foreground">Cargando…</div>

  const empty = media.length === 0 && daily.length === 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Camera className="w-6 h-6 text-pink-400" /> Instagram orgánico
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Rendimiento de reels, crecimiento y captación</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <button onClick={runSync} disabled={syncing} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-pink-600 text-foreground hover:bg-pink-500 disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
              </button>
              <button onClick={runMigrate} disabled={migrating} title="Ejecutar una vez para preparar la base de datos" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-muted text-foreground hover:bg-muted disabled:opacity-50">
                <Zap className="w-4 h-4" /> {migrating ? 'Aplicando…' : 'Migración IG'}
              </button>
              <button onClick={runCron} disabled={croning} title="Sincronizar automáticamente cada 6 h" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-muted text-foreground hover:bg-muted disabled:opacity-50">
                <Clock className="w-4 h-4" /> {croning ? 'Activando…' : 'Auto 6h'}
              </button>
            </>
          )}
        </div>
      </div>

      {empty && (
        <div className="rounded-xl border border-border bg-card/50 p-6 text-muted-foreground text-sm">
          Aún no hay datos. {isAdmin ? 'Pulsa (en orden) «Migración IG» → «Sincronizar ahora» → «Auto 6h».' : 'Pide a un admin que sincronice Instagram.'}
        </div>
      )}

      {/* Selector de plataforma: elige qué contenido/red ver. "Todo" muestra Instagram (la base
          de todo el contenido); Facebook/YouTube filtran a solo los reels espejados ahí. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <PlatformCard
          active={platform === 'all'}
          onClick={() => setPlatform('all')}
          icon={<Sparkles className="w-5 h-5" />}
          color="brand"
          label="Todo"
          value={nf(media.length)}
          sub="reels totales"
        />
        <PlatformCard
          active={platform === 'instagram'}
          onClick={() => setPlatform('instagram')}
          icon={<Camera className="w-5 h-5" />}
          color="pink"
          label="Instagram"
          value={nf(latest?.followers_count)}
          sub={`${growth30 >= 0 ? '+' : ''}${nf(growth30)} seguidores (30d)`}
        />
        <PlatformCard
          active={platform === 'facebook'}
          onClick={() => setPlatform('facebook')}
          icon={<Share2 className="w-5 h-5" />}
          color="blue"
          label="Facebook"
          value={nf(facebookMatchedCount)}
          sub="reels cross-posteados"
        />
        <PlatformCard
          active={platform === 'youtube'}
          onClick={() => setPlatform('youtube')}
          icon={<Play className="w-5 h-5" />}
          color="red"
          label="YouTube"
          value={nf(youtubeUploadedCount)}
          sub={youtubePendingCount > 0 ? `${nf(youtubeTotalViews)} views · ${nf(youtubePendingCount)} en cola` : `${nf(youtubeTotalViews)} views`}
        />
      </div>

      {/* KPIs de la plataforma seleccionada */}
      {platform === 'all' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon={<Users className="w-4 h-4 text-pink-400" />} label="Seguidores" value={nf(latest?.followers_count)} />
          <Kpi icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} label="Crecimiento 30d" value={`${growth30 >= 0 ? '+' : ''}${nf(growth30)}`} />
          <Kpi icon={<Eye className="w-4 h-4 text-sky-400" />} label="Reach total reels" value={nf(totalReach)} />
          <Kpi icon={<Sparkles className="w-4 h-4 text-brand-400" />} label="Reels analizados" value={`${analyzed}/${media.length}`} />
        </div>
      )}
      {platform === 'instagram' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon={<Users className="w-4 h-4 text-pink-400" />} label="Seguidores" value={nf(latest?.followers_count)} />
          <Kpi icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} label="Crecimiento 30d" value={`${growth30 >= 0 ? '+' : ''}${nf(growth30)}`} />
          <Kpi icon={<Eye className="w-4 h-4 text-sky-400" />} label="Reach total reels" value={nf(totalReach)} />
          <Kpi icon={<Heart className="w-4 h-4 text-pink-400" />} label="Likes totales" value={nf(media.reduce((s, m) => s + m.likes, 0))} />
        </div>
      )}
      {platform === 'facebook' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon={<Share2 className="w-4 h-4 text-blue-400" />} label="Reels en Facebook" value={nf(facebookMatchedCount)} />
          <Kpi icon={<Eye className="w-4 h-4 text-blue-400" />} label="Views Facebook (total)" value={nf(fbMedia.reduce((s, f) => s + f.views, 0))} />
          <Kpi icon={<Heart className="w-4 h-4 text-blue-400" />} label="Likes Facebook (total)" value={nf(fbMedia.reduce((s, f) => s + f.likes, 0))} />
        </div>
      )}
      {platform === 'youtube' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon={<Play className="w-4 h-4 text-red-500" />} label="Shorts en YouTube" value={nf(youtubeUploadedCount)} />
          <Kpi icon={<Eye className="w-4 h-4 text-red-400" />} label="Views YouTube (total)" value={nf(youtubeTotalViews)} />
          <Kpi icon={<Heart className="w-4 h-4 text-red-400" />} label="Likes YouTube (total)" value={nf(youtube.reduce((s, y) => s + (y.likes || 0), 0))} />
          <Kpi icon={<Clock className="w-4 h-4 text-amber-400" />} label="Pendientes de subir (backfill)" value={nf(youtubePendingCount)} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([['reels', 'Top Reels'], ['crecimiento', 'Crecimiento'], ['captacion', 'Captación'], ['conversaciones', 'Conversaciones']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm border-b-2 -mb-px ${tab === k ? 'border-pink-500 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{l}</button>
        ))}
      </div>

      {/* ── Top Reels ── */}
      {tab === 'reels' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Ordenar por:</span>
            {([['views', 'Views'], ['reach', 'Reach'], ['engagement_rate', 'Engagement'], ['saved', 'Guardados'], ['follows', 'Follows'], ['published_at', 'Fecha']] as [SortKey, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setSortKey(k)} className={`px-2 py-1 rounded ${sortKey === k ? 'bg-pink-600 text-foreground' : 'bg-muted text-foreground hover:bg-muted'}`}>{l}</button>
            ))}
            {isAdmin && (
              <label className="flex items-center gap-1.5 ml-auto text-xs" title="Prueba social que se añadirá a los guiones que generes desde aquí">
                <span>Testimonio:</span>
                <select
                  value={testimonioPick}
                  onChange={(e) => setTestimonioPick(e.target.value)}
                  className="bg-muted border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-pink-500 max-w-[190px]"
                >
                  <option value="">Sin testimonio</option>
                  <option value="auto">Auto — la IA elige</option>
                  {testimonios.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
          </div>
          {sorted.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-10">
              Ningún reel {platform === 'facebook' ? 'cross-posteado en Facebook' : platform === 'youtube' ? 'publicado en YouTube' : ''} todavía.
            </p>
          )}
          {sorted.map((m) => (
            <div key={m.id} className="rounded-xl border border-border bg-card/50">
              <div className="flex gap-4 p-3">
                {m.thumbnail_url
                  ? <img src={m.thumbnail_url} alt="" className="w-16 h-20 object-cover rounded-lg bg-muted shrink-0" />
                  : <div className="w-16 h-20 rounded-lg bg-muted flex items-center justify-center shrink-0"><Play className="w-5 h-5 text-muted-foreground" /></div>}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-foreground line-clamp-2">{m.caption || <span className="text-muted-foreground">Sin descripción</span>}</p>
                    <span className="text-xs text-muted-foreground shrink-0">{fecha(m.published_at)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                    <Stat icon={<Eye className="w-3.5 h-3.5" />} v={nf(m.views)} />
                    <Stat icon={<Users className="w-3.5 h-3.5" />} v={nf(m.reach)} />
                    <Stat icon={<Heart className="w-3.5 h-3.5" />} v={nf(m.likes)} />
                    <Stat icon={<MessageCircle className="w-3.5 h-3.5" />} v={nf(m.comments)} />
                    <Stat icon={<Bookmark className="w-3.5 h-3.5" />} v={nf(m.saved)} />
                    <Stat icon={<Share2 className="w-3.5 h-3.5" />} v={nf(m.shares)} />
                    <span className="text-emerald-400">{m.engagement_rate}% eng.</span>
                    {m.follows > 0 && <span className="text-pink-400 flex items-center gap-1"><UserPlus className="w-3.5 h-3.5" />{nf(m.follows)}</span>}
                    {(() => { const f = matchFb(m); return f ? <span className="text-blue-400 flex items-center gap-1" title="Views en Facebook (cross-post)"><Share2 className="w-3.5 h-3.5" />FB {nf(f.views)}</span> : null })()}
                    {(() => {
                      const y = matchYoutube(m)
                      if (!y || y.status !== 'uploaded') return null
                      return (
                        <a href={`https://youtube.com/shorts/${y.youtube_video_id}`} target="_blank" rel="noreferrer" className="text-red-400 flex items-center gap-1 hover:underline" title="Views en YouTube (espejo automático)">
                          <Play className="w-3.5 h-3.5" />YT {nf(y.views)}
                        </a>
                      )
                    })()}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <button onClick={() => setDetail(m)} className="text-xs text-foreground bg-muted hover:bg-muted px-2 py-1 rounded flex items-center gap-1"><Eye className="w-3 h-3" /> Detalle IG+FB</button>
                    {m.permalink && <a href={m.permalink} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Ver</a>}
                    {m.ai_analysis
                      ? <button onClick={() => setExpanded(expanded === m.id ? null : m.id)} className="text-xs text-brand-400 hover:underline flex items-center gap-1"><FileText className="w-3 h-3" /> Análisis</button>
                      : (isAdmin && m.media_url && <button onClick={() => transcribe(m.id)} disabled={busyId === m.id} className="text-xs text-foreground bg-muted hover:bg-muted px-2 py-1 rounded flex items-center gap-1 disabled:opacity-50"><Sparkles className="w-3 h-3" /> {busyId === m.id ? 'Analizando…' : 'Transcribir + analizar'}</button>)}
                    {isAdmin && <button onClick={() => genScript(m.id, false)} className="text-xs text-pink-300 bg-pink-950/40 hover:bg-pink-900/40 px-2 py-1 rounded flex items-center gap-1"><Sparkles className="w-3 h-3" /> Generar guión</button>}
                  </div>
                </div>
              </div>
              {expanded === m.id && m.ai_analysis && (
                <div className="border-t border-border p-3 space-y-2 text-sm">
                  <p><span className="text-muted-foreground">Hook:</span> <span className="text-foreground">{m.ai_analysis.hook}</span></p>
                  <p><span className="text-muted-foreground">Estructura:</span> <span className="text-foreground">{m.ai_analysis.estructura}</span></p>
                  <p><span className="text-muted-foreground">Por qué funciona:</span> <span className="text-foreground">{m.ai_analysis.por_que_funciona}</span></p>
                  {m.ai_analysis.tags?.length > 0 && <div className="flex flex-wrap gap-1">{m.ai_analysis.tags.map((t) => <span key={t} className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{t}</span>)}</div>}
                  {m.transcript && <details className="mt-2"><summary className="text-xs text-muted-foreground cursor-pointer">Transcripción</summary><p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{m.transcript}</p></details>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Crecimiento ── */}
      {tab === 'crecimiento' && (
        <div className="space-y-4">
          <ChartCard title="Seguidores">
            <LineChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="snapshot_date" tickFormatter={fecha} stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} width={50} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }} labelFormatter={fecha} />
              <Line type="monotone" dataKey="followers_count" name="Seguidores" stroke="#ec4899" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartCard>
          <ChartCard title="Reach y visitas al perfil (diario)">
            <LineChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="snapshot_date" tickFormatter={fecha} stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} width={50} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }} labelFormatter={fecha} />
              <Line type="monotone" dataKey="reach" name="Reach" stroke="#38bdf8" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="profile_views" name="Visitas perfil" stroke="#a78bfa" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartCard>
        </div>
      )}

      {/* ── Captación ── */}
      {tab === 'captacion' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card/50 p-4">
            <h3 className="text-sm font-semibold text-foreground mb-1">De dónde viene la gente nueva</h3>
            <p className="text-xs text-muted-foreground mb-3">Reels ordenados por alcance a NO seguidores (descubrimiento) y follows generados. Instagram no da la fuente exacta por seguidor; este es el mejor proxy real.</p>
            <div className="space-y-2">
              {[...media].sort((a, b) => (b.reach_non_followers + b.follows * 100) - (a.reach_non_followers + a.follows * 100)).slice(0, 15).map((m) => (
                <div key={m.id} className="flex items-center gap-3 text-sm">
                  <span className="text-foreground truncate flex-1">{m.caption || 'Sin descripción'}</span>
                  <span className="text-sky-400 text-xs w-28 text-right">{nf(m.reach_non_followers)} no-seg.</span>
                  {m.follows > 0 && <span className="text-pink-400 text-xs w-20 text-right">+{nf(m.follows)} follows</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {[['country', 'País'], ['age', 'Edad'], ['gender', 'Género'], ['city', 'Ciudad']].map(([dim, label]) => {
              const rows = demoBy(dim)
              if (!rows.length) return null
              return (
                <ChartCard key={dim} title={`Audiencia por ${label.toLowerCase()}`}>
                  <BarChart data={rows} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="bucket" stroke="#71717a" fontSize={11} width={70} />
                    <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }} />
                    <Bar dataKey="value" fill="#ec4899" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ChartCard>
              )
            })}
          </div>
          {audience.length === 0 && <p className="text-sm text-muted-foreground">La demografía aparece cuando la cuenta supera ~100 seguidores y tras la primera sincronización.</p>}
        </div>
      )}

      {/* ── Conversaciones ── */}
      {tab === 'conversaciones' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon={<MessageCircle className="w-4 h-4 text-pink-400" />} label="Conversaciones (últ. sync)" value={nf(convos[convos.length - 1]?.total_conversations)} />
            <Kpi icon={<Users className="w-4 h-4 text-sky-400" />} label="Personas" value={nf(convos[convos.length - 1]?.unique_people)} />
            <Kpi icon={<MessageCircle className="w-4 h-4 text-brand-400" />} label="Mensajes" value={nf(convos[convos.length - 1]?.total_messages)} />
            <Kpi icon={<UserPlus className="w-4 h-4 text-emerald-400" />} label="Nuevos seguidores (hoy)" value={`+${nf(latest?.new_follows)}`} />
          </div>
          {convos.length > 0 && (
            <ChartCard title="Conversaciones en el tiempo">
              <LineChart data={convos}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="snapshot_date" tickFormatter={fecha} stroke="#71717a" fontSize={11} />
                <YAxis stroke="#71717a" fontSize={11} width={50} />
                <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }} labelFormatter={fecha} />
                <Line type="monotone" dataKey="total_conversations" name="Conversaciones" stroke="#ec4899" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartCard>
          )}
          <ChartCard title="Nuevos seguidores por día">
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="snapshot_date" tickFormatter={fecha} stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} width={50} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }} labelFormatter={fecha} />
              <Bar dataKey="new_follows" name="Nuevos seguidores" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
          {convos.length === 0 && (
            <div className="rounded-xl border border-border bg-card/50 p-4 text-xs text-muted-foreground space-y-1">
              <p className="text-foreground font-medium">Conteo de conversaciones: pendiente de Acceso Avanzado</p>
              <p>El permiso <code className="text-pink-400">instagram_manage_messages</code> está concedido, pero con <b>Acceso Estándar</b> Meta solo deja listar DMs de usuarios con rol en la app. Con una cuenta de +100k DMs la consulta caduca. Para contar todas las conversaciones hay que solicitar <b>Acceso Avanzado</b> a ese permiso en el panel de la app (App Review) y activar <code className="text-pink-400">IG_ENABLE_DM_SYNC=1</code>. Mientras tanto, «Nuevos seguidores por día» sí funciona.</p>
            </div>
          )}
        </div>
      )}

      {/* Modal de detalle por reel: métricas IG y FB separadas */}
      {detail && (() => {
        const fb = matchFb(detail)
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
            <div className="bg-card border border-border rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex gap-3 min-w-0">
                  {detail.thumbnail_url
                    ? <img src={detail.thumbnail_url} alt="" className="w-14 h-18 object-cover rounded-lg bg-muted shrink-0" />
                    : <div className="w-14 h-18 rounded-lg bg-muted flex items-center justify-center shrink-0"><Play className="w-5 h-5 text-muted-foreground" /></div>}
                  <div className="min-w-0">
                    <p className="text-sm text-foreground line-clamp-2">{detail.caption || 'Sin descripción'}</p>
                    <p className="text-xs text-muted-foreground mt-1">{fecha(detail.published_at)}</p>
                  </div>
                </div>
                <button onClick={() => setDetail(null)} className="text-muted-foreground hover:text-foreground shrink-0"><X className="w-5 h-5" /></button>
              </div>

              {/* Instagram */}
              <div className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-3 mb-3">
                <h4 className="text-sm font-semibold text-pink-300 flex items-center gap-2 mb-2"><Camera className="w-4 h-4" /> Instagram</h4>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-y-2 gap-x-3 text-sm">
                  <Metric label="Views" value={nf(detail.views)} />
                  <Metric label="Reach" value={nf(detail.reach)} />
                  <Metric label="Likes" value={nf(detail.likes)} />
                  <Metric label="Comentarios" value={nf(detail.comments)} />
                  <Metric label="Guardados" value={nf(detail.saved)} />
                  <Metric label="Compartidos" value={nf(detail.shares)} />
                  <Metric label="Interacciones" value={nf(detail.total_interactions)} />
                  <Metric label="Engagement" value={`${detail.engagement_rate}%`} />
                  <Metric label="Seguidores ganados" value={nf(detail.follows)} />
                  <Metric label="Watch time" value={`${nf(detail.avg_watch_time / 1000)}s`} />
                  <Metric label="Reach seguidores" value={nf(detail.reach_followers)} />
                  <Metric label="Reach no-seg." value={nf(detail.reach_non_followers)} />
                </div>
              </div>

              {/* Facebook */}
              <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-3">
                <h4 className="text-sm font-semibold text-blue-300 flex items-center gap-2 mb-2"><Share2 className="w-4 h-4" /> Facebook (cross-post)</h4>
                {fb ? (
                  <div className="grid grid-cols-3 gap-y-2 gap-x-3 text-sm">
                    <Metric label="Views" value={nf(fb.views)} />
                    <Metric label="Likes" value={nf(fb.likes)} />
                    <Metric label="Comentarios" value={nf(fb.comments)} />
                    {fb.permalink && <div className="col-span-3"><a href={fb.permalink} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Ver en Facebook</a></div>}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No se encontró este reel publicado en la página de Facebook.</p>
                )}
              </div>

              {detail.ai_analysis && (
                <div className="mt-3 rounded-lg border border-border p-3 space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Hook:</span> <span className="text-foreground">{detail.ai_analysis.hook}</span></p>
                  <p><span className="text-muted-foreground">Por qué funciona:</span> <span className="text-foreground">{detail.ai_analysis.por_que_funciona}</span></p>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Modal de guión IA */}
      {scriptModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setScriptModal(null)}>
          <div className="bg-card border border-border rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2"><Sparkles className="w-5 h-5 text-pink-400" /> Guión generado</h3>
              <button onClick={() => setScriptModal(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            {scriptModal.loading ? (
              <p className="text-muted-foreground py-8 text-center">Generando guión…</p>
            ) : scriptModal.draft && (
              <div className="space-y-3 text-sm">
                <p className="text-foreground font-semibold text-base">{scriptModal.draft.title}</p>
                <div><span className="text-muted-foreground">Hook:</span> <span className="text-pink-300">{scriptModal.draft.hook}</span></div>
                <div><p className="text-muted-foreground mb-1">Guión:</p><p className="text-foreground whitespace-pre-wrap bg-background/50 rounded-lg p-3">{scriptModal.draft.script}</p></div>
                <div><span className="text-muted-foreground">Caption:</span> <span className="text-foreground">{scriptModal.draft.caption}</span></div>
                <div><span className="text-muted-foreground">Por qué puede rendir mejor:</span> <span className="text-muted-foreground">{scriptModal.draft.notes}</span></div>
                <div className="flex gap-2 pt-2">
                  <button onClick={() => genScript(scriptModal.mediaId, true)} className="px-3 py-2 rounded-lg text-sm bg-pink-600 text-foreground hover:bg-pink-500">Guardar como idea en Contenido</button>
                  <button onClick={() => { navigator.clipboard.writeText(`${scriptModal.draft!.hook}\n\n${scriptModal.draft!.script}\n\n${scriptModal.draft!.caption}`); toast.success('Copiado') }} className="px-3 py-2 rounded-lg text-sm bg-muted text-foreground hover:bg-muted">Copiar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
    </div>
  )
}
const PLATFORM_COLORS = {
  brand: { active: 'border-brand-500 bg-brand-500/10', icon: 'text-brand-400' },
  pink: { active: 'border-pink-500 bg-pink-500/10', icon: 'text-pink-400' },
  blue: { active: 'border-blue-500 bg-blue-500/10', icon: 'text-blue-400' },
  red: { active: 'border-red-500 bg-red-500/10', icon: 'text-red-400' },
} as const

function PlatformCard({ active, onClick, icon, color, label, value, sub }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; color: keyof typeof PLATFORM_COLORS
  label: string; value: string; sub: string
}) {
  const c = PLATFORM_COLORS[color]
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border-2 p-4 transition-colors ${active ? c.active : 'border-border bg-card/50 hover:border-border/80'}`}
    >
      <div className={`flex items-center gap-2 text-sm font-semibold ${active ? c.icon : 'text-muted-foreground'}`}>
        {icon} {label}
      </div>
      <p className="text-2xl font-bold text-foreground mt-2">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </button>
  )
}

function Stat({ icon, v }: { icon: React.ReactNode; v: string }) {
  return <span className="flex items-center gap-1">{icon}{v}</span>
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-foreground font-semibold">{value}</p>
    </div>
  )
}
function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      <ResponsiveContainer width="100%" height={260}>{children}</ResponsiveContainer>
    </div>
  )
}

type ScriptDraft = { title: string; hook: string; script: string; caption: string; notes: string }
