import { cuentaComoVenta } from '@/lib/analytics'

// Única fuente de verdad para el cálculo de I&G/Resultado neto mensual — antes vivía
// duplicado (con fórmulas ya divergentes) en finanzas/page.tsx, pnl/page.tsx y gestoria/page.tsx.
// Las pantallas deben leer de aquí, nunca recalcular su propia versión de "resultado neto".
//
// NOTA CONTABLE — Devoluciones:
// - Gross Revenue = Σ collections del mes con status = 'collected' (facturación BRUTA, sin restar nada).
// - Refunds = Σ refunds.gross_refund_amount del mes (línea separada, informativa).
// - Net Revenue = Gross Revenue − Refunds − Discounts (las devoluciones se restan UNA sola vez aquí).
// - Pre-Tax Profit = Net Revenue − COGS − Total OpEx (ya parte de un revenue neto de devoluciones,
//   por lo que Refunds NO vuelve a restarse en OpEx ni en ningún otro punto de este cálculo).
//
// CANONICALIZACIÓN (Fase 5): contractedRevenue usaba TODAS las ventas del mes sin filtrar por
// status, mientras que Dashboard/lib/analytics.ts (isActiveSale) excluye refunded/chargeback/
// cancelled. Dos pantallas mostrando "ventas del mes" con cifras distintas para el mismo periodo
// es el bug canónico que esta fase corrige — se adopta aquí el mismo filtro que ya usa analytics.ts
// como ÚNICA definición de "venta que cuenta como negocio real". Ver docs/METRICS.md.

// PostgREST trunca a un límite por defecto (típicamente 1000 filas) cualquier select sin
// `.range()` explícito — las páginas de P&L/Finanzas traen tablas completas (sales, collections,
// commissions...) para calcular en cliente, así que sin este límite explícito el negocio podría
// superar silenciosamente las 1000 filas y el P&L se calcularía sobre un subconjunto truncado
// sin ningún aviso de error. No se puede acotar por fecha en su lugar: computeMonthlyPnl necesita
// poder resolver el mes de cualquier commission a través de collection_id incluso si esa
// collection es de un mes distinto al que se está mostrando (comisiones liquidadas después).
export const FINANCE_QUERY_ROW_CAP = 49999

export type PnlSaleRow = {
  gross_amount: number | string
  discount: number | string | null
  sale_date: string | null
  status: string
  /** Reserva abierta: no es venta ni factura (MONEY D8). Sin estos campos volvería a contarse. */
  payment_plan_method?: string | null
  reservation_completed_at?: string | null
}
export type PnlCollectionRow = {
  id: string
  gross_amount: number | string
  processing_fee: number | string | null
  collected_at: string | null
  status: string
}
export type PnlRefundRow = { gross_refund_amount: number | string; refund_date: string | null }
export type PnlExpenseRow = { amount: number | string; category: string; expense_date: string | null }
export type PnlCommissionRow = {
  commission_amount: number | string
  direction: string
  collection_id: string | null
  liquidation_month: string | null
}

export interface MonthlyPnl {
  contractedRevenue: number
  grossRevenue: number
  realizedCr: number | null
  totalRefunds: number
  totalDiscounts: number
  netRevenue: number
  cogs: number
  grossProfit: number
  grossMargin: number | null
  comisiones: number
  salarios: number
  adspend: number
  software: number
  platformFees: number
  otros: number
  totalOpex: number
  preTaxProfit: number
  preTaxMargin: number | null
  roi: number | null
}

const num = (x: number | string | null | undefined) => Number(x ?? 0)
const ymOf = (d: string | null | undefined) => (d ? String(d).slice(0, 7) : '')

export function computeMonthlyPnl(
  ym: string,
  data: {
    sales: PnlSaleRow[]
    collections: PnlCollectionRow[]
    refunds: PnlRefundRow[]
    expenses: PnlExpenseRow[]
    commissions: PnlCommissionRow[]
  }
): MonthlyPnl {
  const { sales, collections, refunds, expenses, commissions } = data
  const monthSales = sales.filter((s) => cuentaComoVenta(s) && ymOf(s.sale_date) === ym)
  const monthCollections = collections.filter((c) => c.status === 'collected' && ymOf(c.collected_at) === ym)
  const monthRefunds = refunds.filter((r) => ymOf(r.refund_date) === ym)
  const monthExpenses = expenses.filter((e) => ymOf(e.expense_date) === ym)

  // Correlación (matching): la comisión es un coste del INGRESO que la generó, así que se
  // reconoce en el mes del COBRO asociado (collected_at), no en su mes de liquidación/pago.
  // Las negativas (devoluciones) se imputan a su mes de liquidación (= mes de la devolución).
  const collMonth = new Map(collections.map((c) => [c.id, ymOf(c.collected_at)]))
  const commissionYm = (c: PnlCommissionRow) =>
    c.direction === 'negative'
      ? ymOf(c.liquidation_month)
      : ((c.collection_id ? collMonth.get(c.collection_id) : undefined) ?? ymOf(c.liquidation_month))
  const monthCommissions = commissions.filter((c) => commissionYm(c) === ym)

  const contractedRevenue = monthSales.reduce((a, s) => a + num(s.gross_amount), 0)
  const grossRevenue = monthCollections.reduce((a, c) => a + num(c.gross_amount), 0)
  const realizedCr = contractedRevenue ? grossRevenue / contractedRevenue : null

  const totalRefunds = monthRefunds.reduce((a, r) => a + num(r.gross_refund_amount), 0)
  const totalDiscounts = monthSales.reduce((a, s) => a + num(s.discount), 0)

  const netRevenue = grossRevenue - totalRefunds - totalDiscounts

  const cogs = monthExpenses.filter((e) => e.category === 'cogs').reduce((a, e) => a + num(e.amount), 0)

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
}
