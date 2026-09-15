import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import type { PeriodPreset } from '@/lib/filters/period'
import { formatCurrency } from '@/lib/utils'

// Extraído de crm/agendas/page.tsx (Fase 6/9): vista "métricas" (setters/closers) de Agendas —
// puramente presentacional, el padre sigue calculando setterMetrics/closerMetrics vía useMemo y
// posee el estado del filtro de periodo. Sin cambio de comportamiento respecto al bloque original.

type SetterMetricRow = {
  id: string
  name: string
  agendas: number
  programadas: number
  shows: number
  noShows: number
  seguimientos: number
  showRate: number | null
}

type CloserMetricRow = {
  id: string
  name: string
  asignadas: number
  programadas: number
  showsAtendidos: number
  seguimientos: number
  cierres: number
  closeRate: number | null
  ingresos: number
}

function rateColor(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground'
  if (rate >= 60) return 'text-emerald-400'
  if (rate >= 30) return 'text-amber-400'
  return 'text-red-400'
}

// Flecha + delta de puntos porcentuales vs el periodo anterior (verde si sube, rojo si baja).
function RateDelta({
  current,
  previous,
  hasPrevPeriod,
}: {
  current: number | null
  previous: number | null
  hasPrevPeriod: boolean
}) {
  if (!hasPrevPeriod || current === null || previous === null) return null
  const delta = current - previous
  if (Math.abs(delta) < 0.05) return <span className="text-[11px] text-muted-foreground ml-1.5">· = vs. anterior</span>
  const up = delta > 0
  return (
    <span className={`text-[11px] ml-1.5 ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}pp vs. anterior
    </span>
  )
}

interface AgendasMetricsViewProps {
  metricsPeriodPreset: PeriodPreset
  onMetricsPeriodPresetChange: (preset: PeriodPreset) => void
  metricsCustomFrom: string
  metricsCustomTo: string
  onMetricsCustomFromChange: (v: string) => void
  onMetricsCustomToChange: (v: string) => void
  setterMetrics: SetterMetricRow[]
  prevSetterMetrics: SetterMetricRow[]
  closerMetrics: CloserMetricRow[]
  prevCloserMetrics: CloserMetricRow[]
  hasPrevPeriod: boolean
}

export function AgendasMetricsView({
  metricsPeriodPreset,
  onMetricsPeriodPresetChange,
  metricsCustomFrom,
  metricsCustomTo,
  onMetricsCustomFromChange,
  onMetricsCustomToChange,
  setterMetrics,
  prevSetterMetrics,
  closerMetrics,
  prevCloserMetrics,
  hasPrevPeriod,
}: AgendasMetricsViewProps) {
  return (
    <div className="space-y-8">
      <PeriodFilterBar
        preset={metricsPeriodPreset}
        onPresetChange={onMetricsPeriodPresetChange}
        customFrom={metricsCustomFrom}
        customTo={metricsCustomTo}
        onCustomFromChange={onMetricsCustomFromChange}
        onCustomToChange={onMetricsCustomToChange}
      />
      {/* Setters */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Setters</h2>
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Setter</TableHead>
                <TableHead className="text-muted-foreground">Agendas</TableHead>
                <TableHead className="text-muted-foreground">Programadas</TableHead>
                <TableHead className="text-muted-foreground">Shows</TableHead>
                <TableHead className="text-muted-foreground">No-shows</TableHead>
                <TableHead className="text-muted-foreground">Seguimiento</TableHead>
                <TableHead className="text-muted-foreground">Show Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {setterMetrics.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No hay setters activos
                  </TableCell>
                </TableRow>
              ) : (
                setterMetrics.map((m) => (
                  <TableRow key={m.id} className="border-border hover:bg-card/50">
                    <TableCell className="text-foreground text-sm font-medium">{m.name}</TableCell>
                    <TableCell className="text-foreground text-sm">{m.agendas}</TableCell>
                    <TableCell className="text-blue-400 text-sm">{m.programadas}</TableCell>
                    <TableCell className="text-foreground text-sm">{m.shows}</TableCell>
                    <TableCell className="text-foreground text-sm">{m.noShows}</TableCell>
                    <TableCell className="text-indigo-300 text-sm">{m.seguimientos}</TableCell>
                    <TableCell className={`text-sm font-semibold ${rateColor(m.showRate)}`}>
                      {m.showRate !== null ? `${m.showRate.toFixed(1)}%` : '—'}
                      <RateDelta
                        current={m.showRate}
                        previous={prevSetterMetrics.find((p) => p.id === m.id)?.showRate ?? null}
                        hasPrevPeriod={hasPrevPeriod}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Closers */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Closers</h2>
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Closer</TableHead>
                <TableHead className="text-muted-foreground">Asignadas</TableHead>
                <TableHead className="text-muted-foreground">Programadas</TableHead>
                <TableHead className="text-muted-foreground">Shows atendidos</TableHead>
                <TableHead className="text-muted-foreground">Seguimiento</TableHead>
                <TableHead className="text-muted-foreground">Cierres</TableHead>
                <TableHead className="text-muted-foreground">Close Rate</TableHead>
                <TableHead className="text-muted-foreground">Ingresos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {closerMetrics.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No hay closers activos
                  </TableCell>
                </TableRow>
              ) : (
                closerMetrics.map((m) => (
                  <TableRow key={m.id} className="border-border hover:bg-card/50">
                    <TableCell className="text-foreground text-sm font-medium">{m.name}</TableCell>
                    <TableCell className="text-foreground text-sm">{m.asignadas}</TableCell>
                    <TableCell className="text-blue-400 text-sm">{m.programadas}</TableCell>
                    <TableCell className="text-foreground text-sm">{m.showsAtendidos}</TableCell>
                    <TableCell className="text-indigo-300 text-sm">{m.seguimientos}</TableCell>
                    <TableCell className="text-foreground text-sm">{m.cierres}</TableCell>
                    <TableCell className={`text-sm font-semibold ${rateColor(m.closeRate)}`}>
                      {m.closeRate !== null ? `${m.closeRate.toFixed(1)}%` : '—'}
                      <RateDelta
                        current={m.closeRate}
                        previous={prevCloserMetrics.find((p) => p.id === m.id)?.closeRate ?? null}
                        hasPrevPeriod={hasPrevPeriod}
                      />
                    </TableCell>
                    <TableCell className="text-foreground text-sm">{formatCurrency(m.ingresos)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
