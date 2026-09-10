'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Receipt } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { lastNMonths, monthLabel } from '@/lib/analytics'
import { formatCurrency } from '@/lib/utils'

type SaleRow = { gross_amount: number | string; discount: number | string | null; status: string; sale_date: string | null }
type CollectionRow = { id: string; gross_amount: number | string; processing_fee: number | string | null; collected_at: string | null; status: string }
type RefundRow = { gross_refund_amount: number | string; refund_date: string | null; status: string }
type ExpenseRow = { amount: number | string; category: string; expense_date: string | null; status: string }
type CommissionRow = { commission_amount: number | string; direction: string; collection_id: string | null; liquidation_month: string | null; status: string }
type PartnerRow = { id: string; name: string; profit_percent: number | string; is_active: boolean }

const num = (x: number | string | null | undefined) => Number(x ?? 0)
const ymOf = (d: string | null | undefined) => (d ? String(d).slice(0, 7) : '')

function nowYm() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function Line({
  label,
  value,
  bold = false,
  border = false,
  indent = false,
  negative = false,
}: {
  label: string
  value: string
  bold?: boolean
  border?: boolean
  indent?: boolean
  negative?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between py-2.5 ${border ? 'border-t border-border mt-1 pt-3' : ''} ${
        indent ? 'pl-4' : ''
      }`}
    >
      <span className={`${bold ? 'text-foreground font-semibold' : 'text-foreground'} text-sm`}>{label}</span>
      <span
        className={`${bold ? 'text-foreground font-semibold' : 'text-foreground'} text-sm tabular-nums ${
          negative ? 'text-red-400' : ''
        }`}
      >
        {value}
      </span>
    </div>
  )
}

function PctLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 pl-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{value}</span>
    </div>
  )
}

// NOTA CONTABLE — Devoluciones:
// - Gross Revenue = Σ collections del mes con status = 'collected' (facturación BRUTA, sin restar nada).
// - Refunds = Σ refunds.gross_refund_amount del mes (línea separada, informativa).
// - Net Revenue = Gross Revenue − Refunds − Discounts (las devoluciones se restan UNA sola vez aquí).
// - Pre-Tax Profit = Net Revenue − COGS − Total OpEx (ya parte de un revenue neto de devoluciones,
//   por lo que Refunds NO vuelve a restarse en OpEx ni en ningún otro punto de este cálculo).
export default function PnlPage() {
  const [loading, setLoading] = useState(true)
  const [ym, setYm] = useState(nowYm())
  const [sales, setSales] = useState<SaleRow[]>([])
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [refunds, setRefunds] = useState<RefundRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [commissions, setCommissions] = useState<CommissionRow[]>([])
  const [partners, setPartners] = useState<PartnerRow[]>([])

  const monthOptions = useMemo(() => lastNMonths(12, nowYm()).reverse(), [])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      const supabase = createClient()
      const [salesRes, collRes, refundsRes, expensesRes, commissionsRes, partnersRes] = await Promise.all([
        supabase.from('sales').select('gross_amount, discount, status, sale_date'),
        supabase.from('collections').select('id, gross_amount, processing_fee, collected_at, status'),
        supabase.from('refunds').select('gross_refund_amount, refund_date, status'),
        supabase.from('expenses').select('amount, category, expense_date, status'),
        supabase.from('commissions').select('commission_amount, direction, collection_id, liquidation_month, status'),
        supabase.from('partners').select('*').eq('is_active', true),
      ])
      if (!mounted) return
      setSales(salesRes.data || [])
      setCollections(collRes.data || [])
      setRefunds(refundsRes.data || [])
      setExpenses(expensesRes.data || [])
      setCommissions(commissionsRes.data || [])
      setPartners(partnersRes.data || [])
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [])

  const pnl = useMemo(() => {
    const monthSales = sales.filter((s) => ymOf(s.sale_date) === ym)
    const monthCollections = collections.filter((c) => c.status === 'collected' && ymOf(c.collected_at) === ym)
    const monthRefunds = refunds.filter((r) => ymOf(r.refund_date) === ym)
    const monthExpenses = expenses.filter((e) => ymOf(e.expense_date) === ym)

    // Correlación (matching): la comisión es un coste del INGRESO que la generó, así que se
    // reconoce en el mes del COBRO asociado (collected_at), no en su mes de liquidación/pago.
    // Antes se comparaba `liquidation_month === ym` (fecha completa 'YYYY-MM-01' vs 'YYYY-MM') → nunca
    // casaba y la comisión salía siempre 0. Las negativas (devoluciones) se imputan a su mes de
    // liquidación (= mes de la devolución).
    const collMonth = new Map(collections.map((c) => [c.id, ymOf(c.collected_at)]))
    const commissionYm = (c: CommissionRow) =>
      c.direction === 'negative'
        ? ymOf(c.liquidation_month)
        : (c.collection_id ? collMonth.get(c.collection_id) : undefined) ?? ymOf(c.liquidation_month)
    const monthCommissions = commissions.filter((c) => commissionYm(c) === ym)

    const contractedRevenue = monthSales.reduce((a, s) => a + num(s.gross_amount), 0)
    const grossRevenue = monthCollections.reduce((a, c) => a + num(c.gross_amount), 0)
    const realizedCr = contractedRevenue ? grossRevenue / contractedRevenue : null

    const totalRefunds = monthRefunds.reduce((a, r) => a + num(r.gross_refund_amount), 0)
    const totalDiscounts = monthSales.reduce((a, s) => a + num(s.discount), 0)

    const netRevenue = grossRevenue - totalRefunds - totalDiscounts

    const cogs = monthExpenses
      .filter((e) => e.category === 'cogs')
      .reduce((a, e) => a + num(e.amount), 0)

    const grossProfit = netRevenue - cogs
    const grossMargin = netRevenue ? grossProfit / netRevenue : null

    const comisiones = monthCommissions.reduce((a, c) => {
      const amt = num(c.commission_amount)
      return a + (c.direction === 'negative' ? -amt : amt)
    }, 0)
    const salarios = monthExpenses.filter((e) => e.category === 'sueldos').reduce((a, e) => a + num(e.amount), 0)
    const adspend = monthExpenses.filter((e) => e.category === 'publicidad').reduce((a, e) => a + num(e.amount), 0)
    const software = monthExpenses.filter((e) => e.category === 'herramientas').reduce((a, e) => a + num(e.amount), 0)
    const platformFees = monthCollections.reduce((a, c) => a + num(c.processing_fee), 0)
    const otros = monthExpenses
      .filter((e) => e.category === 'eventos' || e.category === 'otros')
      .reduce((a, e) => a + num(e.amount), 0)

    const totalOpex = comisiones + salarios + adspend + software + platformFees + otros

    const preTaxProfit = netRevenue - cogs - totalOpex
    const preTaxMargin = netRevenue ? preTaxProfit / netRevenue : null

    const roiBase = totalOpex + cogs
    const roi = roiBase ? preTaxProfit / roiBase : null

    return {
      contractedRevenue,
      grossRevenue,
      realizedCr,
      totalRefunds,
      totalDiscounts,
      netRevenue,
      cogs,
      grossProfit,
      grossMargin,
      comisiones,
      salarios,
      adspend,
      software,
      platformFees,
      otros,
      totalOpex,
      preTaxProfit,
      preTaxMargin,
      roi,
    }
  }, [sales, collections, refunds, expenses, commissions, ym])

  const partnersDistribution = useMemo(() => {
    return partners.map((p) => {
      const percent = num(p.profit_percent)
      return {
        id: p.id,
        name: p.name,
        percent,
        amount: pnl.preTaxProfit * (percent / 100),
      }
    })
  }, [partners, pnl.preTaxProfit])

  const pct = (v: number | null) => (v === null || !isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`)
  const money = (v: number) => formatCurrency(v)

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
            <Receipt className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">I&amp;G — Ingresos y Gastos</h1>
            <p className="text-muted-foreground text-sm mt-1">Cuenta de resultados mensual</p>
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
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="bg-card border border-border rounded-lg p-6 space-y-3">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="h-5 bg-muted rounded animate-pulse" style={{ width: `${60 + (i % 5) * 8}%` }} />
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-6 divide-y divide-border">
          <Line label="Contracted Revenue" value={money(pnl.contractedRevenue)} />
          <Line label="Gross Revenue (Cash Collected, bruto)" value={money(pnl.grossRevenue)} />
          <PctLine label="Realized CR" value={pct(pnl.realizedCr)} />
          <Line label="(−) Devoluciones" value={`− ${money(pnl.totalRefunds)}`} negative />
          <Line label="(−) Descuentos" value={`− ${money(pnl.totalDiscounts)}`} negative />
          <Line label="Net Revenue (neto de devoluciones y descuentos)" value={money(pnl.netRevenue)} bold border />

          <Line label="COGS" value={`− ${money(pnl.cogs)}`} negative />
          <Line label="Gross Profit" value={money(pnl.grossProfit)} bold border />
          <PctLine label="Margen" value={pct(pnl.grossMargin)} />

          <Line label="Comisiones" value={`${pnl.comisiones < 0 ? '+' : '−'} ${money(Math.abs(pnl.comisiones))}`} indent negative={pnl.comisiones >= 0} />
          <Line label="Salarios" value={`− ${money(pnl.salarios)}`} indent negative />
          <Line label="Adspend" value={`− ${money(pnl.adspend)}`} indent negative />
          <Line label="Software" value={`− ${money(pnl.software)}`} indent negative />
          <Line label="Comisiones plataforma" value={`− ${money(pnl.platformFees)}`} indent negative />
          <Line label="Otros" value={`− ${money(pnl.otros)}`} indent negative />
          <Line label="Total OpEx" value={money(pnl.totalOpex)} bold border />

          <Line label="Pre-Tax Profit (ya neto de devoluciones)" value={money(pnl.preTaxProfit)} bold border />
          <PctLine label="Margen" value={pct(pnl.preTaxMargin)} />
          <PctLine label="ROI" value={pct(pnl.roi)} />
        </div>
      )}

      {!loading && (
        <div>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Reparto de socios — {monthLabel(ym)}
          </h2>
          {partnersDistribution.length === 0 ? (
            <div className="bg-card border border-border rounded-lg p-5">
              <p className="text-sm text-muted-foreground text-center">No hay socios activos configurados.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Socio</TableHead>
                    <TableHead className="text-muted-foreground">%</TableHead>
                    <TableHead className="text-muted-foreground">Importe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partnersDistribution.map((p) => (
                    <TableRow key={p.id} className="border-border">
                      <TableCell className="text-foreground font-medium">{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.percent.toFixed(2)}%</TableCell>
                      <TableCell className={`font-medium tabular-nums ${p.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {money(p.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
