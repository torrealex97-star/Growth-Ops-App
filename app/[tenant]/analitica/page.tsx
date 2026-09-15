'use client'

import { useState } from 'react'
import { Gauge } from 'lucide-react'
import { PanelGrowth } from '@/components/metrics/PanelGrowth'

// ÍNDICE DE ANALÍTICA. Antes esta página solo redirigía al embudo: existía en la navegación y no decía
// nada. Ahora es la vista de arriba —la restricción actual, la salud del negocio y qué pide atención—, y
// el embudo, el ranking y la actividad siguen donde estaban como vistas de detalle.
//
// NO SE HA CREADO UN DASHBOARD PARALELO a propósito: se llena un hueco que ya estaba en el menú.

/** Rangos de los filtros. Los mismos en todas las pantallas de métricas, para no aprender dos idiomas. */
const RANGOS = [
  { id: 'hoy', label: 'Hoy', dias: 0 },
  { id: '3d', label: '3 días', dias: 3 },
  { id: '7d', label: '7 días', dias: 7 },
  { id: 'mes', label: 'Este mes', dias: null },
  { id: '90d', label: 'Trimestre', dias: 90 },
  { id: 'ano', label: 'Año', dias: 365 },
] as const

function rangoAFechas(id: string): { desde: string; hasta: string } {
  const hoy = new Date()
  const hasta = hoy.toISOString().slice(0, 10)
  if (id === 'mes') {
    const primero = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1))
    return { desde: primero.toISOString().slice(0, 10), hasta }
  }
  const dias = RANGOS.find((r) => r.id === id)?.dias ?? 0
  const desde = new Date(hoy.getTime() - (dias ?? 0) * 86_400_000)
  return { desde: desde.toISOString().slice(0, 10), hasta }
}

export default function AnaliticaIndexPage() {
  const [rango, setRango] = useState<string>('mes')
  const { desde, hasta } = rangoAFechas(rango)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Gauge className="h-6 w-6" />
          <div>
            <h1 className="text-xl font-semibold">Analítica</h1>
            <p className="text-sm text-muted-foreground">
              Qué está limitando el crecimiento ahora mismo, y qué hacer con ello.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Periodo">
          {RANGOS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRango(r.id)}
              aria-pressed={rango === r.id}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                rango === r.id
                  ? 'bg-brand-600 text-white'
                  : 'border border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <PanelGrowth desde={desde} hasta={hasta} />
    </div>
  )
}
