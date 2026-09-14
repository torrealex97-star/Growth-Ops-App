// Filtros en la URL, para que refrescar o compartir el enlace conserve el contexto.
//
// Este módulo es PURO a propósito (sin React ni next/navigation): es la parte que se puede probar
// sin montar un navegador. El hook que la usa vive en `use-url-filters.ts`.
//
// POR QUÉ: los filtros vivían solo en `useState`. Refrescar la pantalla —o mandarle el enlace a
// alguien— devolvía a "Todo" y a "Todas las cuentas", así que dos personas mirando "el mismo panel"
// podían estar viendo periodos distintos sin saberlo. Con el estado en la URL, el enlace ES el
// panel.
//
// Se usa `replace` y no `push`: cambiar un filtro no es navegar. Con `push`, el botón Atrás del
// navegador tendría que deshacer un clic de filtro cada vez en lugar de volver a la pantalla
// anterior.

/** Los filtros que el brief pide conservar (§6): periodo, cuenta y campaña. */
type UrlFilters = {
  period?: string
  from?: string
  to?: string
  account?: string
  campaign?: string
}

/**
 * Construye el query string siguiente a partir del actual. Un valor vacío, nulo o igual al
 * predeterminado se BORRA del query en vez de escribirse: así la URL limpia sigue siendo la URL
 * limpia y no se acumula `?period=&account=all&campaign=`.
 */
export function nextSearchParams(
  actual: URLSearchParams | string,
  cambios: Record<string, string | null | undefined>,
  porDefecto: Record<string, string> = {}
): string {
  const params = new URLSearchParams(typeof actual === 'string' ? actual : actual.toString())
  for (const [clave, valor] of Object.entries(cambios)) {
    const limpio = (valor ?? '').trim()
    if (!limpio || limpio === porDefecto[clave]) params.delete(clave)
    else params.set(clave, limpio)
  }
  // Orden estable: dos pantallas con los mismos filtros producen la misma URL, que es lo que hace
  // comparable un enlace compartido.
  const ordenados = new URLSearchParams()
  for (const clave of [...params.keys()].sort()) {
    const v = params.get(clave)
    if (v != null) ordenados.set(clave, v)
  }
  return ordenados.toString()
}

/**
 * Lee un filtro de la URL validándolo contra los valores permitidos. Un valor inventado en el
 * query (alguien edita el enlace a mano) cae al predeterminado en vez de dejar la pantalla en un
 * estado imposible.
 */
export function readEnum<T extends string>(raw: string | null | undefined, permitidos: readonly T[], porDefecto: T): T {
  const v = (raw ?? '').trim() as T
  return permitidos.includes(v) ? v : porDefecto
}
