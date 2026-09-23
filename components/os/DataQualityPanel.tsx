'use client'

// FUNNEL GLOBAL CANÓNICO (§22/§23 de la spec del dashboard global).
// Componente puro de presentación: recibe el funnel calculado con las utilidades puras de
// lib/canonical/dedup y lo pinta con la semántica 0 ≠ "—" (§39).
//
// El diagnóstico de CALIDAD DE DATOS no vive aquí: su única casa es Data Health
// (components/settings/DataHealthPanel.tsx), que también suma el hueco de captura
// "contactos sin canal".

import { useMemo } from 'react'
import { formatPercent } from '@/lib/utils'
import { SOURCE_REGISTRY } from '@/lib/sources/registry'
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

const pct = (n: number | null) => (n == null ? '—' : formatPercent(n, 0))

// Etiqueta de fuente con tooltip (§37): qué es, fórmula, source of truth y fallbacks.
// InfoHint: el cartel queda ~20 s tras salir del hover — tiempo de leer la fórmula entera.
function SourceHint({ metric }: { metric: string }) {
  const def = SOURCE_REGISTRY[metric]
  if (!def) return null
  const fallbacks = def.fallbacks.length ? def.fallbacks.join(' › ') : 'ninguno'
  const text = `${def.what}\nFórmula: ${def.formula}\nSource of Truth: ${def.primary}. Fallback: ${fallbacks}.`
  return <InfoHint text={text} />
}

export function FunnelCanonicoPanel({ funnel }: { funnel: FunnelGlobal }) {
  // Funnel global (§23): conversiones y drop-off por etapa. Oferta incluida con offer_made cuando
  // exista; si ninguna oferta está registrada, la etapa se muestra sin romper el resto.
  const etapas = useMemo(() => {
    const conTasa = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null)
    return [
      { from: 'Leads', to: 'Agendas', value: funnel.booked, rate: conTasa(funnel.booked, funnel.newUniqueLeads) },
      { from: 'Agendas', to: 'Shows', value: funnel.shows, rate: conTasa(funnel.shows, funnel.booked) },
      {
        from: 'Shows',
        // Sin NINGUNA marca, la etapa es la suposición del negocio y hay que decirlo: un Show →
        // Oferta "100%" que nadie midió no es un logro, es el criterio por defecto.
        to: funnel.offersDeclaradas === 0 && funnel.offers > 0 ? 'Ofertas (supuestas)' : 'Ofertas',
        value: funnel.offers,
        rate: conTasa(funnel.offers, funnel.shows),
      },
      { from: 'Ofertas', to: 'Ventas', value: funnel.sales, rate: conTasa(funnel.sales, funnel.offers) },
    ]
  }, [funnel])

  return (
    <div className="dashboard-card p-5">
      <h3 className="font-display text-lg font-semibold">
        Funnel del negocio
        <span className="ml-2 align-middle">
          <SourceHint metric="lead" />
        </span>
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Entidades canónicas: leads únicos, agendas consolidadas, shows confirmados, ventas sin doble conteo. El
        diagnóstico de calidad de datos vive en Configuración › Data Health.
      </p>
      {funnel.offersDeclaradas === 0 && funnel.offers > 0 && (
        <p className="mt-1 text-xs text-amber-400/90">
          Nadie ha marcado todavía si presentó la oferta: las llamadas celebradas cuentan como oferta por la regla del
          negocio. En cuanto alguien marque un “No” en la ficha de la agenda, la etapa pasa a dato real.
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
              <span className="text-sm text-muted-foreground">
                → {e.to}{' '}
                <span className="text-[10px]">
                  {e.from} → {e.to} %
                </span>
              </span>
              <span className="font-display text-lg font-semibold tabular-nums">{e.value}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-brand-500"
                  style={{ width: `${e.rate != null ? Math.max(2, Math.min(100, e.rate)) : 0}%` }}
                />
              </div>
              <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{pct(e.rate)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
