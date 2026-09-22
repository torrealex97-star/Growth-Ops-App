// UN HUECO NO ES UN CERO — aplicado a las pantallas que leen varias tablas a la vez.
//
// El patrón que había en las pantallas de dinero era `salesRes.data || []`: si la consulta fallaba
// (permisos, red, esquema), la lista quedaba vacía y el panel pintaba **0 €** con total aplomo. Un
// cero y un "no se pudo leer" son cosas distintas, y en facturación la diferencia es decidir sobre
// datos que no existen.
//
// `primerError` devuelve el primer fallo de un grupo de consultas para que la pantalla lo diga en vez
// de rellenar con ceros. No sustituye a los datos: se usa junto a ellos.

export type ResultadoConsulta = { error?: { message?: string | null } | null }

/** Mensaje del primer resultado con error, o null si todos fueron bien. */
export function primerError(...resultados: (ResultadoConsulta | null | undefined)[]): string | null {
  for (const r of resultados) {
    const mensaje = r?.error?.message
    if (r?.error) return mensaje?.trim() || 'La consulta no se pudo completar.'
  }
  return null
}

/**
 * Frase para la pantalla. Nombra lo que no se pudo cargar y evita el número inventado, sin soltar el
 * error técnico en crudo delante de alguien que no puede hacer nada con él.
 */
export function mensajeDeCarga(que: string, error: string): string {
  return `No se pudieron cargar ${que}. Las cifras de esta pantalla estarían incompletas, así que no se muestran. Detalle: ${error}`
}
