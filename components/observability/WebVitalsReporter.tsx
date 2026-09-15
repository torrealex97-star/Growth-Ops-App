'use client'

import { useCallback } from 'react'
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

  useReportWebVitals(
    useCallback(
      (metric) => {
        if (!process.env.NEXT_PUBLIC_SENTRY_DSN || !CORE_WEB_VITALS.has(metric.name)) return

        Sentry.metrics.distribution(`web_vital.${metric.name.toLowerCase()}`, metric.value, {
          unit: metric.name === 'CLS' ? 'none' : 'millisecond',
          attributes: {
            route,
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
