'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sparkles, X, ArrowUp, Loader2 } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { GrowthBriefCabecera } from '@/components/ai/GrowthBriefCabecera'

type Evidence = { name: string; input: Record<string, unknown>; summary: string }
type ChatMsg = { role: 'user' | 'assistant'; content: string; evidence?: Evidence[] }
type Insight = { id: string; severity: 'critical' | 'warning' | 'opportunity' | 'info'; title: string; summary: string }

const SEVERITY_DOT: Record<Insight['severity'], string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  opportunity: 'bg-emerald-500',
  info: 'bg-brand-500',
}

// Nombres de tool → etiqueta corta para mostrar como "fuente" (punto 20/84 del brief: evidencia
// compacta, nunca logs técnicos ni el nombre crudo de la función).
const TOOL_LABELS: Record<string, string> = {
  getBusinessOverview: 'Resumen del negocio',
  getFunnel: 'Embudo de ads',
  getCampaignPerformance: 'Campañas',
  getContacts: 'Contactos',
  getContactTimeline: 'Timeline de contacto',
  searchTranscripts: 'Transcripciones de llamadas',
  getSales: 'Ventas',
  getMetricDefinition: 'Definición de métrica',
  comparePeriods: 'Comparativa de periodos',
  analyzeFunnelChange: 'Análisis de causa raíz',
  getTopObjections: 'Objeciones (llamadas)',
  compareClosers: 'Comparativa de closers',
  getBusinessMemory: 'Memoria de negocio',
  recordBusinessFact: 'Hecho registrado',
  getDataCoverage: 'Cobertura de datos',
  getRecentInsights: 'Insights detectados',
}

// Preguntas sugeridas por pantalla (punto 87): nada de "¿cómo puedo ayudarte?" genérico.
function suggestionsFor(relPath: string): string[] {
  if (relPath.startsWith('/marketing/adquisicion/campanas'))
    return [
      '¿Qué campaña trae mejor CPL este mes?',
      '¿Dónde se rompe más el funnel?',
      'Compara con el periodo anterior',
    ]
  if (relPath.startsWith('/crm/contactos'))
    return ['Busca un contacto por nombre', '¿Qué objeciones se repiten en las llamadas?', 'Resume la última venta']
  if (relPath.startsWith('/dashboard'))
    return ['¿Qué ha cambiado esta semana?', '¿Cuál es el ROAS del último mes?', 'Resumen del negocio']
  return ['Resumen del negocio', '¿Cuántas ventas llevamos este mes?', '¿Qué objeciones aparecen en las llamadas?']
}

function screenNameFor(relPath: string): string {
  const seg = relPath.split('/').filter(Boolean)
  return seg.length ? seg.join('/') : 'inicio'
}

export function AgentLauncher() {
  const tenant = useTenant()
  const pathname = usePathname()
  const relPath = pathname.replace(new RegExp(`^/${tenant}`), '') || '/'
  const screen = screenNameFor(relPath)

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [insights, setInsights] = useState<Insight[]>([])
  // Separado de insights.length: la lista sigue visible tras abrir el panel (para poder pulsarla),
  // pero el badge debe apagarse en cuanto los has visto.
  const [unseenCount, setUnseenCount] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  // Indicador ligero de insights nuevos — no pasa por el LLM, es una lectura directa (barato,
  // instantáneo). El feed completo (punto 27) queda para una fase posterior; esto es solo el
  // "hay algo que revisar" antes de abrir el chat.
  useEffect(() => {
    let mounted = true
    fetch(`/api/${tenant}/evergreen/ai/agent?insights=1`)
      .then((r) => (r.ok ? r.json() : { insights: [] }))
      .then((json) => {
        if (!mounted) return
        const list: Insight[] = json.insights || []
        setInsights(list)
        setUnseenCount(list.length)
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [tenant])

  // Escape cierra el panel (accesibilidad — punto 48).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Los insights pasan a "vistos" solo cuando REALMENTE se han pintado, es decir, con el panel
  // abierto y en el estado inicial de la conversación (que es donde se listan). Marcarlos al abrir
  // sin más dejaba enterrada para siempre una anomalía crítica si abrías el chat para otra cosa.
  useEffect(() => {
    if (!open || insights.length === 0 || messages.length > 0) return
    const ids = insights.map((i) => i.id)
    void fetch(`/api/${tenant}/evergreen/ai/agent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).catch(() => {})
    setUnseenCount(0)
  }, [open, insights, messages.length, tenant])

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || loading) return
    setMessages((prev) => [...prev, { role: 'user', content: q }])
    setInput('')
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/ai/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message: q, screen }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error del agente')
      setConversationId(json.conversationId)
      setMessages((prev) => [...prev, { role: 'assistant', content: json.message, evidence: json.evidence || [] }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo contactar con el agente')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Launcher: superficie sobria, sin glow/gradiente/esfera — un botón más del producto. */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Cerrar el agente de IA' : 'Abrir el agente de IA'}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card text-foreground shadow-lg transition-colors hover:border-brand-500/50 hover:text-brand-400"
      >
        {open ? <X className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        {!open && unseenCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unseenCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Agente de IA"
          className="fixed z-40 flex flex-col overflow-hidden border border-border bg-card shadow-2xl
            inset-0 sm:inset-auto sm:bottom-20 sm:right-5 sm:h-[32rem] sm:w-[400px] sm:rounded-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Agente de negocio</p>
              <p className="text-[11px] text-muted-foreground">Responde con datos reales de tu cuenta</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Cerrar"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground sm:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && insights.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Detectado automáticamente:</p>
                {insights.map((ins) => (
                  <button
                    key={ins.id}
                    onClick={() => send(`Explícame este insight: "${ins.title}". ${ins.summary}`)}
                    className="flex w-full items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:border-brand-500/40"
                  >
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[ins.severity]}`} />
                    <span className="text-sm text-foreground">{ins.title}</span>
                  </button>
                ))}
              </div>
            )}
            {messages.length === 0 && (
              <div className="space-y-2">
                {/* Lo primero NO es un cuadro de texto vacío: un chat en blanco traslada a la persona el
                    trabajo de saber qué preguntar, y entonces no se usa. El agente abre diciendo lo que
                    ya sabe. */}
                <GrowthBriefCabecera onPreguntar={send} />
                <p className="text-xs text-muted-foreground">
                  O pregunta sobre tu negocio con datos reales, por ejemplo:
                </p>
                {suggestionsFor(relPath).map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-brand-500/40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-background border border-border text-foreground'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.evidence && m.evidence.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
                      {m.evidence.map((ev, j) => (
                        <span
                          key={j}
                          title={ev.summary}
                          className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {TOOL_LABELS[ev.name] || ev.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analizando…
              </div>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
            className="flex items-center gap-2 border-t border-border p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregunta algo sobre tu negocio…"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Enviar"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  )
}
