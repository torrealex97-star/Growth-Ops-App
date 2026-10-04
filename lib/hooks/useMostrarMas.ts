import { useEffect, useState } from 'react'

/** Tamaño de página por defecto de las listas largas (cientos de filas pintadas de golpe tardan segundos). */
export const PAGINA_LISTA = 50

/** Cuántas filas se pintan: `pagina` por tanto como veces se haya pedido más, sin pasar del total. */
export function filasVisibles(total: number, pagina: number, paginasPedidas: number): number {
  return Math.min(total, pagina * Math.max(1, paginasPedidas))
}

/**
 * Pinta la lista por tramos y la vuelve a empezar cuando cambia la consulta (`clave`: filtros,
 * búsqueda…), para que un filtro nuevo no deje al usuario en la página 7 de otra lista.
 */
export function useMostrarMas<T>(items: T[], clave: unknown, pagina = PAGINA_LISTA) {
  const [paginas, setPaginas] = useState(1)
  useEffect(() => setPaginas(1), [clave])
  const n = filasVisibles(items.length, pagina, paginas)
  return {
    visibles: items.slice(0, n),
    restantes: items.length - n,
    mostrarMas: () => setPaginas((p) => p + 1),
  }
}
