'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, CreditCard, RefreshCw, Undo2, Users, Wallet } from 'lucide-react'
import { KPICard } from '@/components/os/DashboardKPICard'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'
import { normalizeText } from '@/components/ui/search-box'

// CONTROL DE PAGOS POR PERSONA. Consumidor de la API finanzas/control-pagos (que a su vez
// usa la capa semántica lib/payments/control-personas): cuánto lleva pagada cada persona,
// cuántas cuotas van y cuántas faltan, si hay impago, reservas (<100 €) y reservas
// devueltas (→ NO cliente) o asumidas dentro de un plan de pago.

type EstadoPersona =
  | 'cliente_activo'
  | 'cliente_completado'
  | 'suscripcion'
  | 'plan_a_plazos'
  | 'reserva_pendiente'
  | 'reserva_devuelta'
  | 'solo_interno'

type PersonaPagos = {
  key: string
  nombre: string
  email: string | null
  contact_id: string | null
  estadoCliente: EstadoPersona
  netoPagado: number
  devuelto: number
  reservasPagadas: number
  reservasDevueltas: number
  reservaAsumidaEnPlan: boolean
  totalPlan: number | null
  precioProducto: number | null
  nombreProducto: string | null
  cuotasPagadas: number
  cuotasTotales: number | null
  importeCuota: number | null
  impagos: number
  primeraCuota: string | null
  ultimaCuota: string | null
  ventaId: string | null
}

type Resumen = {
  totalPersonas: number
  clientes: number
  suscripciones: number
  conImpago: number
  reservasPendientes: number
  reservasDevueltas: number
  netoTotal: number
}

const ESTADO_ORDEN: EstadoPersona[] = [
  'suscripcion',
  'cliente_activo',
  'plan_a_plazos',
  'reserva_pendiente',
  'cliente_completado',
  'reserva_devuelta',
  'solo_interno',
]

const ESTADO_LABEL: Record<EstadoPersona, string> = {
  suscripcion: 'Suscripción',
  cliente_activo: 'En curso',
  plan_a_plazos: 'Plan a plazos',
  reserva_pendiente: 'Reserva',
  cliente_completado: 'Completado',
  reserva_devuelta: 'Reserva devuelta',
  solo_interno: 'Solo registro interno',
}

const ESTADO_COLOR: Record<EstadoPersona, string> = {
  suscripcion: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  cliente_activo: 'bg-brand-500/10 text-brand-400 border-brand-500/30',
  plan_a_plazos: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  reserva_pendiente: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  cliente_completado: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  reserva_devuelta: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  solo_interno: 'bg-muted text-muted-foreground border-border',
}

function Chip({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-full border ${className || 'bg-muted text-muted-foreground border-border'}`}
    >
      {children}
    </span>
  )
}

export function ControlPagosPersonas({ tenant, q }: { tenant: string; q: string }) {
  const [personas, setPersonas] = useState<PersonaPagos[]>([])
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/finanzas/control-pagos`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar el control por persona')
      setPersonas(data.personas ?? [])
      setResumen(data.resumen ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar el control por persona')
    } finally {
      setLoading(false)
    }
  }, [tenant])

  useEffect(() => {
    cargar()
  }, [cargar])

  const filtradas = useMemo(() => {
    const nq = normalizeText(q.trim())
    if (!nq) return personas
    return personas.filter(
      (p) => normalizeText(p.nombre).includes(nq) || (p.email && normalizeText(p.email).includes(nq))
    )
  }, [personas, q])

  const secciones = useMemo(
    () =>
      ESTADO_ORDEN.map((estado) => ({
        estado,
        items: filtradas.filter((p) => p.estadoCliente === estado),
      })).filter((s) => s.items.length > 0),
    [filtradas]
  )

  // Calculado desde personas (no por resta del resumen): debe cuadrar con la sección "En curso".
  const enCurso = personas.filter(
    (p) => p.estadoCliente === 'cliente_activo' || p.estadoCliente === 'plan_a_plazos'
  ).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Cuánto lleva pagada cada persona, cuántas cuotas van y cuántas faltan, impagos y reservas — desde el dinero
          real de Stripe.
        </p>
        <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={cargar} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPICard title="Personas" value={String(resumen?.clientes ?? 0)} icon={Users} loading={loading} />
        <KPICard
          title="Suscripciones"
          value={String(resumen?.suscripciones ?? 0)}
          icon={CreditCard}
          loading={loading}
        />
        <KPICard title="En curso" value={String(Math.max(enCurso, 0))} icon={Wallet} loading={loading} />
        <KPICard
          title="Reservas"
          value={String(resumen?.reservasPendientes ?? 0)}
          icon={CalendarClock}
          loading={loading}
        />
        <KPICard title="Con impago" value={String(resumen?.conImpago ?? 0)} icon={AlertTriangle} loading={loading} />
        <KPICard
          title="Reserva devuelta"
          value={String(resumen?.reservasDevueltas ?? 0)}
          icon={Undo2}
          loading={loading}
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-card rounded-lg animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">{error}</div>
      ) : filtradas.length === 0 ? (
        <div className="rounded-lg border border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">
          Sin personas con pagos todavía.
        </div>
      ) : (
        <div className="space-y-6">
          {secciones.map(({ estado, items }) => (
            <section key={estado} className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{ESTADO_LABEL[estado]}</h3>
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  {items.length}
                </span>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {items.map((p) => {
                  const planTexto = p.totalPlan
                    ? `de ${formatCurrency(p.totalPlan)}${p.nombreProducto ? ` · ${p.nombreProducto}` : ''}`
                    : p.netoPagado > 0
                      ? formatCurrency(p.netoPagado)
                      : '—'
                  const cuotasTexto = p.cuotasTotales
                    ? `van ${p.cuotasPagadas} de ${p.cuotasTotales}`
                    : p.cuotasPagadas > 0
                      ? `${p.cuotasPagadas} pagadas`
                      : '—'
                  return (
                    <div key={p.key} className="rounded-lg border border-border bg-card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {p.ventaId ? (
                              <Link
                                href={`/${tenant}/ventas/registro/${p.ventaId}`}
                                className="text-sm font-medium text-foreground truncate hover:text-brand-400"
                              >
                                {p.nombre}
                              </Link>
                            ) : (
                              <p className="text-sm font-medium text-foreground truncate">{p.nombre}</p>
                            )}
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full border shrink-0 ${ESTADO_COLOR[p.estadoCliente]}`}
                            >
                              {ESTADO_LABEL[p.estadoCliente]}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{p.email ?? '—'}</p>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Neto pagado</p>
                          <p className="font-medium text-foreground mt-0.5">{formatCurrency(p.netoPagado)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Plan</p>
                          <p className="font-medium text-foreground mt-0.5 truncate">{planTexto}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Cuotas</p>
                          <p className="font-medium text-foreground mt-0.5">
                            {cuotasTexto}
                            {p.importeCuota != null && (
                              <span className="text-muted-foreground"> · {formatCurrency(p.importeCuota)}</span>
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Estado pago</p>
                          {p.impagos > 0 ? (
                            <p className="font-medium text-red-400 mt-0.5">
                              Impago: {p.impagos} cuota{p.impagos > 1 ? 's' : ''}
                            </p>
                          ) : p.estadoCliente === 'cliente_completado' ? (
                            <p className="font-medium text-emerald-400 mt-0.5">Completado</p>
                          ) : p.cuotasPagadas > 0 ? (
                            <p className="font-medium text-foreground mt-0.5">Al día</p>
                          ) : (
                            <p className="text-muted-foreground mt-0.5">—</p>
                          )}
                        </div>
                      </div>

                      {(p.reservasPagadas > 0 ||
                        p.reservasDevueltas > 0 ||
                        p.reservaAsumidaEnPlan ||
                        p.devuelto > 0) && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {p.reservasPagadas > 0 && (
                            <Chip className="bg-amber-500/10 text-amber-400 border-amber-500/30">
                              Reserva{p.reservasPagadas > 1 ? ` ×${p.reservasPagadas}` : ''}
                            </Chip>
                          )}
                          {p.reservaAsumidaEnPlan && (
                            <Chip className="bg-amber-500/10 text-amber-400 border-amber-500/30">
                              Reserva asumida en el plan
                            </Chip>
                          )}
                          {p.reservasDevueltas > 0 && (
                            <Chip className="bg-zinc-500/10 text-zinc-400 border-zinc-500/30">
                              Reserva devuelta{p.reservasDevueltas > 1 ? ` ×${p.reservasDevueltas}` : ''}
                            </Chip>
                          )}
                          {p.devuelto > 0 && (
                            <Chip className="bg-zinc-500/10 text-zinc-400 border-zinc-500/30">
                              Devuelto {formatCurrency(p.devuelto)}
                            </Chip>
                          )}
                          {p.ultimaCuota && <Chip>Último pago {formatDate(p.ultimaCuota)}</Chip>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
