'use client'

import { useCallback, useEffect, useState } from 'react'
import { Brain, Loader2, PlayCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useTenant, useTenantId } from '@/lib/tenant-context'

// Estado y disparo manual del pipeline de IA. Existe porque los dos jobs que lo alimentan
// (análisis de llamadas e insights) no están registrados como cron: el plan de Vercel es Hobby y
// ya tiene sus crons ocupados, así que sin este panel la única forma de ejecutarlos era un curl
// con CRON_SECRET. Las rutas aceptan sesión de admin/director además del secreto, que es lo que
// usan estos botones.
type Stats = { transcripciones: number; analizadas: number; insightsNuevos: number }

export function AiEnginePanel() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<'calls' | 'insights' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const sb = createClient()
    const [transcripciones, analizadas, insights] = await Promise.all([
      sb
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .not('transcript', 'is', null),
      sb
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .not('ai_analysis', 'is', null),
      sb.from('ai_insights').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'new'),
    ])
    setStats({
      transcripciones: transcripciones.count ?? 0,
      analizadas: analizadas.count ?? 0,
      insightsNuevos: insights.count ?? 0,
    })
    setLoading(false)
  }, [tenantId])

  useEffect(() => {
    void load()
  }, [load])

  async function run(job: 'calls' | 'insights') {
    setRunning(job)
    const path = job === 'calls' ? 'analyze-calls' : 'ai-insights'
    try {
      const r = await fetch(`/api/${tenant}/evergreen/cron/${path}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'El job no se pudo ejecutar')
      if (job === 'calls') {
        const restantes = typeof j.pendientes_restantes === 'number' ? j.pendientes_restantes : null
        toast.success(
          restantes && restantes > 0
            ? `Lote analizado. Quedan ${restantes} llamada(s) — vuelve a pulsar para seguir.`
            : 'Llamadas analizadas. No queda ninguna pendiente.'
        )
      } else {
        toast.success('Detección de anomalías ejecutada')
      }
      await load()
    } catch (error) {
      toast.error('No se pudo ejecutar', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setRunning(null)
    }
  }

  const pendientes = stats ? Math.max(stats.transcripciones - stats.analizadas, 0) : 0

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-brand-400" />
            <h2 className="text-sm font-semibold text-foreground">Motor de IA</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Alimenta las respuestas del agente sobre objeciones, closers y anomalías. Estos dos procesos no están
            programados automáticamente todavía: ejecútalos aquí cuando quieras actualizar los datos.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </Button>
      </div>

      <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {[
          { label: 'Llamadas con transcripción', value: stats?.transcripciones ?? 0 },
          { label: 'Analizadas por IA', value: stats?.analizadas ?? 0 },
          { label: 'Insights sin revisar', value: stats?.insightsNuevos ?? 0 },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{kpi.label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
              {loading ? '—' : kpi.value.toLocaleString('es-ES')}
            </p>
          </div>
        ))}
      </div>

      {!loading && stats && stats.transcripciones > 0 && stats.analizadas === 0 && (
        <p className="mt-3 text-sm text-amber-300">
          Ninguna llamada está analizada todavía, así que el agente no puede responder sobre objeciones ni comparar
          closers. Lanza el análisis para activarlo.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void run('calls')} disabled={running !== null || pendientes === 0}>
          {running === 'calls' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="mr-2 h-4 w-4" />
          )}
          {pendientes > 0 ? `Analizar llamadas (${pendientes} pendientes)` : 'Llamadas al día'}
        </Button>
        <Button variant="outline" onClick={() => void run('insights')} disabled={running !== null}>
          {running === 'insights' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="mr-2 h-4 w-4" />
          )}
          Detectar anomalías ahora
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        El análisis va por lotes acotados al límite de tiempo de la función, así que con mucho histórico hay que
        pulsarlo varias veces. La detección de anomalías no consume IA: compara los últimos 7 días con los 7 anteriores
        contra umbrales fijos.
      </p>
    </section>
  )
}
