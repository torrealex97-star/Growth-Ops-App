'use client'
import { useTenant } from '@/lib/tenant-context'
import { useEffect, useState } from 'react'
import { Sparkles, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

type ConvMsg = { from: 'agente' | 'lead'; text?: string; created_time?: string }
type IgConversation = {
  id: string
  participant?: string
  updated_time?: string
  unread_count: number
  message_count: number
  messages: ConvMsg[]
}
type Analysis = {
  avatar_detectado?: string
  fase_alcanzada?: string
  resumen?: string
  fortalezas?: string[]
  fallos?: { cita: string; problema: string }[]
  recomendaciones?: string[]
}

const PLATFORMS = [
  { k: 'instagram' as const, label: 'Instagram' },
  { k: 'facebook' as const, label: 'Facebook' },
  { k: 'tiktok' as const, label: 'TikTok' },
]
type Platform = (typeof PLATFORMS)[number]['k']

export default function ConversacionesTab() {
  const tenant = useTenant()
  const [platform, setPlatform] = useState<Platform>('instagram')
  const [loading, setLoading] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [conversations, setConversations] = useState<IgConversation[]>([])
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState<string | null>(null)
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({})
  const [analyzeError, setAnalyzeError] = useState<Record<string, string>>({})

  useEffect(() => {
    if (platform !== 'instagram') {
      setConfigured(false)
      setConversations([])
      setError('')
      return
    }
    let cancel = false
    setLoading(true)
    setError('')
    fetch(`/api/${tenant}/evergreen/setting-ai/conversations?platform=instagram`)
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return
        if (j.error) {
          setError(j.error)
          setConfigured(false)
          return
        }
        setConfigured(!!j.configured)
        setConversations(j.conversations || [])
      })
      .catch((e) => {
        if (!cancel) {
          setError(e.message)
          setConfigured(false)
        }
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [platform, tenant])

  async function analyze(c: IgConversation) {
    setAnalyzing(c.id)
    setAnalyzeError((e) => ({ ...e, [c.id]: '' }))
    try {
      const conversation = c.messages.map((m) => ({ who: m.from === 'agente' ? 'agent' : 'lead', text: m.text || '' }))
      const r = await fetch(`/api/${tenant}/evergreen/setting-ai/analyze-conversation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversation, model: 'sonnet' }),
      }).then((res) => res.json())
      if (r.error) throw new Error(r.error)
      setAnalyses((a) => ({ ...a, [c.id]: r }))
    } catch (e) {
      setAnalyzeError((er) => ({ ...er, [c.id]: (e as Error).message }))
    } finally {
      setAnalyzing(null)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-6.5rem)] text-foreground">
      <div className="flex items-center gap-3 flex-wrap pb-3 border-b border-border">
        <div>
          <h1 className="text-base font-bold text-foreground leading-tight">Conversaciones</h1>
          <p className="text-[11px] text-muted-foreground leading-tight">
            Extrae y analiza con IA las conversaciones reales de redes sociales.
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {PLATFORMS.map((p) => (
            <button
              key={p.k}
              onClick={() => setPlatform(p.k)}
              className={`px-3 py-1.5 font-semibold ${platform === p.k ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        {platform !== 'instagram' ? (
          <PlaceholderPlatform platform={platform} />
        ) : loading ? (
          <p className="text-muted-foreground text-sm text-center py-10 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando conversaciones…
          </p>
        ) : error ? (
          <p className="text-red-400 text-sm text-center py-10">Error: {error}</p>
        ) : configured === false ? (
          <div className="text-center py-14 text-muted-foreground text-sm max-w-md mx-auto">
            <p className="mb-2 font-semibold text-foreground">Instagram no está conectado todavía.</p>
            <p>
              Configura el token en <b>Configuración → Integraciones</b> (necesita el permiso{' '}
              <code className="text-[11px] bg-muted px-1 py-0.5 rounded">instagram_manage_messages</code>) para poder
              ver y analizar aquí las conversaciones reales.
            </p>
          </div>
        ) : conversations.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-10">No hay conversaciones recientes.</p>
        ) : (
          <div className="flex flex-col gap-2 max-w-3xl mx-auto">
            {conversations.map((c) => (
              <div key={c.id} className="border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenId(openId === c.id ? null : c.id)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50"
                >
                  {openId === c.id ? (
                    <ChevronDown className="w-4 h-4 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 shrink-0" />
                  )}
                  <span className="font-medium text-sm flex-1 truncate">{c.participant || 'Lead sin nombre'}</span>
                  {c.unread_count > 0 && (
                    <span className="text-[10px] bg-brand-600 text-white rounded-full px-1.5 py-0.5">
                      {c.unread_count} sin leer
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground">{c.message_count} msgs</span>
                </button>
                {openId === c.id && (
                  <div className="border-t border-border p-3 bg-background">
                    {c.messages.length === 0 ? (
                      <p className="text-muted-foreground text-xs mb-3">
                        No se pudo extraer la transcripción de esta conversación.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto mb-3">
                        {c.messages.map((m, i) => (
                          <div
                            key={i}
                            className={`text-xs max-w-[80%] rounded-2xl px-3 py-1.5 whitespace-pre-wrap ${m.from === 'agente' ? 'self-start bg-muted' : 'self-end bg-brand-600/20 ml-auto'}`}
                          >
                            {m.text}
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => analyze(c)}
                      disabled={analyzing === c.id || c.messages.length === 0}
                      className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
                    >
                      {analyzing === c.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      Analizar con IA
                    </button>
                    {analyzeError[c.id] && <p className="text-red-400 text-xs mt-2">{analyzeError[c.id]}</p>}
                    {analyses[c.id] && <AnalysisCard a={analyses[c.id]} />}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PlaceholderPlatform({ platform }: { platform: 'facebook' | 'tiktok' }) {
  const label = platform === 'facebook' ? 'Facebook' : 'TikTok'
  return (
    <div className="text-center py-14 text-muted-foreground text-sm max-w-md mx-auto">
      <p className="mb-2 font-semibold text-foreground">{label}: próximamente.</p>
      <p>
        Todavía no está conectada la extracción de conversaciones de {label}. En cuanto se active la integración,
        aparecerán aquí con el mismo análisis IA que Instagram.
      </p>
    </div>
  )
}

function AnalysisCard({ a }: { a: Analysis }) {
  return (
    <div className="mt-3 border border-border rounded-lg p-3 bg-muted/40 text-xs flex flex-col gap-2">
      <div className="flex gap-3 flex-wrap">
        {a.avatar_detectado && (
          <span>
            <b className="text-foreground">Avatar:</b> {a.avatar_detectado}
          </span>
        )}
        {a.fase_alcanzada && (
          <span>
            <b className="text-foreground">Fase:</b> {a.fase_alcanzada}
          </span>
        )}
      </div>
      {a.resumen && <p className="text-muted-foreground">{a.resumen}</p>}
      {!!a.fortalezas?.length && (
        <div>
          <b className="text-emerald-400">Fortalezas</b>
          <ul className="list-disc pl-4 mt-0.5">
            {a.fortalezas.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {!!a.fallos?.length && (
        <div>
          <b className="text-amber-400">Fallos</b>
          <ul className="list-disc pl-4 mt-0.5">
            {a.fallos.map((f, i) => (
              <li key={i}>
                <i>&ldquo;{f.cita}&rdquo;</i> — {f.problema}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!a.recomendaciones?.length && (
        <div>
          <b className="text-brand-400">Recomendaciones</b>
          <ul className="list-disc pl-4 mt-0.5">
            {a.recomendaciones.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
