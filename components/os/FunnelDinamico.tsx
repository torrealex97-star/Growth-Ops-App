'use client'

// FUNNEL DINÁMICO de la pantalla Métricas y KPIs (unit-economics).
//
// UN componente, N familias. Las definiciones y el cálculo viven en lib/funnels/ (motor compartido
// con la pantalla Funnels); aquí solo se elige la familia y se pintan las etapas que devuelve.
// Cambiar el selector transforma el funnel: no hay WebFunnel/VSLFunnel duplicados.
//
// FAMILIA 'todos' = realidad operacional del negocio: totales del CRM sin exigir atribución
// (fase 2). Sus datos ya están en la página, así que se pasan como prop y no se piden de nuevo.
//
// FAMILIAS del motor (vsl | profile | webinar | web_seo) se leen del endpoint canónico
// /api/[tenant]/evergreen/funnels?family=..., que ya resuelve fuentes mixtas con la semántica de
// lib/funnels/types: un hueco se pinta '—' con su motivo (no_configurada / error_fuente / sin_datos),
// nunca como 0. Las conversiones entre etapas de universos incompatibles (eventos vs personas)
// salen null con tooltip del motivo: computeFunnel ya lo decide, aquí solo se muestra.

import { useEffect, useMemo, useState } from 'react'
import { FunnelChart } from '@/components/os/FunnelChart'
import { ConnectedFunnel } from '@/components/os/ConnectedFunnel'
import type { FunnelFamily } from '@/lib/funnels/definitions'
import type { FunnelResult } from '@/lib/funnels/compute'
import type { FunnelOperativo } from '@/lib/metrics/operativo'
import { formatNumber } from '@/lib/utils'

export type OpcionFunnel = 'todos' | FunnelFamily

// Etiquetas del selector. Las del motor vienen de FUNNEL_DEFS; las dos "conceptuales" van aquí.
export const FUNNEL_LABELS: Record<OpcionFunnel, string> = {
  todos: 'Todos (negocio)',
  vsl: 'VSL',
  webinar: 'Webinar',
  profile: 'DM / Perfil',
  web_seo: 'Web / SEO',
}

export const FUNNEL_ORDEN: OpcionFunnel[] = ['todos', 'vsl', 'profile', 'webinar', 'web_seo']

type Props = {
  tenant: string
  /** Etapas del funnel del negocio (familia 'todos'), ya calculadas en la página. */
  operativo: FunnelOperativo
  loading: boolean
  /** Rango del periodo seleccionado, en YYYY-MM-DD, para pedir las familias del motor. */
  rango: { from: string | null; to: string | null }
  /** Familia activa — CONTROLADA desde la página: el selector vive en la barra de filtros global. */
  opcion: OpcionFunnel
}

type EstadoMotor =
  { kind: 'idle' } | { kind: 'loading' } | { kind: 'motor'; result: FunnelResult } | { kind: 'error'; message: string }

export function FunnelDinamico({ tenant, operativo, loading, rango, opcion }: Props) {
  const [motor, setMotor] = useState<EstadoMotor>({ kind: 'idle' })

  // Las familias del motor se piden al endpoint canónico. 'todos' no se pide: ya está en la página.
  useEffect(() => {
    if (opcion === 'todos') {
      setMotor({ kind: 'idle' })
      return
    }
    let vivo = true
    setMotor({ kind: 'loading' })
    const params = new URLSearchParams({ family: opcion })
    if (rango.from) params.set('from', rango.from)
    if (rango.to) params.set('to', rango.to)
    fetch(`/api/${tenant}/evergreen/funnels?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: FunnelResult) => vivo && setMotor({ kind: 'motor', result: j }))
      .catch((e: unknown) => vivo && setMotor({ kind: 'error', message: e instanceof Error ? e.message : 'fallo' }))
    return () => {
      vivo = false
    }
  }, [opcion, tenant, rango.from, rango.to])

  // Etapas de actividad del periodo: no acreditan una cohorte enlazada.
  const etapasTodos = useMemo(() => {
    // No linked cohort: period activity does not establish conversion.
    return [
      { label: 'Leads', value: operativo.leads, conversion: null as number | null },
      { label: 'Agendas', value: operativo.agendas, conversion: null },
      {
        label: 'Asistencias',
        value: operativo.asistencias,
        conversion: null,
      },
      { label: 'Cierres', value: operativo.cierres, conversion: null },
    ]
  }, [operativo])

  return (
    <section className="dashboard-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Embudo</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {opcion === 'todos'
              ? 'Realidad operacional del negocio en el periodo: totales del CRM, con o sin anuncio detrás.'
              : 'Etapas de esta familia según sus fuentes (Meta, VSL, CRM). Un hueco se declara, nunca se pinta como 0.'}
          </p>
        </div>
      </div>

      <div className="mt-5">
        {opcion === 'todos' ? (
          <>
            <ConnectedFunnel stages={etapasTodos} loading={loading} activityOnly />
            <p className="text-muted-foreground mt-3 text-xs">
              {formatNumber(operativo.cierres)} cierres y {formatNumber(operativo.leads)} leads en el periodo. Son
              hechos independientes, no una cohorte enlazada. La parte atribuida a anuncios se declara en las tarjetas
              de abajo, nunca se resta del total.
            </p>
          </>
        ) : motor.kind === 'loading' ? (
          <FunnelChart result={null} state="loading" />
        ) : motor.kind === 'error' ? (
          <FunnelChart
            result={null}
            state="error"
            message={
              motor.message.includes('500')
                ? 'El servidor no pudo calcular la familia (en local suele faltar SUPABASE_SERVICE_ROLE_KEY; en producción esto responde con los recuentos reales).'
                : motor.message
            }
          />
        ) : motor.kind === 'motor' ? (
          <FunnelChart result={motor.result} state="ok" />
        ) : null}
      </div>
    </section>
  )
}
