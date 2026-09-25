'use client'

// OBJETIVO VS REAL, CON PREVISIÓN. La línea sólida es lo medido; la discontinua, la proyección — y el
// método de esa proyección va siempre visible en texto, nunca solo en el trazo, porque un gráfico que
// no dice cómo prevé es una afirmación sin autor (ver lib/metrics/prevision.ts).
//
// Sin objetivos configurados en growth_context, esta sección no aparece: no hay "cumplido" ni "por
// detrás" que decir sin que alguien haya fijado la cifra (config, not code).

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowRight, ArrowUpRight, TrendingUp } from 'lucide-react'
import type { ObjetivoMedido } from '@/lib/metrics/objetivos'
import type { Prevision } from '@/lib/metrics/prevision'
import type { LtgpCacAproximado } from '@/lib/metrics/ltgp-aproximado'
import { formatNumber, formatPercent } from '@/lib/utils'

type Props = {
  objetivos: ObjetivoMedido[]
  prevision: Prevision | null
  ltgpCacAproximado?: LtgpCacAproximado
}

const RITMO_LABEL: Record<NonNullable<ObjetivoMedido['ritmo']>, string> = {
  por_delante: 'por delante del ritmo',
  en_linea: 'en línea con el ritmo',
  por_detras: 'por detrás del ritmo',
}
const RITMO_COLOR: Record<NonNullable<ObjetivoMedido['ritmo']>, string> = {
  por_delante: 'text-emerald-500',
  en_linea: 'text-sky-500',
  por_detras: 'text-red-500',
}

const fmtFecha = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

function fmtValor(v: number, unidad?: string) {
  if (unidad === '€') return formatNumber(Math.round(v)) + ' €'
  if (unidad === 'x') return formatNumber(v, { maximumFractionDigits: 2 }) + 'x'
  return formatNumber(v)
}

function TarjetaObjetivo({ o }: { o: ObjetivoMedido }) {
  const Flecha = o.tendencia === 'mejora' ? ArrowUpRight : o.tendencia === 'empeora' ? ArrowDownRight : ArrowRight

  return (
    <div className="dashboard-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{o.nombre}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {o.actual === null ? 's/d' : fmtValor(o.actual, o.unidad)}
        </span>
        <span className="text-sm text-muted-foreground">de {fmtValor(o.objetivo, o.unidad)}</span>
        {o.tendencia !== 'sin_comparable' && <Flecha className="h-4 w-4 text-muted-foreground" aria-hidden />}
      </div>
      {o.consecucion !== null && (
        <p className="mt-0.5 text-xs text-muted-foreground">{formatPercent(o.consecucion, 0)} de consecución</p>
      )}
      {o.ritmo && <p className={`mt-1 text-xs font-medium ${RITMO_COLOR[o.ritmo]}`}>{RITMO_LABEL[o.ritmo]}</p>}
      <p className="mt-2 text-xs text-muted-foreground/90">{o.nota}</p>
    </div>
  )
}

export function PanelObjetivos({ objetivos, prevision, ltgpCacAproximado }: Props) {
  if (objetivos.length === 0 && !prevision && !ltgpCacAproximado) return null

  // El punto en el que 'real' termina se repite en 'previsto' para que la línea discontinua arranque
  // exactamente donde acaba la sólida, en vez de dejar un hueco visual entre las dos series.
  const datosGrafico = prevision
    ? prevision.puntos.map((p, i) => {
        const esUltimoReal = p.tipo === 'real' && prevision.puntos[i + 1]?.tipo === 'previsto'
        return {
          fecha: p.fecha,
          real: p.tipo === 'real' ? p.valor : null,
          previsto: p.tipo === 'previsto' || esUltimoReal ? p.valor : null,
        }
      })
    : []

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Objetivos y previsión</h2>
      </div>

      {objetivos.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {objetivos.map((o) => (
            <TarjetaObjetivo key={o.key} o={o} />
          ))}
        </div>
      )}

      {prevision && (
        <div className="dashboard-card p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">Facturación proyectada al cierre</p>
            <span className="text-xs text-muted-foreground">
              confianza {prevision.confianza}
              {prevision.r2 !== null ? ` · R²=${prevision.r2}` : ''}
            </span>
          </div>
          <div className="mt-3 h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={datosGrafico} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
                <XAxis
                  dataKey="fecha"
                  tickFormatter={fmtFecha}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => (v === 0 ? '' : formatNumber(Number(v)))}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(l) => fmtFecha(String(l))}
                  formatter={(v, n) => [formatNumber(Number(v)) + ' €', n === 'real' ? 'Real' : 'Previsto']}
                />
                <Line
                  type="monotone"
                  dataKey="real"
                  stroke="hsl(var(--brand-500))"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="previsto"
                  stroke="hsl(var(--brand-500) / 0.6)"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {/* EL MÉTODO, SIEMPRE VISIBLE — nunca solo el trazo discontinuo. */}
          <p className="mt-2 text-xs text-muted-foreground">{prevision.explicacion}</p>
          {prevision.aviso && <p className="mt-1 text-xs text-amber-500">{prevision.aviso}</p>}
        </div>
      )}

      {ltgpCacAproximado && (
        <div className="dashboard-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            LTGP:CAC aproximado (por periodo)
          </p>
          {ltgpCacAproximado.valor !== null ? (
            <>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">
                {formatNumber(ltgpCacAproximado.valor, { maximumFractionDigits: 2 })}:1
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Coste de entrega por cliente: {formatNumber(ltgpCacAproximado.costePorCliente ?? 0)} € (fuente:{' '}
                {ltgpCacAproximado.fuenteCoste === 'cogs'
                  ? 'gastos categorizados como COGS'
                  : 'coste manual de Configuración'}
                ).
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground">{ltgpCacAproximado.motivo}</p>
          )}
          {/* NUNCA se confunde con el LTGP:CAC canónico: este es un proxy del periodo, no el valor de
              vida real del cliente. */}
          <p className="mt-2 text-xs text-amber-500">
            Aproximación del periodo, no LTGP:CAC de por vida — falta el motor que suma la facturación histórica de cada
            cliente.
          </p>
        </div>
      )}
    </section>
  )
}
