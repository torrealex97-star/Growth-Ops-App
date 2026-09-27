'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTenantId } from '@/lib/tenant-context'
import { createClient } from '@/lib/supabase/client'
import { CalendarRange } from 'lucide-react'
import { cuentaComoVenta, monthLabel } from '@/lib/analytics'
import { metodoDePlan } from '@/lib/metrics/agregados'
import { formatCurrency } from '@/lib/utils'
import { FINANCE_QUERY_ROW_CAP } from '@/lib/finance/pnl'
import {
  buildCohorts,
  COHORT_WINDOWS,
  type CohortRow,
  type CohortSaleRow,
  type CohortCollectionRow,
} from '@/lib/finance/cohortes'

type SaleRow = CohortSaleRow & { payment_plans?: unknown }
type CollectionRow = CohortCollectionRow

const WINDOWS = COHORT_WINDOWS

function pctColor(pct: number): string {
  if (pct >= 80) return 'text-emerald-400'
  if (pct >= 50) return 'text-amber-400'
  return 'text-red-400'
}

export default function CohortsPage() {
  const tenantId = useTenantId()
  const [loading, setLoading] = useState(true)
  const [sales, setSales] = useState<SaleRow[]>([])
  const [collections, setCollections] = useState<CollectionRow[]>([])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      const supabase = createClient()
      const [salesRes, collRes] = await Promise.all([
        supabase
          .from('sales')
          // reservation_completed_at + payment_plans(method): sin ellos una reserva abierta es
          // indistinguible de una venta y vuelve a contarse como facturación (MONEY D8, F03).
          .select('id, sale_date, gross_amount, status, contact_id, reservation_completed_at, payment_plans(method)')
          .eq('tenant_id', tenantId)
          .range(0, FINANCE_QUERY_ROW_CAP),
        supabase
          .from('collections')
          .select('sale_id, gross_amount, collected_at, status')
          .eq('tenant_id', tenantId)
          .range(0, FINANCE_QUERY_ROW_CAP),
      ])
      if (!mounted) return
      // El embed de payment_plans llega anidado: se aplana aquí para que el predicado de venta
      // (cuentaComoVenta) pueda ver si la fila es una reserva todavía abierta.
      setSales(((salesRes.data || []) as SaleRow[]).map((v) => ({ ...v, payment_plan_method: metodoDePlan(v) })))
      setCollections(collRes.data || [])
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [tenantId])

  const cohorts = useMemo(() => buildCohorts(sales, collections).slice(0, 12), [sales, collections])

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <CalendarRange className="w-5 h-5 text-brand-400" />
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Cohortes</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1">Cobro por cohorte de venta a 30/60/90/180 días</p>
      </div>

      <div className="dashboard-card overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 bg-muted rounded animate-pulse" />
            ))}
          </div>
        ) : cohorts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">Sin datos todavía</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Cohorte</th>
                  <th className="text-right px-4 py-3">Contratado</th>
                  <th className="text-right px-4 py-3">Clientes</th>
                  {WINDOWS.map((w) => (
                    <th key={w} className="text-right px-4 py-3">
                      %{w}d
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((row) => (
                  <tr key={row.ym} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 text-foreground font-medium capitalize">{monthLabel(row.ym)}</td>
                    <td className="px-4 py-3 text-right text-foreground">{formatCurrency(row.contracted)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{row.clients}</td>
                    {WINDOWS.map((w) => {
                      const collected = row.collectedAt[w]
                      const pct = row.contracted ? (collected / row.contracted) * 100 : 0
                      return (
                        <td key={w} className="px-4 py-3 text-right">
                          <div className={`font-semibold ${pctColor(pct)}`}>
                            {row.contracted ? `${pct.toFixed(0)}%` : '—'}
                          </div>
                          <div className="text-xs text-muted-foreground">{formatCurrency(collected)}</div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground max-w-3xl">
        Esta vista detecta el deterioro de la calidad de cobro antes de que impacte en el cashflow: si el %30d o %60d de
        las cohortes recientes empieza a caer respecto a cohortes anteriores, es una señal temprana de que las ventas
        nuevas están tardando más en convertirse en caja (o directamente no se están cobrando), aunque la facturación
        bruta siga viéndose bien.
      </p>
    </div>
  )
}
