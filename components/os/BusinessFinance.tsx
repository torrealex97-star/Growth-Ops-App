'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { mensajeDeCarga, primerError } from '@/lib/supabase/resultado'
import { computeMonthlyPnl, FINANCE_QUERY_ROW_CAP, type MonthlyPnl } from '@/lib/finance/pnl'
import { metodoDePlan } from '@/lib/metrics/agregados'
import { clasificarCobrosPorMes } from '@/lib/finance/nuevo-vs-recurrente'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { CompactMetric, BreakdownBars } from './DepartmentDashboard'

type Summary = {
  pnl: MonthlyPnl
  sameMonth: number
  previousMonths: number
  unclassified: number
  first: number
  followup: number
  updatedAt: string
}

/** Company finance: same ledger and P&L contract as Analítica financiera. */
export function BusinessFinance({ tenantId, from, to }: { tenantId: string; from: string; to: string }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setSummary(null)
    setError(null)
    async function load() {
      try {
        const db = createClient()
        const [sales, collections, refunds, expenses, commissions] = await Promise.all([
          db
            .from('sales')
            .select('id, gross_amount, discount, sale_date, status, reservation_completed_at, payment_plans(method)', {
              count: 'exact',
            })
            .eq('tenant_id', tenantId)
            .range(0, FINANCE_QUERY_ROW_CAP),
          db
            .from('collections')
            .select('id, sale_id, gross_amount, processing_fee, collected_at, status', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .range(0, FINANCE_QUERY_ROW_CAP),
          db
            .from('refunds')
            .select('gross_refund_amount, refund_date', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .range(0, FINANCE_QUERY_ROW_CAP),
          db
            .from('expenses')
            .select('amount, category, expense_date', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .range(0, FINANCE_QUERY_ROW_CAP),
          db
            .from('commissions')
            .select('commission_amount, direction, collection_id, liquidation_month', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .range(0, FINANCE_QUERY_ROW_CAP),
        ])
        if (!active) return
        const failure = primerError(sales, collections, refunds, expenses, commissions)
        if (failure) {
          setError(mensajeDeCarga('el resultado financiero', failure))
          return
        }
        if (
          [sales, collections, refunds, expenses, commissions].some(
            (r) => r.count !== null && r.count > (r.data?.length ?? 0)
          )
        )
          throw new Error('La consulta financiera está incompleta. No se muestra un resultado parcial.')
        const data = {
          sales: (sales.data || []).map((s) => ({ ...s, payment_plan_method: metodoDePlan(s) })),
          collections: collections.data || [],
          refunds: refunds.data || [],
          expenses: expenses.data || [],
          commissions: commissions.data || [],
        }
        const pnl = computeMonthlyPnl('', data, { from, to })
        const saleDates = new Map(data.sales.map((s) => [s.id, s.sale_date]))
        const collected = data.collections.filter(
          (c) =>
            c.status === 'collected' &&
            c.collected_at &&
            c.collected_at.slice(0, 10) >= from &&
            c.collected_at.slice(0, 10) <= to
        )
        let sameMonth = 0,
          previousMonths = 0,
          unclassified = 0
        for (const c of collected) {
          const saleMonth = saleDates.get(c.sale_id)?.slice(0, 7)
          const paidMonth = c.collected_at!.slice(0, 7)
          const amount = Number(c.gross_amount || 0)
          if (!saleMonth || saleMonth > paidMonth) unclassified += amount
          else if (saleMonth === paidMonth) sameMonth += amount
          else previousMonths += amount
        }
        // Retain full history to identify the first payment; only amounts inside the range count.
        const inRangeIds = new Set(collected.map((c) => c.id))
        const classification = data.collections.map((c) => ({
          ...c,
          gross_amount: inRangeIds.has(c.id) ? c.gross_amount : 0,
        }))
        const months = new Set(collected.map((c) => c.collected_at!.slice(0, 7)))
        let first = 0,
          followup = 0
        for (const month of months) {
          const split = clasificarCobrosPorMes(classification, month)
          first += split.nuevo.importe
          followup += split.recurrente.importe
        }
        setSummary({
          pnl,
          sameMonth,
          previousMonths,
          unclassified,
          first,
          followup,
          updatedAt: new Date().toLocaleTimeString('es-ES'),
        })
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error ? cause.message : 'No se pudo cargar el resultado financiero. Reintenta la consulta.'
          )
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [tenantId, from, to, retry])
  if (error)
    return (
      <div role="alert" className="rounded-xl border border-border p-4 text-sm">
        {error}{' '}
        <button className="underline" onClick={() => setRetry((n) => n + 1)}>
          Reintentar
        </button>
      </div>
    )
  if (!summary)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Cargando gastos, resultado y origen de los cobros…
      </p>
    )
  const { pnl } = summary
  const costs = pnl.cogs + pnl.totalOpex
  const resultLabel = pnl.preTaxProfit > 0 ? 'Positivo' : pnl.preTaxProfit < 0 ? 'Negativo' : 'En equilibrio'
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <CompactMetric
          title="Gastos"
          value={formatCurrency(costs)}
          description="Costes directos + gastos operativos del P&L"
        />
        <div className="dashboard-card rounded-xl p-4" role="status">
          <p className="text-sm text-muted-foreground">Resultado antes de impuestos</p>
          <p
            className={`mt-1 text-2xl font-bold ${pnl.preTaxProfit < 0 ? 'text-red-400' : pnl.preTaxProfit > 0 ? 'text-emerald-400' : ''}`}
          >
            {pnl.preTaxProfit > 0 ? '+' : ''}
            {formatCurrency(pnl.preTaxProfit)}
          </p>
          <p className="mt-1 text-xs">{resultLabel} · libro interno</p>
        </div>
        <CompactMetric
          title="Margen antes de impuestos"
          value={pnl.preTaxMargin === null ? '—' : formatPercent(pnl.preTaxMargin * 100)}
          description="Resultado / ingresos netos del P&L"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownBars
          title="Cobros del libro interno por mes de venta"
          format={formatCurrency}
          rows={[
            { label: 'Ventas del mismo mes del cobro', value: summary.sameMonth },
            { label: 'Ventas de meses anteriores', value: summary.previousMonths },
            { label: 'Sin clasificar', value: summary.unclassified },
          ]}
        />
        <BreakdownBars
          title="Desglose de gastos"
          format={formatCurrency}
          rows={[
            { label: 'Costes directos', value: pnl.cogs },
            { label: 'Comisiones', value: pnl.comisiones },
            { label: 'Sueldos', value: pnl.salarios },
            { label: 'Publicidad', value: pnl.adspend },
            { label: 'Herramientas', value: pnl.software },
            { label: 'Pasarela', value: pnl.platformFees },
            { label: 'Otros', value: pnl.otros },
          ]}
        />
      </div>
      <details className="rounded-xl border border-border/50 p-4 text-xs">
        <summary className="cursor-pointer font-medium">Cómo se compone el resultado</summary>
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <dt>Cash Collected (libro interno, bruto)</dt>
          <dd>{formatCurrency(pnl.grossRevenue)}</dd>
          <dt>Devoluciones del libro interno</dt>
          <dd>{formatCurrency(pnl.totalRefunds)}</dd>
          <dt>Descuentos</dt>
          <dd>{formatCurrency(pnl.totalDiscounts)}</dd>
          <dt>Ingresos netos del P&L</dt>
          <dd>{formatCurrency(pnl.netRevenue)}</dd>
          <dt>Gastos</dt>
          <dd>{formatCurrency(costs)}</dd>
          <dt>Primer cobro de venta</dt>
          <dd>{formatCurrency(summary.first)}</dd>
          <dt>Pagos posteriores</dt>
          <dd>{formatCurrency(summary.followup)}</dd>
        </dl>
        <p className="mt-3 text-muted-foreground">
          El resultado reutiliza Analítica financiera y su libro interno; no incluye pagos exclusivos de Stripe que no
          estén registrados en ese libro. Primer cobro y mes de venta son clasificaciones distintas. Facturación no se
          suma a Cash Collected. Publicidad registrada como gasto no se vuelve a sumar desde Marketing.
        </p>
      </details>
      <p className="text-xs text-muted-foreground">
        Gastos, resultado y desglose: libro interno de la empresa, mismo ámbito que Analítica financiera. Los cobros del
        desglose son brutos y pueden diferir del Cash Collected consolidado con Stripe. Periodo seleccionado · consulta
        actualizada a las {summary.updatedAt}. El resultado del P&L no equivale al saldo bancario.
      </p>
    </div>
  )
}
