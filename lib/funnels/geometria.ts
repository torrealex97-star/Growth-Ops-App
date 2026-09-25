import type { StageResult } from './compute'
import { isUsable } from './types'

// GEOMETRÍA DEL EMBUDO. Vive fuera del componente porque es aritmética pura y se puede probar: el
// fallo que arregla (F24) no se veía en ningún test porque estaba enterrado en el render.

/**
 * Ancho de la barra en porcentaje. La etapa más numerosa ocupa el 100 %.
 *
 * POR QUÉ LA MÁS NUMEROSA Y NO LA PRIMERA (auditoría F24). Tomaba la primera etapa con dato como
 * referencia, y si esa valía CERO —pasa de verdad: sin impresiones registradas pero con gente en
 * las etapas de CRM— la división quedaba descartada y TODAS las barras salían al 1 %: cápsulas
 * estrechas con las etiquetas escondidas por el `overflow-hidden`, incluidas las etapas que sí
 * tenían datos. La proporción respecto a una cima de cero no existe; la de la etapa mayor sí.
 *
 * Esto NO convierte el embudo en una conversión: las proporciones son de tamaño, y la conversión
 * entre etapas sigue saliendo del cálculo, que es quien sabe si las poblaciones están enlazadas.
 */
export function anchos(stages: StageResult[]): number[] {
  const referencia = Math.max(0, ...stages.filter((s) => isUsable(s.count)).map((s) => s.count.value ?? 0))
  return stages.map((s) => {
    // Sin dato, o con todo a cero: ancho mínimo legible, no una raya de 1 %.
    if (!isUsable(s.count) || !referencia) return ANCHO_MINIMO
    // Suelo del 6 %: una etapa con muy poco volumen tiene que seguir siendo visible y clicable.
    return Math.max(6, ((s.count.value ?? 0) / referencia) * 100)
  })
}

/** Por debajo de este ancho, el texto no cabe dentro de la barra y se pinta debajo. */
export const ANCHO_LEGIBLE = 28
const ANCHO_MINIMO = 12
