// DE LAS MEDICIONES A LAS TARJETAS.
//
// `medir()` (lib/metrics/modelo.ts) convierte una definición + un valor en una métrica lista para pintar,
// con su semáforo y su estado de dato. Este módulo hace ese paso para todas las mediciones de golpe, y es
// puro para poder probarlo: el semáforo decide de qué color ve alguien su negocio, así que no puede
// depender de que un componente se haya montado.
//
// LO QUE TRADUCE, Y ES LO IMPORTANTE. Una medición sin valor trae un MOTIVO ("no hay días de campaña
// cargados"), y ese motivo tiene que llegar a la tarjeta. Si se pierde en la traducción, la tarjeta pone
// un guion y la persona no sabe si no hay datos, si falló la lectura o si el negocio hizo cero.

import type { Medicion } from './agregados'
import { medir, type MetricaMedida } from './modelo'
import { TODAS_LAS_METRICAS } from './registro'

/**
 * Convierte las mediciones en métricas pintables, en el orden del registro.
 *
 * El orden lo pone el registro y no el objeto de mediciones: las claves de un objeto salen en el orden
 * en que se insertaron, así que el panel cambiaría de orden según cómo se calculó. Un panel que reordena
 * sus tarjetas entre visitas se lee como si hubiera cambiado algo.
 */
export function medirTodas(
  mediciones: Record<string, Medicion>,
  opciones: { anteriores?: Record<string, Medicion>; soloCategoria?: string } = {}
): MetricaMedida[] {
  const salida: MetricaMedida[] = []
  for (const def of TODAS_LAS_METRICAS) {
    if (opciones.soloCategoria && def.category !== opciones.soloCategoria) continue
    const m = mediciones[def.key]
    if (!m) continue
    salida.push(
      medir(def, {
        value: m.valor,
        previousValue: opciones.anteriores?.[def.key]?.valor ?? null,
        // Un motivo presente significa que no se pudo medir. Se traslada tal cual para que la tarjeta
        // diga qué falta en vez de poner un guion mudo.
        estadoDato: m.valor === null ? 'sin_datos' : 'ok',
        notaDato: m.motivo,
        // La fiabilidad sale del tamaño de muestra, que es lo único que la determina de verdad.
        dataReliability: fiabilidadPorMuestra(m.muestra),
      })
    )
  }
  return salida
}

/**
 * Fiabilidad según la muestra.
 *
 * Los cortes son los mismos que usa el motor de diagnóstico (20 y 100) a propósito: si la tarjeta dijera
 * "fiabilidad alta" sobre una muestra que el motor considera corta, el panel y el diagnóstico estarían
 * diciendo cosas distintas del mismo número.
 */
export function fiabilidadPorMuestra(muestra: number | null): 'alta' | 'media' | 'baja' {
  if (muestra === null) return 'baja'
  if (muestra >= 100) return 'alta'
  if (muestra >= 20) return 'media'
  return 'baja'
}

/** Busca una métrica medida por su clave, para las tarjetas que se colocan a mano. */
export function medidaDe(medidas: MetricaMedida[], key: string): MetricaMedida | undefined {
  return medidas.find((m) => m.key === key)
}

/**
 * Cuántas de las métricas de una categoría se pueden enseñar con un número, y cuántas son huecos.
 *
 * Va en la cabecera del panel: sin esto, una pantalla con doce tarjetas en gris parece rota, cuando lo
 * que pasa es que falta conectar una integración. Decir "8 de 12 medidas" convierte una pantalla que
 * parece averiada en una pantalla que explica qué falta.
 */
export function coberturaDeCategoria(medidas: MetricaMedida[]): { medidas: number; huecos: number; total: number } {
  const conValor = medidas.filter((m) => m.value !== null).length
  return { medidas: conValor, huecos: medidas.length - conValor, total: medidas.length }
}

/** Las claves de una categoría del registro, para pedir solo lo que una pantalla va a pintar. */
export function clavesDeCategoria(categoria: string): string[] {
  return TODAS_LAS_METRICAS.filter((m) => m.category === categoria).map((m) => m.key)
}
