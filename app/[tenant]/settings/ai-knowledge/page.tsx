'use client'

// INSPECTOR DEL CONOCIMIENTO RAG (Configuración › Conocimiento IA).
// Muestra lo que el agente de IA consulta: los chunks canónicos de las skills
// (ventas y marketing) recuperados por la misma búsqueda híbrida que usa el
// agente — endpoint /ai/knowledge, misma RPC match_knowledge_chunks.
//
// EL INDICADOR (el motivo de esta pantalla): cada búsqueda muestra SIEMPRE qué
// rama alimentó el ranking — 'Semántica + léxica' (embedding de Gemini fusionado
// con FTS vía RRF) o 'Solo léxica' (degradación: sin GEMINI_API_KEY o API caída).
// Sin este indicador, una clave de embeddings caducada pasaría desapercibida:
// la búsqueda sigue devolviendo resultados, pero de peor calidad por significado.

import { useCallback, useState } from 'react'
import { Brain, Search, Loader2, BookOpen, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useTenant } from '@/lib/tenant-context'

type KnowledgeChunk = {
  id: string
  category: string
  title: string
  content: string
  source: string
  module: number
  section: string
  metadata: { type?: string; tags?: string[] } | null
  similarity: number
}

type Modo = 'hibrida' | 'lexica'

const CATEGORIAS: { value: string; label: string }[] = [
  { value: 'objection_handling', label: 'Objeciones' },
  { value: 'pain_cycle', label: 'Ciclo de dolor' },
  { value: 'kpis', label: 'KPIs' },
  { value: 'frame_control', label: 'Control de marco' },
  { value: 'hiring', label: 'Reclutamiento' },
  { value: 'prospecting', label: 'Prospección' },
  { value: 'post_call', label: 'Post-llamada' },
  { value: 'uvp_and_angles', label: 'UVP y ángulos' },
  { value: 'avatar_icp', label: 'Avatar ICP' },
  { value: 'funnel_architecture', label: 'Embudos' },
  { value: 'copywriting_swipe', label: 'Copywriting' },
  { value: 'marketing_metrics', label: 'Métricas de marketing' },
]

// Qué ES cada chunk (metadata.type, enum de docs/rag_*_knowledge_schema.json):
// permite filtrar "guiones" vs "fórmulas" — el mismo filtro que tiene la tool del agente.
const TIPOS: { value: string; label: string }[] = [
  { value: 'script', label: 'Guiones (script)' },
  { value: 'formula', label: 'Fórmulas de KPI' },
  { value: 'framework', label: 'Frameworks' },
  { value: 'sequence', label: 'Secuencias' },
  { value: 'checklist', label: 'Checklists' },
]

const ETIQUETA_TIPO: Record<string, string> = {
  script: 'Guion',
  formula: 'Fórmula',
  framework: 'Framework',
  sequence: 'Secuencia',
  checklist: 'Checklist',
}

const MAX_CONTENT = 520

export default function AiKnowledgePage() {
  const tenant = useTenant()
  const [q, setQ] = useState('')
  const [categoria, setCategoria] = useState<string>('todas')
  const [tipo, setTipo] = useState<string>('todos')
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([])
  const [modo, setModo] = useState<Modo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [buscado, setBuscado] = useState(false)
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({})

  const buscar = useCallback(async () => {
    const consulta = q.trim()
    if (!consulta) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ q: consulta, limit: '8' })
      if (categoria !== 'todas') params.set('categories', categoria)
      if (tipo !== 'todos') params.set('types', tipo)
      const res = await fetch(`/api/${tenant}/evergreen/ai/knowledge?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error de búsqueda')
      setChunks((data.chunks ?? []) as KnowledgeChunk[])
      setModo((data.modo ?? 'lexica') as Modo)
      setBuscado(true)
      setExpandidos({})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de búsqueda')
      setChunks([])
      setModo(null)
      setBuscado(true)
    } finally {
      setLoading(false)
    }
  }, [q, categoria, tipo, tenant])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-brand-300" /> Conocimiento IA
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Inspector del conocimiento RAG que consulta el agente: los chunks canónicos de las skills de ventas y
          marketing. Escribe como le escribirías al agente y mira qué recupera.
        </p>
      </div>

      {/* Buscador */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void buscar()
          }}
          placeholder="p. ej. objeción de descuentos · cómo cualificar un lead · CPMQL…"
          className="flex-1"
        />
        <Select value={categoria} onValueChange={setCategoria}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las categorías</SelectItem>
            {CATEGORIAS.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los tipos</SelectItem>
            {TIPOS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => void buscar()} disabled={loading || !q.trim()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Buscar
        </Button>
      </div>

      {/* EL INDICADOR — qué rama alimentó el resultado de la última búsqueda */}
      {buscado && !error && modo && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
            modo === 'hibrida'
              ? 'border-brand-500/30 bg-brand-500/10 text-brand-200'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          )}
          title={
            modo === 'hibrida'
              ? 'El embedding de tu consulta recuperó por significado y se fusionó con la búsqueda léxica (RRF).'
              : 'Sin clave GEMINI_API_KEY (o API no disponible): solo FTS español + trigram. El resultado pierde precisión por significado.'
          }
        >
          {modo === 'hibrida' ? (
            <>
              <Brain className="h-4 w-4 shrink-0" />
              <span>
                <b>Semántica + léxica</b> — el ranking fusiona búsqueda por significado (embeddings) y por palabras.
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <b>Solo léxica</b> — sin embeddings activos (falta GEMINI_API_KEY o la API no respondió). Los resultados
                solo casan por palabras.
              </span>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      )}

      {buscado && !error && chunks.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">Sin resultados para esa consulta.</p>
      )}

      {/* Resultados */}
      <div className="space-y-3">
        {chunks.map((c) => {
          const largo = c.content.length > MAX_CONTENT
          const abierto = expandidos[c.id] ?? false
          return (
            <div key={c.id} className="rounded-lg border border-border/50 bg-zinc-900/40 p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-brand-500/30 bg-brand-500/10 text-brand-300">
                  {CATEGORIAS.find((cat) => cat.value === c.category)?.label ?? c.category}
                </Badge>
                {c.metadata?.type && (
                  <Badge variant="outline" className="border-border/60 text-zinc-300">
                    {ETIQUETA_TIPO[c.metadata.type] ?? c.metadata.type}
                  </Badge>
                )}
                {c.metadata?.tags?.slice(0, 3).map((t) => (
                  <Badge key={t} variant="outline" className="border-border/30 text-muted-foreground">
                    {t}
                  </Badge>
                ))}
                <span className="text-xs text-muted-foreground">§{c.module}</span>
                <span className="text-sm font-medium flex-1 min-w-0 truncate">{c.title}</span>
                <Badge variant="outline" className="font-mono text-xs border-border/40">
                  {(Number(c.similarity) * 100).toFixed(1)}%
                </Badge>
              </div>
              <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {abierto || !largo ? c.content : `${c.content.slice(0, MAX_CONTENT)}…`}
              </p>
              {largo && (
                <button
                  type="button"
                  onClick={() => setExpandidos((prev) => ({ ...prev, [c.id]: !abierto }))}
                  className="text-xs text-brand-300 hover:underline flex items-center gap-1"
                >
                  {abierto ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {abierto ? 'Ver menos' : 'Ver más'}
                </button>
              )}
              <p className="text-xs text-muted-foreground">
                Fuente: {c.source} · {c.section}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
