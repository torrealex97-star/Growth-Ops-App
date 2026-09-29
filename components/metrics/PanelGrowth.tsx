'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { AlertTriangle, Activity, Target, ArrowRight } from 'lucide-react'
import { useSesion, useTenant } from '@/lib/tenant-context'
import { esFalloVisible, pedir, type Fallo } from '@/lib/ui/pedir'
import { EstadoPanel } from '@/components/ui/carga/EstadoPanel'
import { KpiCard } from '@/components/metrics/KpiCard'
import { medirTodas, coberturaDeCategoria } from '@/lib/metrics/medidas'
import type { Medicion } from '@/lib/metrics/agregados'
import type { GrowthBrief } from '@/lib/metrics/brief'
import type { SaludNegocio } from '@/lib/metrics/salud'
import type { ObjetivoMedido } from '@/lib/metrics/objetivos'
import type { Prevision } from '@/lib/metrics/prevision'
import type { LtgpCacAproximado } from '@/lib/metrics/ltgp-aproximado'
import { PanelObjetivos } from '@/components/metrics/PanelObjetivos'
import { AnotacionesInspector } from '@/components/metrics/AnotacionesInspector'

const SalesChart = dynamic(() => import('@/components/os/SalesChart').then((m) => ({ default: m.SalesChart })), {
  ssr: false,
  loading: () => <div className="dashboard-card h-72 animate-pulse" />,
})

// EL PANEL DE GROWTH: la restricción primero, las tarjetas después.
//
// POR QUÉ EN ESTE ORDEN. Un panel que abre con veinte tarjetas obliga a que cada persona decida sola cuál
// mira primero, y en la práctica mira la que entiende, no la que importa. Aquí lo primero es UNA frase con
// la restricción actual y qué hacer, y las tarjetas están debajo para comprobarla.
//
// TODO LO QUE SE PINTA VIENE DE /metricas/brief: ni un número se recalcula aquí. Si esta pantalla hiciera
// su propia aritmética, el panel y el agente podrían decir cosas distintas del mismo negocio.

type Respuesta = {
  periodo: { desde: string; hasta: string }
  brief: GrowthBrief
  objetivos: ObjetivoMedido[]
  prevision: Prevision | null
  ltgpCacAproximado: LtgpCacAproximado
  mediciones: Record<string, Medicion>
  serieFacturacion: { fecha: string; valor: number }[]
  serieCash: { fecha: string; valor: number }[]
  salud: SaludNegocio
  procedencia: {
    filasLeidas: Record<string, number>
    fuentesConError: { fuente: string; error: string }[]
    fuentesRecortadas: string[]
    ticketMedioUsado: number | null
    contextoConfigurado: boolean
    atribucion: { contactos: number; conAtribucion: number }
  }
}

const COLOR_ETIQUETA: Record<SaludNegocio['etiqueta'], string> = {
  saludable: 'text-emerald-500',
  aceptable: 'text-sky-500',
  en_riesgo: 'text-amber-500',
  critico: 'text-red-500',
  sin_datos: 'text-muted-foreground',
}

export function PanelGrowth({ desde, hasta }: { desde?: string; hasta?: string }) {
  const tenant = useTenant()
  const sesion = useSesion()
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [fallo, setFallo] = useState<Fallo | null>(null)
  const [verCalculo, setVerCalculo] = useState<string | null>(null)

  const cargar = useCallback(
    async (signal?: AbortSignal) => {
      setCargando(true)
      setFallo(null)
      try {
        const qs = new URLSearchParams()
        if (desde) qs.set('desde', desde)
        if (hasta) qs.set('hasta', hasta)
        const res = await pedir<Respuesta>(`/api/${tenant}/evergreen/metricas/brief${qs.toString() ? `?${qs}` : ''}`, {
          signal,
        })
        if (!res.ok) {
          if (esFalloVisible(res)) setFallo(res)
          return
        }
        setDatos(res.data)
      } finally {
        // El finally que evita la pantalla colgada. Es la misma lección de app/[tenant]/layout.tsx.
        setCargando(false)
      }
    },
    [tenant, desde, hasta]
  )

  useEffect(() => {
    const ac = new AbortController()
    void cargar(ac.signal)
    // Se cancela al desmontar: si alguien cambia de pantalla, la petición se corta y no se pinta sobre
    // un componente que ya no existe.
    return () => ac.abort()
  }, [cargar])

  if (fallo) {
    return (
      <EstadoPanel
        estado={fallo.tipo === 'permiso' ? 'sin_permiso' : 'error'}
        que="las métricas"
        mensajeError={fallo.mensaje}
        onReintentar={fallo.reintentable ? () => void cargar() : undefined}
      />
    )
  }
  if (cargando && !datos) return <EstadoPanel estado="cargando" que="las métricas" filasSkeleton={6} />
  if (!datos) return <EstadoPanel estado="vacio" que="métricas" />

  const { brief, salud, procedencia, objetivos, prevision, ltgpCacAproximado } = datos
  const medidas = medirTodas(datos.mediciones)
  const cobertura = coberturaDeCategoria(medidas)
  const serieFacturacion = datos.serieFacturacion.map((punto) => ({ date: punto.fecha, amount: punto.valor }))
  const serieCash = datos.serieCash.map((punto) => ({ date: punto.fecha, cash: punto.valor }))

  return (
    <div className="space-y-6">
      {/* LA RESTRICCIÓN, PRIMERO Y EN UNA FRASE. */}
      <section className="dashboard-card p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
          <div className="min-w-0 space-y-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Hipótesis a verificar
              </h2>
              <p className="mt-1 text-base font-medium text-foreground">{brief.restriccion.titular}</p>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Impacto estimado si se confirma
                </dt>
                {/* Si el motor no pudo estimarlo, se dice. No se pone un número para que la ficha tenga uno. */}
                <dd className="text-sm text-foreground">{brief.impacto.texto}</dd>
                {brief.impacto.esEstimacion && (
                  <dd className="mt-0.5 text-xs text-muted-foreground">Es una estimación, no un compromiso.</dd>
                )}
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Siguiente acción</dt>
                <dd className="text-sm text-foreground">{brief.accion.texto}</dd>
              </div>
            </dl>

            {brief.escalado.veredicto && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Escalar: </span>
                {ETIQUETA_ESCALADO[brief.escalado.veredicto]}
                {brief.escalado.motivo ? ` — ${brief.escalado.motivo}` : ''}
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* SALUD, CON SUS PARTES A LA VISTA. Una nota que no se puede descomponer no se puede discutir. */}
        <section className="dashboard-card p-5">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Índice orientativo de KPIs
            </h2>
          </div>
          <p
            className={`mt-2 text-3xl font-semibold tabular-nums ${salud.fiabilidad === 'baja' ? 'text-muted-foreground' : COLOR_ETIQUETA[salud.etiqueta]}`}
          >
            {salud.puntuacion === null ? 's/d' : `${salud.puntuacion}`}
            {salud.puntuacion !== null && <span className="text-base text-muted-foreground">/100</span>}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{`Cobertura: ${Math.round(salud.coberturaPeso * 100)}% · Fiabilidad ${salud.fiabilidad}. La comparación con objetivos no confirma por sí sola un problema de negocio.`}</p>
          <ul className="mt-3 space-y-1.5">
            {salud.subscores.map((s) => (
              <li key={s.dimension} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{s.nombre}</span>
                <span className="tabular-nums text-foreground">
                  {s.puntuacion === null ? 'sin medir' : s.puntuacion}
                  <span className="ml-1 text-muted-foreground">
                    ({Math.round(s.cobertura * 100)}% medido, fiabilidad {s.fiabilidad})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* AVISOS. Máximo tres, que es lo que el motor deja pasar al foco. */}
        <section className="dashboard-card p-5">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Lo que pide atención
            </h2>
          </div>
          {brief.alertas.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nada que avisar en este periodo.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {brief.alertas.map((a) => (
                <li key={a.id} className="text-xs">
                  <span className="font-medium text-foreground">{a.titulo}</span>
                  <span className="ml-1 text-muted-foreground">{a.detalle}</span>
                  {a.accion && <span className="mt-0.5 block text-muted-foreground/80">→ {a.accion}</span>}
                </li>
              ))}
            </ul>
          )}
          {brief.huecos.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground/80">
              Sin medir en el catálogo diagnóstico (hueco de medición, no un problema del negocio; ámbito distinto de
              las tarjetas): {brief.huecos.join(', ')}.
            </p>
          )}
        </section>
      </div>

      <SalesChart
        data={serieFacturacion}
        cashData={serieCash}
        title="Facturación vs cash cobrado · acumulado del periodo"
      />

      {/* Mismo rango que el gráfico de arriba: una anotación marca un evento de negocio (lanzamiento,
          cambio de precio…) para explicar un salto en la serie, no un dato más que medir. */}
      <AnotacionesInspector
        desde={datos.periodo.desde}
        hasta={datos.periodo.hasta}
        userId={sesion?.userId}
        puedeGestionarTodas={sesion?.rol === 'admin' || sesion?.rol === 'director'}
      />

      <PanelObjetivos objetivos={objetivos} prevision={prevision} ltgpCacAproximado={ltgpCacAproximado} />

      {/* LAS TARJETAS, para comprobar lo de arriba. */}
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Métricas</h2>
          {/* Sin esto, una pantalla con tarjetas en gris parece rota en vez de incompleta. */}
          <p className="text-xs text-muted-foreground">
            {cobertura.medidas} de {cobertura.total} con datos
            {cobertura.huecos > 0 ? ` · ${cobertura.huecos} sin medir` : ''}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {medidas.map((m) => (
            <KpiCard key={m.id} metrica={m} onDrilldown={() => setVerCalculo(m.key)} />
          ))}
        </div>
      </section>

      {/* ENLACES CRUZADOS, no motores duplicados. Cohortes y la calidad de atribución por fuente viven en
          sus propias pantallas con su propio motor de datos (Finanzas y Marketing respectivamente); traer
          esos números aquí con un fetch aparte rompería la regla de arriba —todo sale de /metricas/brief—
          y dos pantallas acabarían diciendo cosas distintas del mismo negocio. Lo único que se puede dar
          aquí sin recalcular nada es la cobertura de atribución, que YA viaja en esta misma respuesta. */}
      <section className="grid gap-3 sm:grid-cols-2">
        <Link
          href={`/${tenant}/marketing/adquisicion/atribucion`}
          className="dashboard-card flex items-center justify-between gap-3 p-4 transition-colors hover:border-brand-500/50"
        >
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Calidad por fuente</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {procedencia.atribucion.contactos > 0
                ? `${procedencia.atribucion.conAtribucion} de ${procedencia.atribucion.contactos} contactos históricos con origen registrado.`
                : 'Sin contactos históricos que atribuir todavía.'}{' '}
              Ver el desglose por fuente →
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
        <Link
          href={`/${tenant}/cohorts`}
          className="dashboard-card flex items-center justify-between gap-3 p-4 transition-colors hover:border-brand-500/50"
        >
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Cohortes</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Retención y recompra por cohorte de entrada, con su propio motor en Finanzas.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      </section>

      {/* VER CÁLCULO: de dónde sale el número. Sin esto nadie se fía de una cifra que no cuadra con su hoja. */}
      {verCalculo && (
        <section className="rounded-lg border border-border bg-muted/30 p-4 text-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="font-medium text-foreground">Cómo se ha calculado: {verCalculo}</p>
              <p className="text-muted-foreground">
                {medidas.find((m) => m.key === verCalculo)?.formula ?? 'Sin fórmula declarada.'}
              </p>
              <p className="text-muted-foreground">
                Valor {String(datos.mediciones[verCalculo]?.valor ?? 'sin dato')} · muestra{' '}
                {String(datos.mediciones[verCalculo]?.muestra ?? 'desconocida')}
                {datos.mediciones[verCalculo]?.motivo ? ` · ${datos.mediciones[verCalculo]?.motivo}` : ''}
              </p>
              <p className="text-muted-foreground/80">
                Leído de:{' '}
                {Object.entries(procedencia.filasLeidas)
                  .map(([f, n]) => `${f} ${n} filas`)
                  .join(' · ')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setVerCalculo(null)}
              className="shrink-0 rounded-md px-2 py-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cerrar
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

const ETIQUETA_ESCALADO: Record<string, string> = {
  listo: 'listo para escalar',
  con_cautela: 'con cautela',
  esperar: 'esperar — el techo es de capacidad, no de adquisición',
  arreglar_antes: 'arreglar antes de escalar',
}
