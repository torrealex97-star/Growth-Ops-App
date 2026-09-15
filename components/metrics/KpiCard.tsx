'use client'

// TARJETA DE UN KPI. Una sola, para que el mismo número no se pinte de dos maneras según la pantalla.
//
// QUÉ MUESTRA, y nada más: nombre, valor, variación contra el periodo anterior, objetivo y estado. Sin
// card dentro de card, sin degradados, sin badges de adorno. El panel tiene que poder leerse de un
// barrido, y cada elemento decorativo es un elemento que compite con el número.
//
// DOS COSAS QUE ESTA TARJETA NO HACE, a propósito:
//
// 1. NO DECIDE EL SEMÁFORO. Se lo dan ya calculado (lib/metrics/modelo). Si lo decidiera aquí, dos
//    pantallas con la misma métrica podrían pintarla distinto.
// 2. NO CONVIERTE UN HUECO EN UN CERO. Sin dato se escribe qué falta —"fuente no conectada", "sin
//    medir"— en vez de un 0 que se lee como un resultado. Un 0% de Pitch Rate dice que el equipo no
//    presenta ofertas; "sin medir" dice que nadie lo registra todavía. No son lo mismo.

import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react'
import { MetricTooltip } from '@/components/metrics/MetricTooltip'
import { esMejora, textoObjetivo, type EstadoSemaforo, type MetricaMedida } from '@/lib/metrics/modelo'
import { cn } from '@/lib/utils'

/**
 * Un punto de color, no un fondo de color. El fondo teñido de una tarjeta entera compite con la cifra
 * y, cuando hay doce, convierte el panel en un semáforo roto.
 */
const COLOR_ESTADO: Record<EstadoSemaforo, string> = {
  verde: 'bg-emerald-500',
  amarillo: 'bg-amber-500',
  rojo: 'bg-red-500',
  gris: 'bg-muted-foreground/40',
}

const ETIQUETA_DATO: Record<string, string> = {
  sin_datos: 'Sin datos',
  fuente_no_conectada: 'Fuente no conectada',
  no_medido: 'Sin medir todavía',
  parcial: 'Datos parciales',
  error: 'Error al leer la fuente',
}

/** Formatea según la unidad declarada. El número nunca se pinta "a pelo". */
export function formatearValor(valor: number | null, unidad: MetricaMedida['unit']): string {
  if (valor === null || !Number.isFinite(valor)) return '—'
  switch (unidad) {
    case 'eur':
      return valor.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    case 'porcentaje':
      return `${valor.toLocaleString('es-ES', { maximumFractionDigits: 1 })}%`
    case 'ratio':
      return `${valor.toLocaleString('es-ES', { maximumFractionDigits: 2 })}x`
    case 'minutos':
      return `${valor.toLocaleString('es-ES', { maximumFractionDigits: 0 })} min`
    case 'dias':
      return `${valor.toLocaleString('es-ES', { maximumFractionDigits: 0 })} d`
    default:
      return valor.toLocaleString('es-ES', { maximumFractionDigits: 0 })
  }
}

export function KpiCard({
  metrica,
  etiquetaPeriodoAnterior = 'vs periodo anterior',
  className,
  onDrilldown,
}: {
  metrica: MetricaMedida
  etiquetaPeriodoAnterior?: string
  className?: string
  /** Abre el detalle de los registros que componen el número. Sin esto, nadie se fía de la cifra. */
  onDrilldown?: () => void
}) {
  const mejora = esMejora(metrica.higherIsBetter, metrica.absoluteChange)
  const hayDato = metrica.value !== null && metrica.estadoDato === 'ok'
  const objetivo = textoObjetivo(metrica)

  return (
    <div className={cn('dashboard-card p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <MetricTooltip
          contenido={{
            nombre: metrica.name,
            queEs: metrica.description,
            formula: metrica.formula,
            porQueImporta: metrica.whyItMatters,
            fuente: metrica.dataSource,
            objetivo,
            fiabilidad: metrica.dataReliability,
            notaDato: metrica.notaDato,
          }}
        >
          <span className="text-xs font-medium text-muted-foreground">{metrica.name}</span>
        </MetricTooltip>

        <span
          aria-hidden
          className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', COLOR_ESTADO[metrica.status])}
          title={metrica.status === 'gris' ? 'Sin juicio: falta dato u objetivo' : undefined}
        />
      </div>

      <div className="mt-2">
        {hayDato ? (
          <span className="block font-display text-2xl font-semibold tabular-nums text-foreground">
            {formatearValor(metrica.value, metrica.unit)}
          </span>
        ) : (
          // AQUÍ ESTÁ LA DECISIÓN IMPORTANTE: se dice qué falta, no se pinta un cero.
          <span className="block text-sm font-medium text-muted-foreground">
            {ETIQUETA_DATO[metrica.estadoDato] ?? 'Sin datos'}
          </span>
        )}
      </div>

      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1">
        {/* La variación solo se pinta si hay con qué comparar. Un "0%" inventado por falta de periodo
            anterior diría que el negocio está plano. */}
        {hayDato && metrica.absoluteChange !== null ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs tabular-nums',
              mejora === true && 'text-emerald-500',
              mejora === false && 'text-red-500',
              mejora === null && 'text-muted-foreground'
            )}
          >
            {mejora === null ? (
              <ArrowRight className="h-3 w-3" />
            ) : // La FLECHA sigue al número y el COLOR sigue al negocio: un CAC que baja lleva flecha
            // hacia abajo y color verde. Atarlos entre sí es el error clásico de estos paneles.
            metrica.absoluteChange > 0 ? (
              <ArrowUp className="h-3 w-3" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            )}
            {metrica.percentageChange !== null
              ? `${Math.abs(metrica.percentageChange).toLocaleString('es-ES', { maximumFractionDigits: 1 })}%`
              : formatearValor(Math.abs(metrica.absoluteChange), metrica.unit)}
            <span className="text-muted-foreground">{etiquetaPeriodoAnterior}</span>
          </span>
        ) : null}

        {objetivo ? <span className="text-xs text-muted-foreground">Objetivo {objetivo}</span> : null}
      </div>

      {onDrilldown ? (
        <button
          type="button"
          onClick={onDrilldown}
          className="mt-3 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          Ver los registros
        </button>
      ) : null}
    </div>
  )
}
