'use client'

import { useCallback, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useReportWebVitals } from 'next/web-vitals'
import * as Sentry from '@sentry/nextjs'
import { normalizarRutaTenant } from '@/lib/observability/peticion'

const CORE_WEB_VITALS = new Set(['CLS', 'INP', 'LCP'])

/**
 * Registra las tres Core Web Vitals reales del navegador en la instalación de Sentry existente.
 * Sin DSN es completamente inerte. La ruta se agrupa y no incluye el slug de la subcuenta, ids,
 * parámetros ni información personal.
 */
export function WebVitalsReporter() {
  const pathname = usePathname()
  const route = normalizarRutaTenant(pathname)

  // CLS es acumulativo para TODA la pestaña (el navegador no lo resetea en una navegación de
  // cliente de App Router, que nunca recarga el documento) — el valor que se reporta en cualquier
  // momento es la suma de todos los saltos de layout desde que se abrió la pestaña, no de la
  // página actual. Etiquetarlo con `route` (la página donde el usuario está AHORA) hace que un
  // único salto temprano en /dashboard aparezca como "poor" en las 20 páginas visitadas después en
  // esa misma sesión — hallazgo real en producción (mismo valor exacto de CLS en rutas sin
  // relación). Se etiqueta con la ruta de ENTRADA de la sesión, capturada una sola vez, para que el
  // dato apunte a dónde probablemente ocurrió el salto en vez de contaminar cada página siguiente.
  const rutaEntrada = useRef(route)

  useReportWebVitals(
    useCallback(
      (metric) => {
        if (!process.env.NEXT_PUBLIC_SENTRY_DSN || !CORE_WEB_VITALS.has(metric.name)) return

        Sentry.metrics.distribution(`web_vital.${metric.name.toLowerCase()}`, metric.value, {
          unit: metric.name === 'CLS' ? 'none' : 'millisecond',
          attributes: {
            route: metric.name === 'CLS' ? rutaEntrada.current : route,
            rating: metric.rating,
            navigation_type: metric.navigationType,
          },
        })
      },
      [route]
    )
  )

  return null
}
