'use client'

// El hook que conecta los filtros de la pantalla con la URL. La lógica está en `url-state.ts`, que
// es puro y por eso se puede probar; aquí solo queda el cableado con el router.
//
// Se usa `replace` y no `push`: cambiar un filtro no es navegar. Con `push`, el botón Atrás tendría
// que deshacer un clic de filtro cada vez en lugar de volver a la pantalla anterior.

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { nextSearchParams } from '@/lib/filters/url-state'

/** Lee y escribe los filtros de la pantalla en la URL. */
export function useUrlFilters(porDefecto: Record<string, string> = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const qs = searchParams.toString()
  // Se compara por contenido, no por identidad: quien llama pasa un objeto literal, que es nuevo en
  // cada render y invalidaría el callback en cada pasada (y con él cualquier memo que dependa de él).
  const porDefectoKey = JSON.stringify(porDefecto)

  const get = useCallback((clave: string) => searchParams.get(clave), [searchParams])

  const set = useCallback(
    (cambios: Record<string, string | null | undefined>) => {
      const siguiente = nextSearchParams(qs, cambios, JSON.parse(porDefectoKey) as Record<string, string>)
      router.replace(siguiente ? `${pathname}?${siguiente}` : pathname, { scroll: false })
    },
    [qs, pathname, router, porDefectoKey]
  )

  return useMemo(() => ({ get, set, qs }), [get, set, qs])
}
