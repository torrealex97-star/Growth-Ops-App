'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Filter, Info, Loader2, Settings2, TrendingDown } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { FUNNEL_DEFS, FUNNEL_FAMILIES, type FunnelFamily } from '@/lib/funnels/definitions'
import { STATUS_LABELS, type MetricStatus } from '@/lib/funnels/types'
import { formatCurrency } from '@/lib/utils'

type StageRow = {
  stage: { id: string; label: string; source: string; counts: 'personas' | 'eventos' }
  count: { value: number | null; status: MetricStatus; source: string; lastSync: string | null; error?: string }
  conversionFromPrevious: number | null
  conversionFromTop: number | null
  costPerUnit: number | null
  blockedBy?: 'error_fuente' | 'no_configurada' | 'unidades_incompatibles'
}

type FunnelResponse = {
  family: FunnelFamily
  label: string
  stages: StageRow[]
  inversion: number | null
  incomplete: boolean
  failedSources: string[]
  unconfiguredSources: string[]
  range: { from: string; to: string }
}

// Los cuatro estados se pintan DISTINTO a propósito. Si "sin datos" y "no se pudo leer" se vieran
// igual, toda la capa canónica que los distingue no serviría de nada en pantalla.
const STATUS_STYLES: Record<MetricStatus, { dot: string; text: string }> = {
  ok: { dot: 'bg-emerald-400', text: 'text-foreground' },
  sin_datos: { dot: 'bg-zinc-500', text: 'text-muted-foreground' },
  error_fuente: { dot: 'bg-red-400', text: 'text-red-400' },
  no_configurada: { dot: 'bg-amber-400', text: 'text-amber-400' },
}

const num = (n: number) => n.toLocaleString('es-ES')
const pctText = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)} %`)

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
function daysAgoIso(days: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

export default function FunnelsPage() {
  const tenant = useTenant()
  const [family, setFamily] = useState<FunnelFamily>('vsl')
  const [from, setFrom] = useState(daysAgoIso(29))
  const [to, setTo] = useState(todayIso())
  const [data, setData] = useState<FunnelResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/funnels?family=${family}&from=${from}&to=${to}`)
      const j = await r.json()
      if (!r.ok) {
        setError(j.error || 'No se pudo cargar el funnel')
        setData(null)
        return
      }
      setData(j as FunnelResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de conexión')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [tenant, family, from, to])

  useEffect(() => {
    void load()
  }, [load])

  const def = FUNNEL_DEFS[family]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Funnels</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Dónde se cae la gente entre el primer contacto y el cierre. Cada etapa dice de qué fuente sale y si ese número
          es de fiar.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {FUNNEL_FAMILIES.map((f) => (
            <button
              key={f}
              onClick={() => setFamily(f)}
              aria-current={family === f ? 'page' : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                family === f ? 'bg-card text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {FUNNEL_DEFS[f].label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs text-muted-foreground">
            Desde
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block rounded-lg border border-border bg-background/60 px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Hasta
            <input
              type="date"
              value={to}
              min={from}
              max={todayIso()}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block rounded-lg border border-border bg-background/60 px-2 py-1.5 text-sm text-foreground"
            />
          </label>
        </div>
      </div>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        {def.description}
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Calculando…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">{error}</div>
      )}

      {data && !loading && (
        <>
          {data.failedSources.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Este funnel está incompleto: no se pudo leer {data.failedSources.join(', ')}. Los huecos NO son ceros —
                son datos desconocidos, así que no interpretes las conversiones de alrededor como caídas.
              </span>
            </div>
          )}
          {data.unconfiguredSources.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-400">
              <Settings2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Faltan fuentes por configurar ({data.unconfiguredSources.join(', ')}). No hay nada roto: son etapas que
                todavía no tienen de dónde leer. Cada fila de abajo dice qué le falta.
              </span>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Etapa</th>
                  <th className="p-3 text-right">Cantidad</th>
                  <th className="p-3 text-right">% desde la anterior</th>
                  <th className="p-3 text-right">% desde el inicio</th>
                  <th className="p-3 text-right">Coste unitario</th>
                  <th className="p-3">Estado y fuente</th>
                </tr>
              </thead>
              <tbody>
                {data.stages.map((s) => {
                  const style = STATUS_STYLES[s.count.status]
                  const biggestDrop =
                    s.conversionFromPrevious !== null && s.conversionFromPrevious < 30 ? 'bg-amber-500/5' : ''
                  return (
                    <tr key={s.stage.id} className={`border-t border-border ${biggestDrop}`}>
                      <td className="p-3">
                        <span className="font-medium text-foreground">{s.stage.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {s.stage.counts === 'personas' ? 'personas' : 'eventos'}
                        </span>
                      </td>
                      <td className={`p-3 text-right font-mono ${style.text}`}>
                        {s.count.value === null ? '—' : num(s.count.value)}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {s.blockedBy === 'unidades_incompatibles' ? (
                          <span
                            className="cursor-help text-muted-foreground"
                            title="Esta etapa cuenta personas y la anterior eventos (o al revés). Dividir una por otra daría un porcentaje sin sentido, que puede pasar del 100 %."
                          >
                            no comparable
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {s.conversionFromPrevious !== null && s.conversionFromPrevious < 30 && (
                              <TrendingDown className="h-3.5 w-3.5 text-amber-400" />
                            )}
                            {pctText(s.conversionFromPrevious)}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono text-muted-foreground">{pctText(s.conversionFromTop)}</td>
                      <td className="p-3 text-right font-mono text-muted-foreground">
                        {s.costPerUnit === null ? '—' : formatCurrency(s.costPerUnit)}
                      </td>
                      <td className="p-3">
                        <span className="flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
                          <span className={`text-xs ${style.text}`}>{STATUS_LABELS[s.count.status]}</span>
                          <span className="text-xs text-muted-foreground">· {s.count.source}</span>
                        </span>
                        {s.count.error && (
                          <p className="mt-1 max-w-md text-xs text-muted-foreground">{s.count.error}</p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Filter className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {data.inversion === null
              ? 'Sin inversión publicitaria en el periodo, así que no se puede calcular coste por etapa.'
              : `Inversión del periodo: ${formatCurrency(data.inversion)}. El coste unitario es esa inversión dividida entre la cantidad de cada etapa.`}
          </p>
        </>
      )}
    </div>
  )
}
