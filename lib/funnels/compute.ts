// Cálculo de un funnel por etapas. Extiende lib/ads/funnel.ts (de donde vienen `div` y `pct`) en
// vez de duplicar sus fórmulas: la semántica de "denominador 0 → null" tiene que ser una sola.
import { div, pct } from '@/lib/ads/funnel'
import { FUNNEL_DEFS, type FunnelFamily, type StageDef } from '@/lib/funnels/definitions'
import { isUsable, type MetricValue } from '@/lib/funnels/types'

export type StageResult = {
  stage: StageDef
  count: MetricValue
  /** % de esta etapa respecto a la anterior. null si no se puede calcular. */
  conversionFromPrevious: number | null
  /** % de esta etapa respecto a la PRIMERA etapa de la familia. */
  conversionFromTop: number | null
  /** Coste por unidad de esta etapa, si se conoce la inversión. */
  costPerUnit: number | null
  /**
   * Por qué una conversión no se pudo calcular. Que la UI pueda decir "la fuente falló" en vez de
   * un "—" indistinguible de "el denominador era 0".
   */
  blockedBy?: 'error_fuente' | 'no_configurada' | 'unidades_incompatibles'
}

export type FunnelResult = {
  family: FunnelFamily
  label: string
  stages: StageResult[]
  inversion: number | null
  /** true si alguna etapa no se pudo leer o no está configurada: el funnel está incompleto. */
  incomplete: boolean
  /** Fuentes que fallaron de verdad, para nombrarlas en pantalla. */
  failedSources: string[]
  /** Fuentes que solo les falta configuración. Se separan: una pide arreglo, la otra un ajuste. */
  unconfiguredSources: string[]
}

export type ComputeInput = {
  family: FunnelFamily
  /** Recuento por id de etapa. Las etapas ausentes se tratan como no leídas, no como 0. */
  counts: Record<string, MetricValue>
  inversion?: number | null
}

export function computeFunnel({ family, counts, inversion = null }: ComputeInput): FunnelResult {
  const def = FUNNEL_DEFS[family]
  const stages: StageResult[] = []
  const failed = new Set<string>()
  const unconfigured = new Set<string>()

  // La etapa de referencia para "% desde el inicio" es la primera que se haya podido leer: si la
  // primera falló, usar 0 como tope daría porcentajes inventados.
  let top: { value: number; counts: StageDef['counts'] } | null = null
  let previous: { value: number; counts: StageDef['counts'] } | null = null

  for (const stage of def.stages) {
    const count = counts[stage.id] ?? {
      value: null,
      status: 'error_fuente' as const,
      source: stage.source,
      lastSync: null,
      error: 'La etapa no se ha calculado',
    }
    if (count.status === 'error_fuente') failed.add(count.source)
    if (count.status === 'no_configurada') unconfigured.add(count.source)

    const usable = isUsable(count)
    const value = usable ? (count.value as number) : null

    let conversionFromPrevious: number | null = null
    let conversionFromTop: number | null = null
    let blockedBy: StageResult['blockedBy']

    if (!usable) {
      blockedBy = count.status === 'no_configurada' ? 'no_configurada' : 'error_fuente'
    } else if (previous === null) {
      // Primera etapa legible: no hay nada antes con lo que comparar, y eso no es un fallo.
      conversionFromTop = value === null ? null : 100
    } else if (previous.counts !== stage.counts) {
      // Personas contra eventos daría tasas por encima del 100 % sin que nada esté roto.
      blockedBy = 'unidades_incompatibles'
    } else {
      conversionFromPrevious = pct(value as number, previous.value)
      conversionFromTop = top ? pct(value as number, top.value) : null
    }

    stages.push({
      stage,
      count,
      conversionFromPrevious,
      conversionFromTop,
      costPerUnit: usable && inversion !== null ? div(inversion, value as number) : null,
      ...(blockedBy ? { blockedBy } : {}),
    })

    if (usable && value !== null) {
      if (top === null) top = { value, counts: stage.counts }
      previous = { value, counts: stage.counts }
    }
    // Si la etapa falló, `previous` NO se actualiza: la siguiente se compara con la última etapa
    // fiable y se marca, en vez de encadenar una conversión calculada sobre un hueco.
  }

  return {
    family,
    label: def.label,
    stages,
    inversion,
    incomplete: failed.size > 0 || unconfigured.size > 0,
    failedSources: [...failed],
    unconfiguredSources: [...unconfigured],
  }
}
