// COHORTES DE COBRO — lógica pura (docs/METRICS.md §7)
// La página `app/[tenant]/finanzas/analitica/cohortes/page.tsx` consume esta capa canónica en vez de
// recalcular el cohort en cliente. Corrige el OUT_OF_SCOPE_FINDING ya documentado: la columna
// "Clientes" cuenta FILAS DE VENTA, no contactos únicos — un contacto con 2 ventas activas en la
// misma cohorte se contaba 2 veces. Misma regla canónica que Unit Economics (docs/METRICS.md §6):
// clientes = contact_id distintos con venta activa.
import { cuentaComoVenta } from '@/lib/analytics'

export type CohortSaleRow = {
  id: string
  sale_date: string | null
  gross_amount: number | string | null
  status: string
  contact_id: string | null
  /** Reserva: método del plan y cuándo se completó — el predicado canónico lo necesita (MONEY D8). */
  payment_plan_method?: string | null
  reservation_completed_at?: string | null
}

export type CohortCollectionRow = {
  sale_id: string | null
  gross_amount: number | string | null
  collected_at: string | null
  status: string
}

export const COHORT_WINDOWS = [30, 60, 90, 180] as const
export type CohortWindow = (typeof COHORT_WINDOWS)[number]

export type CohortRow = {
  ym: string
  contracted: number
  clients: number
  collectedAt: Record<CohortWindow, number>
  mature: Record<CohortWindow, boolean>
}

const num = (x: number | string | null | undefined): number => Number(x ?? 0)
const ymOf = (d: string | null | undefined): string => (d ? String(d).slice(0, 7) : '')

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  return (db - da) / (1000 * 60 * 60 * 24)
}

/**
 * Cohortes por mes de `sale_date`, igual semántica que la página histórica:
 *  · "Contratado": solo ventas que cuentan (cuentaComoVenta — post #221, una reserva
 *    abierta ya no es venta), suma gross_amount.
 *  · Clientes: contactos únicos (contact_id) con venta activa en la cohorte —
 *    no filas de venta (METRICS.md §6/§7). Una venta sin contact_id cae de este
 *    recuento (hoy no ocurre: 100% de ventas llevan contacto).
 *  · % cobrado a Nd: colecciones 'collected' de ventas de la cohorte con
 *    collected_at − sale_date ≤ N días, sumadas dentro de cada ventana.
 */
export function buildCohorts(
  sales: CohortSaleRow[],
  collections: CohortCollectionRow[],
  now = new Date()
): CohortRow[] {
  const saleMap = new Map(sales.map((s) => [s.id, s]))
  const byCohort = new Map<string, CohortRow>()

  const ensure = (ym: string): CohortRow => {
    const existing = byCohort.get(ym)
    if (existing) return existing
    const [year, month] = ym.split('-').map(Number)
    const endOfMonth = Date.UTC(year, month, 0)
    const mature = Object.fromEntries(
      COHORT_WINDOWS.map((w) => [w, endOfMonth + w * 86400000 <= now.getTime()])
    ) as Record<CohortWindow, boolean>
    const row: CohortRow = { ym, contracted: 0, clients: 0, collectedAt: { 30: 0, 60: 0, 90: 0, 180: 0 }, mature }
    byCohort.set(ym, row)
    return row
  }

  // Clientes = contactos ÚNICOS por cohorte (no filas de venta): METRICS.md §6/§7.
  const contactsPorCohorte = new Map<string, Set<string>>()
  for (const s of sales) {
    if (!s.sale_date || !cuentaComoVenta(s)) continue
    const ym = ymOf(s.sale_date)
    if (!ym) continue
    const row = ensure(ym)
    row.contracted += num(s.gross_amount)
    if (s.contact_id) {
      let set = contactsPorCohorte.get(ym)
      if (!set) {
        set = new Set<string>()
        contactsPorCohorte.set(ym, set)
      }
      set.add(s.contact_id)
    }
  }
  for (const [ym, set] of contactsPorCohorte) {
    const row = byCohort.get(ym)
    if (row) row.clients = set.size
  }

  for (const c of collections) {
    if (c.status !== 'collected' || !c.collected_at || !c.sale_id) continue
    const sale = saleMap.get(c.sale_id)
    if (!sale || !sale.sale_date || !cuentaComoVenta(sale) || Date.parse(c.collected_at) > now.getTime()) continue
    const ym = ymOf(sale.sale_date)
    if (!ym || !byCohort.has(ym)) continue
    const row = byCohort.get(ym)!
    const diff = daysBetween(sale.sale_date, c.collected_at)
    if (diff < 0) continue
    for (const w of COHORT_WINDOWS) {
      if (diff <= w) row.collectedAt[w] += num(c.gross_amount)
    }
  }

  return Array.from(byCohort.values()).sort((a, b) => (a.ym < b.ym ? 1 : -1))
}
