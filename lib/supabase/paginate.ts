// Lectura COMPLETA de una consulta de PostgREST, página a página.
//
// POR QUÉ EXISTE. PostgREST devuelve como máximo 1.000 filas por petición (el tope por defecto de
// Supabase) y NO avisa de que ha recortado: la consulta responde `ok` con las primeras 1.000. Una
// suma sobre eso —gasto de campañas, cash collected, comisiones del mes— da un número más pequeño
// que el real y con toda la pinta de ser correcto. Es el fallo silencioso más caro de esta base de
// datos, y ya se arregló a mano en las pantallas de Finanzas con `.range(0, CAP)`; esto lo hace
// bien (recorre TODAS las páginas) y en un solo sitio.
//
// El tipo es estructural a propósito: encaja con cualquier query builder de supabase-js sin
// arrastrar sus genéricos.

export type RangeQuery<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
}

export const PAGE_SIZE = 1000

export type PaginatedResult<T> = {
  rows: T[]
  /** `null` si no se pudo leer. Un hueco no es un cero: quien llama debe distinguirlo. */
  error: string | null
  /** `true` si se alcanzó el tope de páginas y por tanto PUEDE faltar información. */
  truncated: boolean
}

/**
 * `make` se llama una vez por página y debe devolver una consulta NUEVA (los builders de
 * supabase-js no se pueden reutilizar tras ejecutarlos).
 */
export async function fetchAllRows<T>(
  make: () => RangeQuery<T>,
  opts: { pageSize?: number; maxPages?: number } = {}
): Promise<PaginatedResult<T>> {
  const pageSize = opts.pageSize ?? PAGE_SIZE
  const maxPages = opts.maxPages ?? 50
  const rows: T[] = []
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize
    const { data, error } = await make().range(from, from + pageSize - 1)
    if (error) return { rows, error: error.message, truncated: false }
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < pageSize) return { rows, error: null, truncated: false }
  }
  return { rows, error: null, truncated: true }
}
