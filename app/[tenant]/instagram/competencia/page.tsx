'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Radar,
  Plus,
  RefreshCw,
  Trash2,
  Play,
  Heart,
  MessageCircle,
  ExternalLink,
  Sparkles,
  X,
  Wand2,
  Settings2,
  Save,
  Link2,
  FileText,
  Copy,
  CheckSquare,
  Square,
  Zap,
  Check,
  AlertTriangle,
} from 'lucide-react'
import { CTAS } from '@/lib/ctas'
import type { Testimonio } from '@/lib/testimonios-shared'
import { createClient } from '@/lib/supabase/client'
import { useScriptQueue } from '@/components/os/ScriptQueue'
import { useTenant } from '@/lib/tenant-context'

type Competitor = {
  id: string
  username: string
  followers_count: number
  media_count: number
  last_synced_at: string | null
}
type CMedia = {
  id: string
  competitor_id: string
  caption: string | null
  media_product_type: string | null
  like_count: number
  comments_count: number
  engagement_proxy: number
  permalink: string | null
  media_url: string | null
  thumbnail_url: string | null
  published_at: string | null
  transcript: string | null
  ai_analysis: ReelAI | null
}
type ReelAI = { hook: string; estructura: string; tema: string; por_que_funciona: string; tags: string[] }
type ScriptDraft = {
  title: string
  hook: string
  script: string
  caption: string
  notes: string
  cta_used?: string
  testimonio_used?: string
}
type GenState = {
  cmId: string
  phase: 'prep' | 'loading' | 'result'
  transcript: string
  instruction: string
  cta: string // '' = auto
  testimonio: string // '' = sin testimonio, 'auto' = la IA elige, o el id de un caso
  draft: ScriptDraft | null
  saving: boolean
}

const nf = (n: number | null | undefined) => new Intl.NumberFormat('es-ES').format(Math.round(n || 0))
const fecha = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '—'
const normUrl = (u: string | null) => (u || '').split('?')[0].split('#')[0].replace(/\/$/, '').toLowerCase()

export default function CompetenciaPage() {
  const tenant = useTenant()
  const { enqueue } = useScriptQueue()
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [media, setMedia] = useState<CMedia[]>([])
  const [ideaUrls, setIdeaUrls] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [username, setUsername] = useState('')
  const [adding, setAdding] = useState(false)
  const [reelUrl, setReelUrl] = useState('')
  const [reelUser, setReelUser] = useState('')
  const [addingReel, setAddingReel] = useState(false)
  const [selected, setSelected] = useState<string | 'all'>('all')
  const [sortBy, setSortBy] = useState<'engagement' | 'fecha'>('engagement')
  const [gen, setGen] = useState<GenState | null>(null)
  const [testimonios, setTestimonios] = useState<Testimonio[]>([])
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set())
  const [refreshingAll, setRefreshingAll] = useState(false)

  // Selección múltiple + preferencia de auto-guardado
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [autoIdea, setAutoIdea] = useState(true)
  // Prueba social aplicada a los guiones que se generan en lote desde la cola.
  const [bulkTestimonio, setBulkTestimonio] = useState('')

  // Ajustes: estilo + contexto de negocio
  const [settingsTab, setSettingsTab] = useState<'estilo' | 'negocio' | null>(null)
  const [style, setStyle] = useState('')
  const [business, setBusiness] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)

  const load = async () => {
    try {
      const res = await fetch(`/api/${tenant}/evergreen/instagram/competitors`)
      const json = await res.json()
      if (res.ok) {
        setCompetitors(json.competitors || [])
        setMedia(json.media || [])
      }
    } finally {
      setLoading(false)
    }
  }
  // Reels que ya se convirtieron en idea (para marcarlos en las tarjetas).
  const loadIdeas = async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('content_items')
      .select('reference_reel_url')
      .not('reference_reel_url', 'is', null)
    setIdeaUrls(
      new Set(
        (data || []).map((r: { reference_reel_url: string | null }) => normUrl(r.reference_reel_url)).filter(Boolean)
      )
    )
  }
  useEffect(() => {
    load()
    loadIdeas()
    fetch(`/api/${tenant}/evergreen/settings/ig-style?key=ig_style_prompt`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setStyle(j.prompt || ''))
    fetch(`/api/${tenant}/evergreen/settings/ig-style?key=ig_business_context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setBusiness(j.prompt || ''))
    // Catálogo de casos de éxito para el selector de prueba social del guión.
    fetch(`/api/${tenant}/evergreen/testimonios`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setTestimonios((j.testimonios || []).filter((t: Testimonio) => t.active)))
  }, [])
  // Al volver a la pestaña, refresca qué reels ya están en Ideas (la cola pudo añadir alguno).
  useEffect(() => {
    const onFocus = () => loadIdeas()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const addCompetitor = async () => {
    const u = username.trim().replace(/^@/, '')
    if (!u) return
    setAdding(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/instagram/competitors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(`@${json.username} analizado`, {
        description: `${nf(json.followers)} seguidores · ${json.reelsSynced} reels`,
      })
      setUsername('')
      await load()
    } catch (e) {
      toast.error('No se pudo analizar', { description: e instanceof Error ? e.message : '' })
    } finally {
      setAdding(false)
    }
  }

  const addReel = async () => {
    if (!reelUrl.trim()) return
    setAddingReel(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/instagram/competitors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reelUrl: reelUrl.trim(), username: reelUser.trim().replace(/^@/, '') || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Reel añadido', { description: `@${json.username}` })
      setReelUrl('')
      setReelUser('')
      await load()
      if (json.competitorMediaId) openGen(json.competitorMediaId, [])
    } catch (e) {
      toast.error('No se pudo añadir el reel', { description: e instanceof Error ? e.message : '' })
    } finally {
      setAddingReel(false)
    }
  }

  const removeCompetitor = async (id: string) => {
    if (!confirm('¿Eliminar este competidor y sus reels?')) return
    const res = await fetch(`/api/${tenant}/evergreen/instagram/competitors?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      if (selected === id) setSelected('all')
      await load()
    } else toast.error('No se pudo eliminar')
  }

  // Re-sincroniza un competidor (sus 50 reels más recientes) sin tener que borrarlo y volver a añadirlo.
  const refreshCompetitor = async (c: Competitor) => {
    setRefreshing((prev) => new Set(prev).add(c.id))
    try {
      const res = await fetch(`/api/${tenant}/evergreen/instagram/competitors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: c.username }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(`@${c.username} actualizado`, {
        description: `${nf(json.followers)} seguidores · ${json.reelsSynced} reels`,
      })
      await load()
    } catch (e) {
      toast.error(`No se pudo actualizar @${c.username}`, { description: e instanceof Error ? e.message : '' })
    } finally {
      setRefreshing((prev) => {
        const next = new Set(prev)
        next.delete(c.id)
        return next
      })
    }
  }

  const refreshAllCompetitors = async () => {
    setRefreshingAll(true)
    try {
      let ok = 0
      for (const c of competitors) {
        await refreshCompetitor(c)
        ok++
      }
      toast.success(`${ok} perfil${ok === 1 ? '' : 'es'} actualizado${ok === 1 ? '' : 's'}`)
    } finally {
      setRefreshingAll(false)
    }
  }

  // Abre el generador: asegura la transcripción (transcribe si hace falta) y muestra el prep.
  const openGen = async (cmId: string, fromList: CMedia[]) => {
    const list = fromList.length ? fromList : media
    const m = list.find((x) => x.id === cmId)
    setGen({
      cmId,
      phase: 'prep',
      transcript: m?.transcript || '',
      instruction: '',
      cta: '',
      testimonio: '',
      draft: null,
      saving: false,
    })
    if (!m?.transcript) {
      try {
        const t = await fetch(`/api/${tenant}/evergreen/instagram/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ competitorMediaId: cmId }),
        })
        const tj = await t.json()
        if (t.ok && tj.transcript) {
          setGen((g) => (g && g.cmId === cmId ? { ...g, transcript: tj.transcript } : g))
          await load()
        } else if (!t.ok) {
          toast.error('No se pudo transcribir automáticamente', {
            description: tj.error || 'Pega la transcripción a mano.',
          })
        }
      } catch {
        toast.error('No se pudo transcribir. Pega la transcripción a mano.')
      }
    }
  }

  const generate = async () => {
    if (!gen) return
    setGen({ ...gen, phase: 'loading' })
    try {
      const res = await fetch(`/api/${tenant}/evergreen/instagram/script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          competitorMediaId: gen.cmId,
          transcript: gen.transcript || undefined,
          instruction: gen.instruction || undefined,
          cta: gen.cta || undefined,
          testimonio: gen.testimonio || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setGen((g) => (g ? { ...g, phase: 'result', draft: json.draft } : g))
    } catch (e) {
      toast.error('No se pudo generar el guión', { description: e instanceof Error ? e.message : '' })
      setGen((g) => (g ? { ...g, phase: 'prep' } : g))
    }
  }

  const saveIdea = async () => {
    if (!gen) return
    setGen({ ...gen, saving: true })
    try {
      const res = await fetch(`/api/${tenant}/evergreen/instagram/script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          competitorMediaId: gen.cmId,
          transcript: gen.transcript || undefined,
          instruction: gen.instruction || undefined,
          cta: gen.cta || undefined,
          testimonio: gen.testimonio || undefined,
          saveAsIdea: true,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      if (json.ideaId) toast.success('Añadido a Contenido como IDEA')
      else throw new Error('No se creó la idea (revisa Contenido)')
      setGen(null)
      await load()
      await loadIdeas()
    } catch (e) {
      toast.error('No se pudo añadir a IDEA', { description: e instanceof Error ? e.message : '' })
      setGen((g) => (g ? { ...g, saving: false } : g))
    }
  }

  const saveSettings = async () => {
    if (!settingsTab) return
    setSavingSettings(true)
    try {
      const key = settingsTab === 'estilo' ? 'ig_style_prompt' : 'ig_business_context'
      const prompt = settingsTab === 'estilo' ? style : business
      const res = await fetch(`/api/${tenant}/evergreen/settings/ig-style`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, prompt }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Guardado')
      setSettingsTab(null)
    } catch (e) {
      toast.error('No se pudo guardar', { description: e instanceof Error ? e.message : '' })
    } finally {
      setSavingSettings(false)
    }
  }

  const shown = useMemo(() => {
    const arr = selected === 'all' ? media : media.filter((m) => m.competitor_id === selected)
    if (sortBy === 'fecha') {
      return [...arr].sort((a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime())
    }
    return [...arr].sort((a, b) => b.engagement_proxy - a.engagement_proxy)
  }, [media, selected, sortBy])

  const usernameOf = (competitorId: string) => competitors.find((c) => c.id === competitorId)?.username || 'reel'
  const isInIdeas = (m: CMedia) => !!m.permalink && ideaUrls.has(normUrl(m.permalink))

  // ── Selección múltiple ────────────────────────────────────────────────────────
  const toggleCheck = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allShownChecked = shown.length > 0 && shown.every((m) => checked.has(m.id))
  const toggleAllShown = () =>
    setChecked((prev) => {
      if (allShownChecked) {
        const next = new Set(prev)
        shown.forEach((m) => next.delete(m.id))
        return next
      }
      const next = new Set(prev)
      shown.forEach((m) => next.add(m.id))
      return next
    })

  const enqueueSelected = () => {
    const items = Array.from(checked)
      .map((id) => media.find((x) => x.id === id))
      .filter((m): m is CMedia => !!m)
      .map((m) => ({
        cmId: m.id,
        label: `@${usernameOf(m.competitor_id)}`,
        permalink: m.permalink,
        transcript: m.transcript || '',
        save: autoIdea,
        testimonio: bulkTestimonio,
      }))
    const n = enqueue(items)
    if (n === 0) {
      toast.info('Nada nuevo que encolar (ya están en cola o hechos)')
      return
    }
    setChecked(new Set())
    toast.success(`${n} en cola`, {
      description: autoIdea ? 'Se guardarán solos en Ideas al terminar' : 'Te avisaré para revisarlos',
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Radar className="w-6 h-6 text-pink-400" /> Análisis de competencia
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Sus mejores reels, transcritos y listos para replicar a tu estilo con tus CTAs
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setSettingsTab('estilo')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-muted text-foreground hover:bg-muted"
          >
            <Settings2 className="w-4 h-4" /> Estilo
          </button>
          <button
            onClick={() => setSettingsTab('negocio')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-muted text-foreground hover:bg-muted"
          >
            <Settings2 className="w-4 h-4" /> Negocio y CTAs
          </button>
        </div>
      </div>

      {/* Añadir: perfil completo o reel suelto por enlace */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <label className="text-xs text-muted-foreground">Analizar un perfil (cuenta profesional pública)</label>
          <div className="flex gap-2 mt-1">
            <div className="flex-1 flex items-center gap-1 bg-muted border border-border rounded-lg px-3">
              <span className="text-muted-foreground">@</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCompetitor()}
                placeholder="usuario"
                className="flex-1 bg-transparent py-2 text-sm text-foreground focus:outline-none"
              />
            </div>
            <button
              onClick={addCompetitor}
              disabled={adding}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-pink-600 text-foreground hover:bg-pink-500 disabled:opacity-50"
            >
              {adding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{' '}
              {adding ? 'Analizando…' : 'Analizar'}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Se ordena por likes + comentarios (la API no da views de terceros).
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <label className="text-xs text-muted-foreground">…o pega el enlace de un reel concreto</label>
          <div className="flex gap-2 mt-1">
            <div className="flex-1 flex items-center gap-1 bg-muted border border-border rounded-lg px-3">
              <Link2 className="w-4 h-4 text-muted-foreground" />
              <input
                value={reelUrl}
                onChange={(e) => setReelUrl(e.target.value)}
                placeholder="https://instagram.com/reel/…"
                className="flex-1 bg-transparent py-2 text-sm text-foreground focus:outline-none"
              />
            </div>
            <input
              value={reelUser}
              onChange={(e) => setReelUser(e.target.value)}
              placeholder="@usuario"
              className="w-28 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none"
            />
            <button
              onClick={addReel}
              disabled={addingReel}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {addingReel ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Si el enlace no lleva el usuario, ponlo en @usuario. Debe ser un reel reciente y público.
          </p>
        </div>
      </div>

      {/* Filtro por competidor + seleccionar todos */}
      {competitors.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelected('all')}
            className={`px-3 py-1.5 rounded-full text-xs ${selected === 'all' ? 'bg-pink-600 text-foreground' : 'bg-muted text-foreground hover:bg-muted'}`}
          >
            Todos
          </button>
          {competitors.map((c) => (
            <span
              key={c.id}
              className={`group flex items-center gap-1 rounded-full text-xs ${selected === c.id ? 'bg-pink-600 text-foreground' : 'bg-muted text-foreground'}`}
            >
              <button
                onClick={() => setSelected(c.id)}
                title={
                  c.last_synced_at
                    ? `Última actualización: ${new Date(c.last_synced_at).toLocaleString('es-ES')}`
                    : 'Sin sincronizar'
                }
                className="pl-3 py-1.5"
              >
                @{c.username} · {nf(c.followers_count)}
              </button>
              <button
                onClick={() => refreshCompetitor(c)}
                disabled={refreshing.has(c.id)}
                title="Actualizar (re-sincronizar reels recientes)"
                className="py-1.5 text-muted-foreground hover:text-emerald-400 disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${refreshing.has(c.id) ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => removeCompetitor(c.id)}
                className="pr-2 pl-1 py-1.5 text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </span>
          ))}
          {competitors.length > 1 && (
            <button
              onClick={refreshAllCompetitors}
              disabled={refreshingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-muted text-foreground hover:bg-card disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${refreshingAll ? 'animate-spin' : ''}`} /> Actualizar todos
            </button>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-muted-foreground">Ordenar:</span>
            <button
              onClick={() => setSortBy('engagement')}
              className={`px-3 py-1.5 rounded-full text-xs ${sortBy === 'engagement' ? 'bg-pink-600 text-foreground' : 'bg-muted text-foreground hover:bg-muted'}`}
            >
              Engagement
            </button>
            <button
              onClick={() => setSortBy('fecha')}
              className={`px-3 py-1.5 rounded-full text-xs ${sortBy === 'fecha' ? 'bg-pink-600 text-foreground' : 'bg-muted text-foreground hover:bg-muted'}`}
            >
              Fecha subida
            </button>
          </div>
          {shown.length > 0 && (
            <button
              onClick={toggleAllShown}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-muted text-foreground hover:bg-card"
            >
              {allShownChecked ? (
                <CheckSquare className="w-3.5 h-3.5 text-pink-400" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              {allShownChecked ? 'Quitar selección' : 'Seleccionar todos'}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="h-64 bg-card rounded-lg animate-pulse" />
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/50 p-6 text-sm text-muted-foreground">
          {competitors.length === 0
            ? 'Añade un perfil o pega un enlace de reel para empezar.'
            : 'Este competidor no tiene reels públicos legibles.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {shown.map((m) => {
            const isChecked = checked.has(m.id)
            const inIdeas = isInIdeas(m)
            return (
              <div
                key={m.id}
                className={`relative rounded-xl border bg-card/50 flex flex-col ${isChecked ? 'border-pink-500 ring-1 ring-pink-500/40' : 'border-border'}`}
              >
                {/* Checkbox de selección */}
                <button
                  onClick={() => toggleCheck(m.id)}
                  className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-md flex items-center justify-center border ${isChecked ? 'bg-pink-600 border-pink-500 text-white' : 'bg-card/90 border-border text-muted-foreground hover:text-foreground'}`}
                  title={isChecked ? 'Quitar de la selección' : 'Seleccionar'}
                >
                  {isChecked ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                </button>
                {/* Marca "Ya en Ideas" */}
                {inIdeas && (
                  <span
                    className="absolute top-2 right-2 z-10 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    title="Ya generaste un guión de este reel"
                  >
                    <Check className="w-3 h-3" /> En Ideas
                  </span>
                )}
                <div className="flex gap-3 p-3 pl-10">
                  {m.thumbnail_url ? (
                    <img src={m.thumbnail_url} alt="" className="w-16 h-20 object-cover rounded-lg bg-muted shrink-0" />
                  ) : (
                    <div className="w-16 h-20 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Play className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground line-clamp-3">
                      {m.caption || <span className="text-muted-foreground">Sin descripción</span>}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Heart className="w-3.5 h-3.5" />
                        {nf(m.like_count)}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle className="w-3.5 h-3.5" />
                        {nf(m.comments_count)}
                      </span>
                      <span className="text-muted-foreground">{fecha(m.published_at)}</span>
                      {m.transcript && (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          transcrito
                        </span>
                      )}
                      {!m.transcript && !m.media_url && (
                        <span
                          className="text-amber-400 flex items-center gap-1"
                          title="Instagram no entrega el vídeo de este reel vía API (pasa con muchos Reels de terceros). Probablemente no se pueda transcribir."
                        >
                          <AlertTriangle className="w-3 h-3" />
                          vídeo no disponible
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-auto border-t border-border p-2 flex flex-wrap items-center gap-2">
                  {m.permalink && (
                    <a
                      href={m.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-sky-400 hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" /> Ver
                    </a>
                  )}
                  <button
                    onClick={() => openGen(m.id, shown)}
                    className="text-xs text-pink-300 bg-pink-950/40 hover:bg-pink-900/40 px-2 py-1 rounded flex items-center gap-1"
                  >
                    <Wand2 className="w-3 h-3" /> Crear guión
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Barra de selección múltiple (flotante inferior) */}
      {checked.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center gap-3 bg-card border border-border rounded-xl shadow-2xl px-4 py-3">
          <span className="text-sm text-foreground font-medium">
            {checked.size} seleccionado{checked.size === 1 ? '' : 's'}
          </span>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoIdea}
              onChange={(e) => setAutoIdea(e.target.checked)}
              className="accent-pink-500"
            />
            Auto a Ideas
          </label>
          <select
            value={bulkTestimonio}
            onChange={(e) => setBulkTestimonio(e.target.value)}
            title="Prueba social para todos los guiones del lote"
            className="bg-muted border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-pink-500 max-w-[190px]"
          >
            <option value="">Sin testimonio</option>
            <option value="auto">Testimonio: auto</option>
            {testimonios.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={enqueueSelected}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-pink-600 text-white hover:bg-pink-500"
          >
            <Zap className="w-4 h-4" /> Transcribir + generar guiones
          </button>
          <button onClick={() => setChecked(new Set())} className="text-xs text-muted-foreground hover:text-foreground">
            Cancelar
          </button>
        </div>
      )}

      {/* Modal de ajustes (estilo / negocio) */}
      {settingsTab && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSettingsTab(null)}
        >
          <div
            className="bg-card border border-border rounded-xl p-5 w-full max-w-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex gap-1">
                <button
                  onClick={() => setSettingsTab('estilo')}
                  className={`px-3 py-1.5 rounded-lg text-sm ${settingsTab === 'estilo' ? 'bg-pink-600 text-foreground' : 'bg-muted text-foreground'}`}
                >
                  Estilo
                </button>
                <button
                  onClick={() => setSettingsTab('negocio')}
                  className={`px-3 py-1.5 rounded-lg text-sm ${settingsTab === 'negocio' ? 'bg-pink-600 text-foreground' : 'bg-muted text-foreground'}`}
                >
                  Negocio y CTAs
                </button>
              </div>
              <button onClick={() => setSettingsTab(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            {settingsTab === 'estilo' ? (
              <>
                <p className="text-xs text-muted-foreground mb-2">
                  Tono, público, tipo de ganchos, cosas a evitar. Se aplica SIEMPRE al generar guiones.
                </p>
                <textarea
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  rows={10}
                  placeholder="Ej: Tono directo y con autoridad, español de España…"
                  className="w-full bg-muted border border-border rounded-lg p-3 text-sm text-foreground focus:outline-none focus:border-pink-500"
                />
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-2">
                  Modelo de negocio, avatares y funnel. La IA lo usa para ennichar el guión hacia tu oferta. Los 6 CTAs
                  están definidos abajo (para editar sus enlaces avísame).
                </p>
                <textarea
                  value={business}
                  onChange={(e) => setBusiness(e.target.value)}
                  rows={8}
                  placeholder="Describe tu negocio, avatares y funnel…"
                  className="w-full bg-muted border border-border rounded-lg p-3 text-sm text-foreground focus:outline-none focus:border-pink-500"
                />
                <div className="mt-2 text-[11px] text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
                  {CTAS.map((c) => (
                    <div key={c.code}>
                      <span className="text-pink-400 font-medium">{c.code}</span> — {c.description}
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setSettingsTab(null)} className="px-3 py-2 text-sm text-muted-foreground">
                Cerrar
              </button>
              <button
                onClick={saveSettings}
                disabled={savingSettings}
                className="px-3 py-2 text-sm bg-pink-600 text-foreground rounded-lg flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="w-4 h-4" /> Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal generador de guión (flujo individual) */}
      {gen && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setGen(null)}
        >
          <div
            className="bg-card border border-border rounded-xl max-w-2xl w-full max-h-[88vh] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-pink-400" /> Crear guión a tu estilo
              </h3>
              <button onClick={() => setGen(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {gen.phase !== 'result' && (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-muted-foreground">
                      Transcripción del reel de referencia (edítala o pégala)
                    </label>
                    {gen.transcript && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(gen.transcript)
                          toast.success('Transcripción copiada')
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" /> Copiar
                      </button>
                    )}
                  </div>
                  <textarea
                    value={gen.transcript}
                    onChange={(e) => setGen({ ...gen, transcript: e.target.value })}
                    rows={7}
                    placeholder="Transcribiendo… o pega aquí la transcripción del vídeo."
                    className="w-full bg-muted border border-border rounded-lg p-3 text-sm text-foreground focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">CTA de cierre</label>
                    <select
                      value={gen.cta}
                      onChange={(e) => setGen({ ...gen, cta: e.target.value })}
                      className="w-full mt-1 bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground focus:outline-none focus:border-pink-500"
                    >
                      <option value="">Auto (mejor encaje)</option>
                      {CTAS.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Prueba social (testimonio)</label>
                    <select
                      value={gen.testimonio}
                      onChange={(e) => setGen({ ...gen, testimonio: e.target.value })}
                      className="w-full mt-1 bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground focus:outline-none focus:border-pink-500"
                    >
                      <option value="">Sin testimonio</option>
                      <option value="auto">Auto — la IA elige el que mejor encaje</option>
                      {testimonios.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.cifra && t.hasRevenue ? ` — ${t.cifra.split('·')[0].trim()}` : ' — sin cifras'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Instrucción extra (opcional)</label>
                  <input
                    value={gen.instruction}
                    onChange={(e) => setGen({ ...gen, instruction: e.target.value })}
                    placeholder="Ej: enfoque para dueños de negocio"
                    className="w-full mt-1 bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground focus:outline-none focus:border-pink-500"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Mantendrá el hook y la primera parte del original, y a partir de ahí lo reconduce a tu negocio
                  cerrando con el CTA.
                  {gen.testimonio && ' Meterá el caso de éxito como prueba social en el puente, con sus cifras reales.'}
                </p>
                <div className="flex justify-end">
                  <button
                    onClick={generate}
                    disabled={gen.phase === 'loading' || !gen.transcript.trim()}
                    className="px-4 py-2 rounded-lg text-sm bg-pink-600 text-foreground hover:bg-pink-500 disabled:opacity-50 flex items-center gap-2"
                  >
                    {gen.phase === 'loading' ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Generando…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" /> Generar guión
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {gen.phase === 'result' && gen.draft && (
              <div className="space-y-3 text-sm">
                <p className="text-foreground font-semibold text-base">{gen.draft.title}</p>
                {gen.draft.cta_used && (
                  <span className="inline-block text-xs bg-pink-950/50 text-pink-300 px-2 py-0.5 rounded-full">
                    CTA: {gen.draft.cta_used}
                  </span>
                )}
                {gen.draft.testimonio_used && (
                  <span className="inline-block text-xs bg-emerald-950/50 text-emerald-300 px-2 py-0.5 rounded-full ml-1.5">
                    Testimonio: {gen.draft.testimonio_used}
                  </span>
                )}
                <div>
                  <span className="text-muted-foreground">Hook:</span>{' '}
                  <span className="text-pink-300">{gen.draft.hook}</span>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Guión:</p>
                  <p className="text-foreground whitespace-pre-wrap bg-background/50 rounded-lg p-3">
                    {gen.draft.script}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Caption:</span>{' '}
                  <span className="text-foreground">{gen.draft.caption}</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    onClick={saveIdea}
                    disabled={gen.saving}
                    className="px-3 py-2 rounded-lg text-sm bg-pink-600 text-foreground hover:bg-pink-500 disabled:opacity-50"
                  >
                    {gen.saving ? 'Añadiendo…' : 'Añadir a Contenido como IDEA'}
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `${gen.draft!.hook}\n\n${gen.draft!.script}\n\n${gen.draft!.caption}`
                      )
                      toast.success('Copiado')
                    }}
                    className="px-3 py-2 rounded-lg text-sm bg-muted text-foreground hover:bg-muted flex items-center gap-1"
                  >
                    <Copy className="w-4 h-4" /> Copiar
                  </button>
                  <button
                    onClick={() => setGen({ ...gen, phase: 'prep' })}
                    className="px-3 py-2 rounded-lg text-sm bg-muted text-foreground hover:bg-muted"
                  >
                    ↺ Ajustar y regenerar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
