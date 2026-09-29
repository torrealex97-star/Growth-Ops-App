'use client'
import { useTenant } from '@/lib/tenant-context'
import { useEffect, useState } from 'react'
import { Sparkles, ChevronDown, ChevronRight, Loader2, MessageCircle, ExternalLink } from 'lucide-react'
import { formatNumber, formatPercent } from '@/lib/utils'

type ConvMsg = { from: 'agente' | 'lead'; text?: string; created_time?: string }
type IgConversation = {
  id: string
  participant?: string
  updated_time?: string
  unread_count: number
  message_count: number
  messages: ConvMsg[]
}

// GHL devuelve la misma forma base (id, unread_count, message_count, messages) más el canal y
// la vinculación con el perfil del CRM (resuelta en servidor por ghl_contact_id → email →
// teléfono); la UI es la misma lista con un badge de canal y un enlace al contacto.
type GhConversation = IgConversation & {
  channel?: string
  contactId?: string
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  contactoVinculado?: { id: string; full_name: string } | null
  vinculacion?: string | null
}
type Conv = IgConversation & Partial<GhConversation>
type Analysis = {
  avatar_detectado?: string
  fase_alcanzada?: string
  resumen?: string
  fortalezas?: string[]
  fallos?: { cita: string; problema: string }[]
  recomendaciones?: string[]
}
type ResumenMetricas = {
  totalConversaciones: number
  conContactoVinculado: number
  conAgendaVerificada: number
  conVentaVerificada: number
  sinContactoVinculado: number
  sinContactoConEnlaceAgenda: number
  tasaVinculacion: number
  tasaAgendaSobreVinculados: number
}

const PLATFORMS = [
  { k: 'instagram' as const, label: 'Instagram' },
  { k: 'ghl' as const, label: 'GHL' },
  { k: 'facebook' as const, label: 'Facebook' },
  { k: 'tiktok' as const, label: 'TikTok' },
]
type Platform = (typeof PLATFORMS)[number]['k']
type RespuestaConvos = {
  error?: string
  configured?: boolean
  conversations?: Conv[]
  motivo?: string
}

export default function ConversacionesTab() {
  const tenant = useTenant()
  const [platform, setPlatform] = useState<Platform>('instagram')
  const [loading, setLoading] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [conversations, setConversations] = useState<Conv[]>([])
  const [error, setError] = useState('')
  const [motivo, setMotivo] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState<string | null>(null)
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({})
  const [analyzeError, setAnalyzeError] = useState<Record<string, string>>({})
  const [metricas, setMetricas] = useState<
    Partial<Record<'instagram' | 'ghl', { resumen?: ResumenMetricas; motivo?: string }>>
  >({})

  useEffect(() => {
    if (platform !== 'instagram' && platform !== 'ghl') {
      setConfigured(false)
      setConversations([])
      setError('')
      return
    }
    let cancel = false
    setLoading(true)
    setError('')
    // La carga anterior se moría por tiempo (lambda + Graph API en serie): aquí acotamos el
    // esperar en cliente también, para que el usuario vea un mensaje y no una rueda eterna.
    const controlador = new AbortController()
    const reloj = setTimeout(() => controlador.abort(), 35_000)
    fetch(`/api/${tenant}/evergreen/setting-ai/conversations?platform=${platform}`, {
      signal: controlador.signal,
    })
      .then(async (r) =>
        r.ok ? ((await r.json()) as RespuestaConvos) : { error: `El servidor respondió ${r.status}` }
      )
      .then((j) => {
        if (cancel) return
        if (j.error) {
          setError(j.error)
          setConfigured(false)
          return
        }
        setConfigured(!!j.configured)
        setConversations(j.conversations || [])
        setMotivo(j.motivo || '')
      })
      .catch((e) => {
        if (!cancel) {
          setError(e.name === 'AbortError' ? 'La carga tardó demasiado. Inténtalo de nuevo.' : e.message)
          setConfigured(false)
        }
      })
      .finally(() => {
        clearTimeout(reloj)
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [platform, tenant])

  // Resumen cross-plataforma (Instagram y GHL: las dos con datos reales hoy). Independiente del
  // tab activo — se ve aunque estés en el placeholder de Facebook/TikTok: comparar de un vistazo
  // qué canal trae más leads/agendas verificadas es el punto.
  useEffect(() => {
    let cancel = false
    for (const p of ['instagram', 'ghl'] as const) {
      fetch(`/api/${tenant}/evergreen/setting-ai/conversations/metrics?platform=${p}`)
        .then((r) => r.json())
        .then((j) => {
          if (cancel) return
          setMetricas((m) => ({
            ...m,
            [p]:
              j.configured && j.resumen
                ? { resumen: j.resumen as ResumenMetricas }
                : { motivo: j.motivo || j.error || '' },
          }))
        })
        .catch(() => {
          if (!cancel) setMetricas((m) => ({ ...m, [p]: { motivo: 'No se pudieron calcular las métricas.' } }))
        })
    }
    return () => {
      cancel = true
    }
    // Recalcula cuando la lista de conversaciones se refresca (el snapshot que leen estos
    // endpoints puede haber cambiado tras la descarga).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, conversations.length])

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
          <p className="text-2xs text-muted-foreground leading-tight">
            Extrae y analiza con IA las conversaciones reales: redes sociales y la bandeja de GHL.
          </p>
          {motivo && configured && <p className="text-2xs text-amber-500/90 leading-tight mt-0.5">{motivo}</p>}
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

      <ResumenCrossPlataforma metricas={metricas} />

      <div className="flex-1 overflow-y-auto py-4">
        {platform !== 'instagram' && platform !== 'ghl' ? (
          <PlaceholderPlatform platform={platform} />
        ) : loading ? (
          <p className="text-muted-foreground text-sm text-center py-10 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando conversaciones…
          </p>
        ) : error ? (
          <p className="text-red-400 text-sm text-center py-10">Error: {error}</p>
        ) : configured === false ? (
          <div className="text-center py-14 text-muted-foreground text-sm max-w-md mx-auto">
            <p className="mb-2 font-semibold text-foreground">
              {platform === 'ghl'
                ? 'GoHighLevel no está operativo para mensajería.'
                : 'Instagram no está operativo para mensajería.'}
            </p>
            {motivo && <p className="mb-2 text-foreground">{motivo}</p>}
            <p>
              {platform === 'ghl' ? (
                <>
                  Configura el <b>PIT token</b> y el <b>Location ID</b> en <b>Configuración → Integraciones</b> para ver
                  aquí la bandeja unificada de GHL (SMS, Facebook, Instagram, WhatsApp y email).
                </>
              ) : (
                <>
                  Configura el token en <b>Configuración → Integraciones</b> (necesita el permiso{' '}
                  <code className="text-2xs bg-muted px-1 py-0.5 rounded">instagram_manage_messages</code>) para poder
                  ver y analizar aquí las conversaciones reales.
                </>
              )}
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
                  <span className="font-medium text-sm flex-1 truncate">
                    {c.contactoVinculado?.full_name || c.participant || c.contact_name || 'Lead sin nombre'}
                  </span>
                  {c.channel && (
                    <span className="text-3xs text-muted-foreground border border-border rounded px-1 py-0.5 uppercase">
                      {c.channel}
                    </span>
                  )}
                  {c.unread_count > 0 && (
                    <span className="text-3xs bg-brand-600 text-white rounded-full px-1.5 py-0.5">
                      {c.unread_count} sin leer
                    </span>
                  )}
                  <span className="text-2xs text-muted-foreground">{c.message_count} msgs</span>
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
                    {platform === 'ghl' &&
                      (c.contactoVinculado ? (
                        <a
                          href={`/${tenant}/crm/contactos/${c.contactoVinculado.id}`}
                          className="flex items-center gap-1 text-2xs text-brand-400 hover:opacity-80 mb-2"
                          title={`Perfil vinculado (${c.vinculacion === 'ghl_contact_id' ? 'ID de GHL' : c.vinculacion === 'email' ? 'email' : 'teléfono'})`}
                        >
                          <ExternalLink className="w-3 h-3" /> Ver perfil: {c.contactoVinculado.full_name}
                        </a>
                      ) : (
                        <p className="text-2xs text-muted-foreground mb-2 flex items-center gap-1">
                          <MessageCircle className="w-3 h-3" /> Sin perfil vinculado en el CRM (coincide por ID de GHL,
                          email o teléfono).
                        </p>
                      ))}
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

// Comparativa cross-plataforma: qué canal de mensajería genera más leads/agendas reales. Solo
// Instagram tiene datos hoy — Facebook y TikTok se pintan como "próximamente" en la MISMA fila para
// que la comparación esté lista en cuanto se conecten, en vez de tener que buscarla en otro sitio.
function ResumenCrossPlataforma({
  metricas,
}: {
  metricas: Partial<Record<'instagram' | 'ghl', { resumen?: ResumenMetricas; motivo?: string }>>
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 py-3 border-b border-border">
      <TarjetaPlataforma label="Instagram" data={metricas.instagram} />
      <TarjetaPlataforma label="GHL" data={metricas.ghl} hint="SMS · Facebook · Instagram · WhatsApp · email" />
    </div>
  )
}

function TarjetaPlataforma({
  label,
  data,
  proximamente,
  hint,
}: {
  label: string
  data?: { resumen?: ResumenMetricas; motivo?: string }
  proximamente?: boolean
  hint?: string
}) {
  const metrics = data?.resumen
  const motivo = data?.motivo
  return (
    <div className="border border-border rounded-xl p-3 bg-muted/30">
      <p className="text-2xs font-semibold text-foreground mb-1.5">
        {label}
        {hint && <span className="ml-1.5 font-normal text-3xs text-muted-foreground">{hint}</span>}
      </p>
      {proximamente ? (
        <p className="text-3xs text-muted-foreground">Próximamente — sin integración de mensajería todavía.</p>
      ) : metrics ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-foreground">{formatNumber(metrics.totalConversaciones)}</span>
            <span className="text-3xs text-muted-foreground">conversaciones</span>
          </div>
          <p className="text-3xs text-muted-foreground">
            <b className="text-foreground">{formatNumber(metrics.conAgendaVerificada)}</b> con agenda verificada en CRM
            ({formatPercent(metrics.tasaAgendaSobreVinculados * 100, 0)} de los vinculados) ·{' '}
            <b className="text-foreground">{formatNumber(metrics.conVentaVerificada)}</b> con venta
          </p>
          <p className="text-3xs text-muted-foreground">
            {formatNumber(metrics.conContactoVinculado)} de {formatNumber(metrics.totalConversaciones)} vinculadas a un
            contacto real ({formatPercent(metrics.tasaVinculacion * 100, 0)}) ·{' '}
            {formatNumber(metrics.sinContactoVinculado)} sin vincular{' '}
            {metrics.sinContactoConEnlaceAgenda > 0 && (
              <span title="Se envió un enlace de agenda en el texto, pero no hay contacto vinculado para confirmar que se completó">
                ({formatNumber(metrics.sinContactoConEnlaceAgenda)} con enlace de agenda enviado, sin confirmar)
              </span>
            )}
          </p>
        </div>
      ) : (
        <p className="text-3xs text-muted-foreground">{motivo || 'Cargando…'}</p>
      )}
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
