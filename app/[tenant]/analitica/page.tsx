'use client'

import { useState } from 'react'
import { Gauge } from 'lucide-react'
import { PanelGrowth } from '@/components/metrics/PanelGrowth'
import { getPeriodRange, toDateInputValue, PERIOD_LABELS, type PeriodPreset } from '@/lib/filters/period'

// ÍNDICE DE ANALÍTICA. Antes esta página solo redirigía al embudo: existía en la navegación y no decía
// nada. Ahora es la vista de arriba —la restricción actual, la salud del negocio y qué pide atención—, y
// el embudo, el ranking y la actividad siguen donde estaban como vistas de detalle.
//
// NO SE HA CREADO UN DASHBOARD PARALELO a propósito: se llena un hueco que ya estaba en el menú.

// Usa los mismos límites naturales/móviles que Negocio y el resto de dashboards.
const RANGOS: PeriodPreset[] = ['today', '3d', '7d', 'month', 'quarter', 'year']

export default function AnaliticaIndexPage() {
  const [rango, setRango] = useState<PeriodPreset>('month')
  const range = getPeriodRange(rango, '', '')
  const desde = toDateInputValue(range.from!)
  const hasta = toDateInputValue(range.to!)

  return (
    <div className="dashboard-surface space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Gauge className="h-6 w-6" />
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Analítica</h1>
            <p className="text-sm text-muted-foreground">
              Métricas medidas, calidad de los datos e hipótesis que requieren revisión.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Periodo">
          {RANGOS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRango(r)}
              aria-pressed={rango === r}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                rango === r
                  ? 'bg-brand-600 text-white'
                  : 'border border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {PERIOD_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Periodo: {desde} — {hasta}
      </p>
      <PanelGrowth desde={desde} hasta={hasta} />
    </div>
  )
}
