'use client'

import Link from 'next/link'
import { ArrowRight, Banknote, Clock3, ReceiptText, Users } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import {
  buildTeamCommissionSummary,
  commissionSettlementSummary,
  nextMonthKey,
  type CommissionDashboardRow,
} from '@/lib/commissions/dashboard'
import type { ParticipantType } from '@/lib/types/database'

type FutureCommission = { dueDate: string; amount: number; exento?: boolean }

const ROLE_LABEL: Record<ParticipantType, string> = {
  setter: 'Setter',
  closer: 'Closer',
  affiliate: 'Colaborador clásico',
  collaborator: 'Colaborador',
}

const monthLabel = (key: string) => {
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 py-3 sm:py-0">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  )
}

export function CommissionControlCenter({
  rows,
  future,
  loading,
  restricted,
  tenant,
}: {
  rows: CommissionDashboardRow[]
  future: FutureCommission[]
  loading: boolean
  restricted: boolean
  tenant: string
}) {
  const settlement = commissionSettlementSummary(rows)
  const nextProjected = future
    .filter((row) => !row.exento && row.dueDate.slice(0, 7) === nextMonthKey())
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const team = buildTeamCommissionSummary(rows)
  const maxCollected = Math.max(...team.map((row) => row.collected), 1)
  const currentObligation = settlement.toApprove + settlement.readyToPay

  return (
    <div className="space-y-6" aria-busy={loading}>
      <section className="dashboard-surface overflow-hidden" aria-labelledby="settlement-heading">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.1em] text-brand-400">Liquidación actual</p>
              <h2 id="settlement-heading" className="mt-1 font-display text-xl font-semibold text-foreground">
                Qué hay que pagar y cuándo
              </h2>
            </div>
            <p className="text-sm capitalize text-muted-foreground">{monthLabel(settlement.current)}</p>
          </div>
        </div>

        <div className="grid gap-0 px-5 py-2 sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.2fr_1fr_1fr_1fr] lg:divide-x lg:divide-border">
          <div className="py-4 lg:pr-6">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Banknote className="h-4 w-4 text-brand-400" aria-hidden="true" />
              <span className="text-sm">Por pagar este mes</span>
            </div>
            <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-foreground sm:text-4xl">
              {formatCurrency(currentObligation)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">Comisión neta pendiente + aprobada</p>
          </div>
          <div className="border-t border-border py-4 sm:border-t-0 lg:px-6">
            <Metric
              label="Falta aprobar"
              value={formatCurrency(settlement.toApprove)}
              note="Cash cobrado, en revisión"
            />
          </div>
          <div className="border-t border-border py-4 sm:border-t-0 lg:px-6">
            <Metric
              label="Lista para pagar"
              value={formatCurrency(settlement.readyToPay)}
              note="Aprobada, aún no liquidada"
            />
          </div>
          <div className="border-t border-border py-4 sm:border-t-0 lg:pl-6">
            <Metric label="Ya pagado" value={formatCurrency(settlement.paid)} note="Liquidado este mes" />
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border bg-muted/20 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Clock3 className="h-4 w-4" aria-hidden="true" />
            Previsión para <span className="capitalize">{monthLabel(settlement.next)}</span>
          </span>
          <span className="font-medium tabular-nums text-foreground">
            {formatCurrency(settlement.nextCommitted + nextProjected)}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {formatCurrency(settlement.nextCommitted)} generada · {formatCurrency(nextProjected)} sujeta a cobro
            </span>
          </span>
        </div>
      </section>

      <section className="dashboard-surface" aria-labelledby="team-heading">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-brand-400" aria-hidden="true" />
              <h2 id="team-heading" className="font-display text-lg font-semibold text-foreground">
                Rendimiento y pago por persona
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Facturación y cash atribuidos; comisión neta tras ajustes. No sumar filas entre roles.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">Ordenado por cash collected</span>
        </div>

        {team.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No hay datos para los filtros elegidos.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {team.map((person, index) => (
              <div key={`${person.userId}-${person.participantType}`} className="px-5 py-4 sm:px-6">
                <div className="grid gap-3 lg:grid-cols-[minmax(180px,1.3fr)_repeat(5,minmax(100px,1fr))] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-5 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                      {restricted ? (
                        <p className="truncate text-sm font-medium text-foreground">{person.name}</p>
                      ) : (
                        <Link
                          href={`/${tenant}/comisiones?member=${person.userId}`}
                          className="group inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:text-brand-300 hover:underline"
                          aria-label={`Abrir perfil de comisiones de ${person.name}`}
                        >
                          <span className="truncate">{person.name}</span>
                          <ArrowRight
                            className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
                            aria-hidden="true"
                          />
                        </Link>
                      )}
                    </div>
                    <p className="ml-7 mt-0.5 text-xs text-muted-foreground">{ROLE_LABEL[person.participantType]}</p>
                    <div className="ml-7 mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${Math.max(3, (person.collected / maxCollected) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5 lg:contents">
                    <div>
                      <dt className="text-xs text-muted-foreground">Facturación atribuida</dt>
                      <dd className="mt-1 text-sm font-medium tabular-nums text-foreground">
                        {formatCurrency(person.booked)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Cash collected</dt>
                      <dd className="mt-1 text-sm font-medium tabular-nums text-foreground">
                        {formatCurrency(person.collected)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Comisión generada</dt>
                      <dd className="mt-1 text-sm font-medium tabular-nums text-foreground">
                        {formatCurrency(person.generated)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Pendiente</dt>
                      <dd className="mt-1 text-sm font-medium tabular-nums text-amber-400">
                        {formatCurrency(person.outstanding)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Pagada</dt>
                      <dd className="mt-1 text-sm font-medium tabular-nums text-emerald-400">
                        {formatCurrency(person.paid)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            ))}
          </div>
        )}
        {!restricted && team.length > 0 && (
          <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground sm:px-6">
            <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />
            Abre una persona para revisar sus ventas, enlace, facturas y liquidaciones
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
        )}
      </section>
    </div>
  )
}
