// DE LAS MEDICIONES AL MOTOR DE DIAGNÓSTICO.
//
// El motor de cuello de botella no sabe nada de Supabase: pide `EntradaMetrica[]` con el nivel de la
// jerarquía, el objetivo y la muestra. El registro (lib/metrics/registro.ts) tiene los objetivos y los
// nombres. Las mediciones vienen de agregados.ts. Este módulo los cruza, y es puro.
//
// POR QUÉ IMPORTA QUE ESTÉ AQUÍ Y NO EN LA PANTALLA. Si cada pantalla decidiera a qué nivel de la
// jerarquía pertenece el CAC, dos pantallas darían dos diagnósticos distintos con los mismos datos.

import type { EntradaMetrica, NivelDiagnostico } from './cuello-botella'
import type { DimensionSalud } from './salud'
import type { Agregados } from './agregados'
import { buscarMetrica } from './registro'

/**
 * A qué nivel de la jerarquía pertenece cada métrica.
 *
 * ECONOMÍA → CAJA → VENTAS → OPORTUNIDADES → FUNNEL → TRÁFICO, y el orden manda: es lo que impide que
 * el panel abra señalando el CTR cuando lo que está roto es el CAC.
 */
export const NIVEL_POR_METRICA: Record<string, NivelDiagnostico> = {
  ltgp_cac: 'economia',
  cac: 'economia',
  cash_roas: 'caja',
  cash_collected: 'caja',
  contracted_revenue: 'caja',
  cash_collection_ratio: 'caja',
  close_rate_llamadas: 'ventas',
  close_rate_ofertas: 'ventas',
  pitch_rate: 'ventas',
  aov: 'ventas',
  ventas: 'ventas',
  show_rate: 'oportunidades',
  cpqbc: 'oportunidades',
  agendas_cualificadas: 'oportunidades',
  agendas: 'oportunidades',
  speed_to_lead: 'funnel',
  bamfam_rate: 'funnel',
  ctr: 'trafico',
  cpc: 'trafico',
  cpm: 'trafico',
  ad_spend: 'trafico',
}

/** A qué dimensión de la salud del negocio contribuye cada métrica. */
export const DIMENSION_POR_METRICA: Record<string, DimensionSalud> = {
  ltgp_cac: 'financiera',
  cac: 'financiera',
  cash_roas: 'financiera',
  cash_collection_ratio: 'financiera',
  close_rate_llamadas: 'ventas',
  close_rate_ofertas: 'ventas',
  pitch_rate: 'ventas',
  show_rate: 'ventas',
  aov: 'ventas',
  cpqbc: 'adquisicion',
  agendas_cualificadas: 'adquisicion',
  ctr: 'adquisicion',
  cpc: 'adquisicion',
  speed_to_lead: 'adquisicion',
}

/**
 * Qué mirar si una métrica resulta ser la restricción. Del árbol de diagnóstico del negocio.
 *
 * Sin esto, el panel señala un número y deja a la persona adivinando qué hacer con él, que es la mitad
 * del problema que este sistema existe para resolver.
 */
export const INVESTIGAR_POR_METRICA: Record<string, string[]> = {
  cac: [
    'Revisar el CPQBC por campaña',
    'Comparar close rate entre closers',
    'Comprobar si subió el CPL o cayó el cierre',
  ],
  cash_roas: ['Revisar el plan de pagos: cuánto se cobra el día 1', 'Comprobar la morosidad de los plazos'],
  close_rate_llamadas: ['Escuchar las últimas 5 llamadas perdidas', 'Revisar el manejo de objeciones de precio'],
  close_rate_ofertas: ['Revisar el cierre: se ofrece pero no se cierra'],
  pitch_rate: ['Comprobar por qué no se llega a la oferta: cualificación o descubrimiento'],
  show_rate: ['Revisar la secuencia de recordatorios', 'Comprobar el tiempo entre agendar y la llamada'],
  cpqbc: ['Revisar la segmentación y el creativo', 'Comprobar la cualificación del formulario'],
  agendas_cualificadas: [
    'Revisar las preguntas del formulario',
    'Comprobar de dónde vienen las agendas que no cualifican',
  ],
  aov: ['Revisar el precio y los extras', 'Comprobar el mix de planes de pago'],
  ctr: ['Probar creativos nuevos', 'Revisar la frecuencia: puede estar quemada la audiencia'],
  cpc: ['Revisar la puja y la competencia de la audiencia'],
  cpm: ['Revisar el tamaño de la audiencia y la frecuencia'],
}

/**
 * El objetivo de una métrica, según CÓMO esté declarado.
 *
 * EL BUG QUE ESTO EVITA, y era grande: el registro declara los objetivos de cuatro formas distintas
 * (`minimo`, `maximo`, `rango` y `ninguno`), pero solo TRES métricas tienen un `target` escalar. Leer
 * únicamente `def.target` dejaba fuera el Show Rate —que va por rango 65-70— y con él a cualquier
 * métrica de rango futura: el motor de cuello de botella habría mirado tres métricas de veinte y no
 * habría fallado, simplemente no habría diagnosticado nada. Un motor que calla no se distingue de un
 * negocio sano.
 *
 * Para un rango, el objetivo relevante es el EXTREMO QUE DUELE: el suelo si más es mejor, el techo si
 * menos es mejor. Estar por encima de 70 en Show Rate no es un problema que haya que arreglar.
 */
export function objetivoDe(def: {
  targetType?: string
  target?: number
  targetMin?: number
  targetMax?: number
  higherIsBetter: boolean
}): number | null {
  switch (def.targetType) {
    case 'minimo':
    case 'maximo':
      return def.target ?? null
    case 'rango':
      return (def.higherIsBetter ? def.targetMin : def.targetMax) ?? null
    default:
      // 'ninguno' o sin declarar: no hay objetivo, y no se finge uno. La métrica se enseña sin veredicto.
      return null
  }
}

/**
 * Convierte las mediciones en entradas para el motor.
 *
 * Solo entran las métricas que están en `NIVEL_POR_METRICA`: una métrica sin nivel no se puede ordenar
 * en la jerarquía, y colocarla "donde sea" produciría un diagnóstico que depende del orden del objeto.
 */
export function entradasDiagnostico(agregados: Agregados): EntradaMetrica[] {
  const entradas: EntradaMetrica[] = []
  for (const [key, medicion] of Object.entries(agregados)) {
    const nivel = NIVEL_POR_METRICA[key]
    if (!nivel) continue
    const def = buscarMetrica(key)
    entradas.push({
      key,
      nombre: def?.name ?? key,
      nivel,
      valor: medicion.valor,
      // El objetivo sale del registro, que es la fuente única: si cada pantalla pusiera el suyo, dos
      // pantallas dirían que la misma métrica cumple y no cumple. Y se lee según su tipo, no solo
      // `target`: ver objetivoDe().
      objetivo: def ? objetivoDe(def) : null,
      higherIsBetter: def?.higherIsBetter ?? true,
      muestra: medicion.muestra,
      investigar: INVESTIGAR_POR_METRICA[key] ?? [],
    })
  }
  return entradas
}

/** Agrupa las mediciones por dimensión de salud, listas para `calcularSalud`. */
export function entradasSalud(agregados: Agregados): Partial<Record<DimensionSalud, EntradaMetrica[]>> {
  const porDimension: Partial<Record<DimensionSalud, EntradaMetrica[]>> = {}
  for (const entrada of entradasDiagnostico(agregados)) {
    const dimension = DIMENSION_POR_METRICA[entrada.key]
    if (!dimension) continue
    ;(porDimension[dimension] ??= []).push(entrada)
  }
  return porDimension
}
