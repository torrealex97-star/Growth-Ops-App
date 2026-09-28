'use client'

// FUNNEL GLOBAL CANÓNICO (§22/§23 de la spec del dashboard global).
// Componente puro de presentación: recibe el funnel calculado con las utilidades puras de
// lib/canonical/dedup y lo pinta con la semántica 0 ≠ "—" (§39).
//
// El diagnóstico de CALIDAD DE DATOS no vive aquí: su única casa es Data Health
// (components/settings/DataHealthPanel.tsx), que también suma el hueco de captura
// "contactos sin canal".

import { useMemo } from 'react'
import { InfoHint } from '@/components/ui/info-hint'

export type FunnelGlobal = {
  newUniqueLeads: number
  booked: number
  shows: number
  offers: number
  /** Ofertas DECLARADAS (alguien marcó Sí/No en la ficha): distinguen el dato real de la suposición. */
  offersDeclaradas: number
  sales: number
}

export function FunnelCanonicoPanel({ funnel }: { funnel: FunnelGlobal }) {
  // Recuentos del mismo periodo; sin cocientes entre poblaciones no enlazadas.
  const etapas = useMemo(() => {
    return [
      { from: 'Leads', to: 'Agendas', value: funnel.booked },
      { from: 'Agendas', to: 'Shows', value: funnel.shows },
      {
        from: 'Shows',
        // Sin NINGUNA marca, la etapa es la suposición del negocio y hay que decirlo: un Show →
        // Oferta "100%" que nadie midió no es un logro, es el criterio por defecto.
        to: funnel.offersDeclaradas === 0 && funnel.offers > 0 ? 'Ofertas (supuestas)' : 'Ofertas',
        value: funnel.offers,
      },
      { from: 'Ofertas', to: 'Ventas', value: funnel.sales },
    ]
  }, [funnel])

  return (
    <div className="dashboard-card p-5">
      <h3 className="font-display text-lg font-semibold">
        Detalle de actividad del periodo
        <span className="ml-2 align-middle">
          <InfoHint text="Personas deduplicadas antes de filtrar por primera fecha conocida en origen (first_seen_at; created_at como respaldo). Las citas y ventas usan su propia fecha del periodo." />
        </span>
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Mismo periodo y población que el embudo superior. Recuentos de actividad sin conversión entre personas no
        enlazadas. El diagnóstico de calidad de datos vive en Configuración › Data Health.
      </p>
      {funnel.offersDeclaradas === 0 && funnel.offers > 0 && (
        <p className="mt-1 text-xs text-amber-400/90">
          Nadie ha marcado todavía si presentó la oferta: las llamadas celebradas cuentan como oferta por la regla del
          negocio. Las ofertas declaradas y las supuestas se conservan diferenciadas.
        </p>
      )}
      <div className="mt-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">Nuevos leads únicos</span>
          <span className="font-display text-xl font-semibold tabular-nums">{funnel.newUniqueLeads}</span>
        </div>
        {etapas.map((e) => (
          <div key={`${e.from}-${e.to}`}>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">→ {e.to} </span>
              <span className="font-display text-lg font-semibold tabular-nums">{e.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
