// QUÉ MÉTRICAS SE PUEDEN JUZGAR TODAVÍA.
//
// Un KPI sin objetivo cumplido no es lo mismo que un KPI que no se puede medir aún. Si 328 citas ya
// pasadas no tienen marcado si la persona apareció, el show rate y el close rate sobre llamadas salen
// "fuera de objetivo" por falta de marcado, no por el negocio. Este módulo separa lo juzgable de lo
// provisional ANTES de diagnosticar o alertar. Es puro: no sabe nada de Supabase.

import type { EntradaMetrica } from './cuello-botella'
import { MUESTRA_MINIMA } from './razon'

/** Métricas cuyo denominador es "personas que aparecieron": dependen de que alguien marque asistencia. */
export const DEPENDEN_DE_ASISTENCIA: ReadonlySet<string> = new Set(['show_rate', 'pitch_rate', 'close_rate_llamadas'])

/** Por debajo de esta fracción de citas pasadas resueltas, las métricas de asistencia no son fiables. */
export const COBERTURA_MINIMA_MARCADO = 0.8

export type Provisional = { key: string; nombre: string; motivo: string }

export function depurarPorFiabilidad(
  metricas: EntradaMetrica[],
  marcado: { fraccionResuelta: number | null; pasadasSinMarcar: number }
): { fiables: EntradaMetrica[]; provisionales: Provisional[] } {
  const fiables: EntradaMetrica[] = []
  const provisionales: Provisional[] = []
  const marcadoInsuficiente = marcado.pasadasSinMarcar > 0 && (marcado.fraccionResuelta ?? 0) < COBERTURA_MINIMA_MARCADO
  for (const m of metricas) {
    if (m.valor === null) {
      fiables.push(m)
    } else if (marcadoInsuficiente && DEPENDEN_DE_ASISTENCIA.has(m.key)) {
      provisionales.push({
        key: m.key,
        nombre: m.nombre,
        motivo: `${marcado.pasadasSinMarcar} citas pasadas sin marcar asistencia: el valor es provisional, no se juzga contra el objetivo.`,
      })
    } else if (m.muestra !== null && m.muestra < MUESTRA_MINIMA) {
      provisionales.push({
        key: m.key,
        nombre: m.nombre,
        motivo: `Muestra de ${m.muestra}: demasiado pequeña para juzgarlo contra el objetivo.`,
      })
    } else {
      fiables.push(m)
    }
  }
  return { fiables, provisionales }
}
