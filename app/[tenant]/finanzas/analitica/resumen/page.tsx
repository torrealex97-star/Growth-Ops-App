'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTenantId } from '@/lib/tenant-context'
import { createClient } from '@/lib/supabase/client'
import { mensajeDeCarga, primerError } from '@/lib/supabase/resultado'
import { KPICard } from '@/components/os/DashboardKPICard'
import { FinanceBreakdown, FinanceEvolution } from '@/components/finanzas/FinanceCharts'
import { PieChart, Wallet, ShoppingCart, Receipt, TrendingDown, Scale, Users, CreditCard } from 'lucide-react'
import { isActiveSale, lastNMonths, prevMonth, monthLabel, pctDelta } from '@/lib/analytics'
import { formatCurrency } from '@/lib/utils'
import { computeMonthlyPnl, FINANCE_QUERY_ROW_CAP } from '@/lib/finance/pnl'

type SaleRow = {
  id: string
  gross_amount: number | string
  discount: number | string | null
  sale_date: string | null
  status: string
}
type CollectionRow = {
  id: string
  sale_id: string
  gross_amount: number | string
  commissionable_amount: number | string | null
  processing_fee: number | string | null
  vat: number | string | null
  collected_at: string | null
  status: string
  expected_installment_id: string | null
}
type ExpenseRow = { amount: number | string; category: string; expense_date: string | null }
type RefundRow = { gross_refund_amount: number | string; refund_date: string | null }
type CommissionRow = {
  commission_amount: number | string
  direction: string
  collection_id: string | null
  liquidation_month: string | null
}
type UserRow = { base_salary: number | string | null }

const num = (x: number | string | null | undefined) => Number(x ?? 0)
const ymOf = (d: string | null | undefined) => (d ? String(d).slice(0, 7) : '')

function nowYm() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const CATEGORY_LABELS: Record<string, string> = {
  cogs: 'COGS',
  sueldos: 'Sueldos',
  publicidad: 'Publicidad',
  herramientas: 'Herramientas',
  eventos: 'Eventos',
  otros: 'Otros',
}

function MetricCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="dashboard-card p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="font-display text-xl font-semibold text-foreground tabular-nums">{value}</p>
      {sublabel && <p className="text-[11px] text-muted-foreground mt-0.5">{sublabel}</p>}
    </div>
  )
}

export default function FinanzasPage() {
  const tenantId = useTenantId()
  const [loading, setLoading] = useState(true)
  // Un fallo de lectura NO se pinta como 0 €: ver lib/supabase/resultado.ts.
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [ym, setYm] = useState(nowYm())
  const [sales, setSales] = useState<SaleRow[]>([])
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [refunds, setRefunds] = useState<RefundRow[]>([])
  const [commissions, setCommissions] = useState<CommissionRow[]>([])
  const [activeUsers, setActiveUsers] = useState<UserRow[]>([])

  const monthOptions = useMemo(() => lastNMonths(12, nowYm()).reverse(), [])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      const supabase = createClient()
      const [salesRes, collRes, expensesRes, refundsRes, commissionsRes, usersRes] = await Promise.all([
        supabase
          .from('sales')
          .select('id, gross_amount, discount, sale_date, status')
          .eq('tenant_id', tenantId)
          .range(0, FINANCE_QUERY_ROW_CAP),
        supabase
          .from('collections')
          .select(
            'id, sale_id, gross_amount, commissionable_amount, processing_fee, vat, collected_at, status, expected_installment_id'
          )
          .eq('tenant_id', tenantId)
          .range(0, FINANCE_QUERY_ROW_CAP),
        supabase
          .from('expenses')
          .select('amount, category, expense_date')
          .eq('tenant_id', tenantId)
          .range(0, FINANCE_QUERY_ROW_CAP),
        supabase
          .from('refunds')
          .select('gross_refund_amount, refund_date')
          .eq('tenant_id', tenantId)
          .range(0, FINANCE_QUERY_ROW_CAP),
        supabase
          .from('commissions')
          .select('commission_amount, direction, collection_id, liquidation_month')
          .eq('tenant_id', tenantId)
          .range(0, FINANCE_QUERY_ROW_CAP),
        supabase
          .from('users')
          .select('base_salary, tenant_members!inner(tenant_id)')
          .eq('tenant_members.tenant_id', tenantId)
          .eq('is_active', true),
      ])
      if (!mounted) return
      const fallo = primerError(salesRes, collRes, expensesRes, refundsRes, commissionsRes, usersRes)
      setErrorCarga(fallo ? mensajeDeCarga('los datos de facturación', fallo) : null)
      setSales(salesRes.data || [])
      setCollections(collRes.data || [])
      setExpenses(expensesRes.data || [])
      setRefunds(refundsRes.data || [])
      setCommissions(commissionsRes.data || [])
      setActiveUsers(usersRes.data || [])
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [tenantId])

  // --- Cálculo de resumen financiero para un mes concreto ---
  const summaryFor = useMemo(() => {
    return (targetYm: string) => {
      // Canónico (Fase 5): igual filtro que Dashboard/PNL — solo ventas activas cuentan como
      // "ventas del mes". Antes esta pantalla sumaba TODAS las ventas (incl. canceladas/
      // reembolsadas), dando una cifra distinta a la del Dashboard para el mismo periodo.
      const monthSales = sales.filter((s) => isActiveSale(s) && ymOf(s.sale_date) === targetYm)
      const monthCollections = collections.filter((c) => c.status === 'collected' && ymOf(c.collected_at) === targetYm)
      const monthExpenses = expenses.filter((e) => ymOf(e.expense_date) === targetYm)
      const monthRefunds = refunds.filter((r) => ymOf(r.refund_date) === targetYm)

      // Correlación: la comisión se imputa al mes del COBRO que la generó (collected_at), no al de
      // liquidación. Antes se comparaba `liquidation_month === targetYm` (fecha 'YYYY-MM-01' vs
      // 'YYYY-MM') → nunca casaba y las comisiones no se contaban. Negativas → su mes de liquidación.
      const collMonth = new Map(collections.map((c) => [c.id, ymOf(c.collected_at)]))
      const commissionYm = (c: CommissionRow) =>
        c.direction === 'negative'
          ? ymOf(c.liquidation_month)
          : ((c.collection_id ? collMonth.get(c.collection_id) : undefined) ?? ymOf(c.liquidation_month))
      const monthCommissions = commissions.filter((c) => commissionYm(c) === targetYm)

      const contractedSales = monthSales.reduce((a, s) => a + num(s.gross_amount), 0)
      const cashCollected = monthCollections.reduce((a, c) => a + num(c.gross_amount), 0)
      const platformFees = monthCollections.reduce((a, c) => a + num(c.processing_fee), 0)

      const expensesTotal = monthExpenses.reduce((a, e) => a + num(e.amount), 0)
      const positiveCommissions = monthCommissions
        .filter((c) => c.direction !== 'negative')
        .reduce((a, c) => a + num(c.commission_amount), 0)
      const totalExpenses = expensesTotal + positiveCommissions

      const totalRefunds = monthRefunds.reduce((a, r) => a + num(r.gross_refund_amount), 0)

      // Resultado neto/margen: único servicio compartido con el I&G de Dirección › Métricas
      // (lib/finance/pnl.ts) y con Gastos & Facturas › Export gestoría — no se recalcula aquí.
      const monthPnl = computeMonthlyPnl(targetYm, { sales, collections, refunds, expenses, commissions })
      const netResult = monthPnl.preTaxProfit
      const margin = monthPnl.preTaxMargin === null ? null : monthPnl.preTaxMargin * 100

      const byCategory = new Map<string, number>()
      for (const e of monthExpenses) {
        byCategory.set(e.category, (byCategory.get(e.category) || 0) + num(e.amount))
      }
      if (positiveCommissions > 0) {
        byCategory.set('comisiones', (byCategory.get('comisiones') || 0) + positiveCommissions)
      }
      const categories = Array.from(byCategory.entries())
        .map(([category, amount]) => ({
          category,
          label: CATEGORY_LABELS[category] || (category === 'comisiones' ? 'Comisiones' : category),
          amount,
        }))
        .sort((a, b) => b.amount - a.amount)

      return {
        contractedSales,
        cashCollected,
        totalExpenses,
        totalRefunds,
        platformFees,
        netResult,
        margin,
        categories,
      }
    }
  }, [sales, collections, expenses, refunds, commissions])

  const cur = useMemo(() => summaryFor(ym), [summaryFor, ym])
  const prev = useMemo(() => summaryFor(prevMonth(ym)), [summaryFor, ym])

  // --- Salarios del equipo ---
  const salariesSummary = useMemo(() => {
    const committed = activeUsers.reduce((a, u) => a + num(u.base_salary), 0)
    const booked = cur.categories.find((c) => c.category === 'sueldos')?.amount || 0
    const diff = committed - booked
    const pctBooked = committed > 0 ? (booked / committed) * 100 : null
    return { committed, booked, diff, pctBooked }
  }, [activeUsers, cur.categories])

  // --- Métricas de pagos ("Company") para el mes seleccionado ---
  const paymentsSummary = useMemo(() => {
    const targetYm = ym
    const monthCollections = collections.filter((c) => c.status === 'collected' && ymOf(c.collected_at) === targetYm)
    const monthSales = sales.filter((s) => isActiveSale(s) && ymOf(s.sale_date) === targetYm)
    const monthExpenses = expenses.filter((e) => ymOf(e.expense_date) === targetYm)
    const monthRefunds = refunds.filter((r) => ymOf(r.refund_date) === targetYm)

    // Total payments
    const totalPayments = monthCollections.length

    // Avg GR/payment
    const grossSum = monthCollections.reduce((a, c) => a + num(c.gross_amount), 0)
    const avgGrPerPayment = totalPayments > 0 ? grossSum / totalPayments : null

    // %Refund
    const totalRefundsAmount = monthRefunds.reduce((a, r) => a + num(r.gross_refund_amount), 0)
    const pctRefund = grossSum > 0 ? (totalRefundsAmount / grossSum) * 100 : null

    // %New GR vs %Followup GR
    // Para cada sale_id presente en TODAS las collections, determinamos cuál es
    // el primer cobro (por collected_at) y si dicho primer cobro cae en el mes seleccionado
    // lo clasificamos como "new"; el resto de cobros del mes son "followup".
    const bySale = new Map<string, CollectionRow[]>()
    for (const c of collections) {
      if (c.status !== 'collected') continue
      const arr = bySale.get(c.sale_id) || []
      arr.push(c)
      bySale.set(c.sale_id, arr)
    }
    const firstCollectionIdBySale = new Map<string, CollectionRow>()
    for (const [saleId, arr] of Array.from(bySale.entries())) {
      const sorted = [...arr].sort((a, b) => {
        const da = a.collected_at ? new Date(a.collected_at).getTime() : 0
        const db = b.collected_at ? new Date(b.collected_at).getTime() : 0
        return da - db
      })
      firstCollectionIdBySale.set(saleId, sorted[0])
    }
    let newGr = 0
    let followupGr = 0
    for (const c of monthCollections) {
      const first = firstCollectionIdBySale.get(c.sale_id)
      const isNew = first === c
      if (isNew) newGr += num(c.gross_amount)
      else followupGr += num(c.gross_amount)
    }
    const pctNewGr = grossSum > 0 ? (newGr / grossSum) * 100 : null
    const pctFollowupGr = grossSum > 0 ? (followupGr / grossSum) * 100 : null

    // %Avg Discount
    const salesWithDiscount = monthSales.filter((s) => num(s.discount) > 0)
    const discountPcts = monthSales
      .map((s) => {
        const discount = num(s.discount)
        const base = num(s.gross_amount) + discount
        return base > 0 ? (discount / base) * 100 : null
      })
      .filter((v): v is number => v !== null)
    const avgDiscountPct =
      discountPcts.length > 0 ? discountPcts.reduce((a, v) => a + v, 0) / discountPcts.length : null
    const totalDiscountAmount = monthSales.reduce((a, s) => a + num(s.discount), 0)

    // Taxes + %Tax
    const taxExpenses = monthExpenses.filter((e) => e.category === 'impuestos').reduce((a, e) => a + num(e.amount), 0)
    const vatCollected = monthCollections.reduce((a, c) => a + num(c.vat), 0)
    const taxesTotal = taxExpenses + vatCollected
    const netRevenueForTax = grossSum - totalRefundsAmount - totalDiscountAmount
    const pctTax = netRevenueForTax > 0 ? (taxesTotal / netRevenueForTax) * 100 : null

    // Processing fees
    const processingFees = monthCollections.reduce((a, c) => a + num(c.processing_fee), 0)

    return {
      totalPayments,
      avgGrPerPayment,
      pctRefund,
      newGr,
      followupGr,
      pctNewGr,
      pctFollowupGr,
      avgDiscountPct,
      totalDiscountAmount,
      salesWithDiscountCount: salesWithDiscount.length,
      taxesTotal,
      pctTax,
      processingFees,
    }
  }, [collections, sales, expenses, refunds, ym])

  const months6 = useMemo(() => lastNMonths(6, ym), [ym])
  const series = useMemo(
    () =>
      months6.map((m) => {
        const s = summaryFor(m)
        return { ym: m, label: monthLabel(m), cash: s.cashCollected, expenses: s.totalExpenses, net: s.netResult }
      }),
    [months6, summaryFor]
  )
  const maxCategoryAmount = useMemo(() => Math.max(1, ...cur.categories.map((c) => c.amount)), [cur.categories])

  const delta = (c: number, p: number) => {
    const d = pctDelta(c, p)
    if (d === null) return {}
    return {
      delta: Math.round(d),
      deltaType: d > 0 ? ('up' as const) : d < 0 ? ('down' as const) : ('neutral' as const),
    }
  }
  const fmt = (n: number) => formatCurrency(n)
  const pct = (v: number | null) => (v === null || !isFinite(v) ? '—' : `${v.toFixed(1)}%`)
  const fmtOrDash = (n: number | null) => (n === null || !isFinite(n) ? '—' : fmt(n))
  const intOrDash = (n: number | null) => (n === null || !isFinite(n) ? '—' : String(n))

  return (
    <div className="dashboard-surface space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
            <PieChart className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Resumen financiero</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Resultados de la empresa por mes · ver detalle en I&amp;G — Ingresos y Gastos
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Mes</span>
          <select
            value={ym}
            onChange={(e) => setYm(e.target.value)}
            className="bg-card border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-brand-500"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {errorCarga ? (
        <div className="dashboard-card border-destructive/40 p-6">
          <p className="text-foreground text-sm font-medium">No se pudo cargar el resumen</p>
          <p className="text-muted-foreground mt-1 text-sm">{errorCarga}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-primary mt-3 text-sm hover:underline"
            type="button"
          >
            Reintentar
          </button>
        </div>
      ) : loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="dashboard-card p-6 space-y-2">
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                <div className="h-8 w-32 bg-muted animate-pulse rounded" />
              </div>
            ))}
          </div>
          <div className="h-64 animate-pulse bg-card rounded-lg" />
        </div>
      ) : (
        <>
          {/* KPIs del mes */}
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Resultados de {monthLabel(ym)}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KPICard
                title="Cash Collected"
                value={fmt(cur.cashCollected)}
                icon={Wallet}
                description="facturación bruta, sin restar devoluciones"
                {...delta(cur.cashCollected, prev.cashCollected)}
              />
              <KPICard
                title="Ventas contratadas"
                value={fmt(cur.contractedSales)}
                icon={ShoppingCart}
                description="vs mes anterior"
                {...delta(cur.contractedSales, prev.contractedSales)}
              />
              <KPICard
                title="Gastos totales"
                value={fmt(cur.totalExpenses)}
                icon={Receipt}
                description="gastos + comisiones"
                {...delta(cur.totalExpenses, prev.totalExpenses)}
              />
              <KPICard
                title="Comisiones plataforma"
                value={fmt(cur.platformFees)}
                icon={CreditCard}
                description="Stripe, transferencia, Sequra..."
                {...delta(cur.platformFees, prev.platformFees)}
              />
              <div className="md:row-span-2 xl:col-start-3 xl:row-start-1">
                <FinanceBreakdown
                  title="Origen de los cobros"
                  slices={[
                    { label: 'Primer cobro', amount: paymentsSummary.newGr },
                    { label: 'Cuotas siguientes', amount: paymentsSummary.followupGr },
                  ]}
                  emptyLabel="Sin cobros registrados este mes."
                />
              </div>
              <div className="md:row-span-2 xl:col-start-4 xl:row-start-1">
                <FinanceBreakdown
                  title="Distribución de gastos"
                  slices={cur.categories.map((c) => ({ label: c.label, amount: c.amount }))}
                  emptyLabel="Sin gastos registrados este mes."
                />
              </div>
            </div>
          </div>

          {/* Evolución y desglose: panel principal con resumen financiero lateral. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2">
              <FinanceEvolution data={series} />
            </div>
            <div className="space-y-4">
              <div className="dashboard-card p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Gastos por categoría — {monthLabel(ym)}</h3>
                {cur.categories.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Sin gastos registrados este mes.</p>
                ) : (
                  <div className="space-y-4">
                    {cur.categories.map((c) => (
                      <div key={c.category}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-foreground">{c.label}</span>
                          <span className="text-muted-foreground">{fmt(c.amount)}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-brand-500"
                            style={{ width: `${(c.amount / maxCategoryAmount) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <KPICard
                  title="Devoluciones del mes"
                  value={`− ${fmt(cur.totalRefunds)}`}
                  icon={TrendingDown}
                  description="se resta del Cash Collected para el neto"
                  {...delta(cur.totalRefunds, prev.totalRefunds)}
                />
                <div className="dashboard-card p-6">
                  <div className="flex items-start justify-between mb-4">
                    <p className="text-sm font-medium text-muted-foreground">Resultado neto</p>
                    <div className="w-9 h-9 rounded-lg bg-brand-600/20 flex items-center justify-center">
                      <Scale className="w-4 h-4 text-brand-400" />
                    </div>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-2xl font-bold ${cur.netResult >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmt(cur.netResult)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">margen {pct(cur.margin)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Mismo cálculo que I&amp;G (Dirección › Métricas): Net Revenue − COGS − OpEx
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Salarios del equipo */}
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Salarios del equipo</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <KPICard
                title="Salarios equipo"
                value={fmt(salariesSummary.committed)}
                icon={Users}
                description="coste mensual comprometido (activos)"
              />
              <MetricCard
                label="Salarios contabilizados"
                value={fmt(salariesSummary.booked)}
                sublabel={`${monthLabel(ym)} · categoría Sueldos`}
              />
              <MetricCard
                label="Diferencia vs comprometido"
                value={`${salariesSummary.diff > 0 ? '+' : ''}${fmt(salariesSummary.diff)}`}
                sublabel={
                  salariesSummary.pctBooked === null
                    ? 'sin salario base registrado'
                    : Math.abs(salariesSummary.diff) < 0.01
                      ? 'coincide con lo comprometido'
                      : `${pct(salariesSummary.pctBooked)} contabilizado · faltan por generar`
                }
              />
            </div>
          </div>

          {/* Métricas de pagos */}
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Métricas de pagos — {monthLabel(ym)}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <MetricCard
                label="Total Payments"
                value={intOrDash(paymentsSummary.totalPayments)}
                sublabel="cobros del mes"
              />
              <MetricCard
                label="Avg GR/payment"
                value={fmtOrDash(paymentsSummary.avgGrPerPayment)}
                sublabel="gross revenue medio"
              />
              <MetricCard label="% Refund" value={pct(paymentsSummary.pctRefund)} sublabel="sobre gross collected" />
              <MetricCard
                label="% New GR"
                value={pct(paymentsSummary.pctNewGr)}
                sublabel={fmtOrDash(paymentsSummary.newGr)}
              />
              <MetricCard
                label="% Followup GR"
                value={pct(paymentsSummary.pctFollowupGr)}
                sublabel={fmtOrDash(paymentsSummary.followupGr)}
              />
              <MetricCard
                label="% Avg Discount"
                value={pct(paymentsSummary.avgDiscountPct)}
                sublabel={`${fmtOrDash(paymentsSummary.totalDiscountAmount)} en descuentos`}
              />
              <MetricCard
                label="Taxes"
                value={fmtOrDash(paymentsSummary.taxesTotal)}
                sublabel={`% Tax: ${pct(paymentsSummary.pctTax)}`}
              />
              <MetricCard
                label="Processing fees"
                value={fmtOrDash(paymentsSummary.processingFees)}
                sublabel="comisiones de pasarela"
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
