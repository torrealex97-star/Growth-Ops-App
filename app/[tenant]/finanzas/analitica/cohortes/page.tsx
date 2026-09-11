'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CalendarRange } from 'lucide-react'
import { monthLabel } from '@/lib/analytics'
import { formatCurrency } from '@/lib/utils'

type SaleRow = { id: string; sale_date: string | null; gross_amount: number | string; status: string }
type CollectionRow = { sale_id: string; gross_amount: number | string; collected_at: string | null; status: string }

const WINDOWS = [30, 60, 90, 180] as const

const num = (x: number | string | null | undefined) => Number(x ?? 0)
const ymOf = (d: string | null | undefined) => (d ? String(d).slice(0, 7) : '')

type CohortRow = {
  ym: string
  contracted: number
  clients: number
  collectedAt: Record<number, number>
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  return (db - da) / (1000 * 60 * 60 * 24)
}

function buildCohorts(sales: SaleRow[], collections: CollectionRow[]): CohortRow[] {
  const saleMap = new Map(sales.map((s) => [s.id, s]))
  const byCohort = new Map<string, CohortRow>()

  const ensure = (ym: string) =>
    byCohort.get(ym) ??
    byCohort
      .set(ym, { ym, contracted: 0, clients: 0, collectedAt: { 30: 0, 60: 0, 90: 0, 180: 0 } })
      .get(ym)!

  for (const s of sales) {
    if (!s.sale_date) continue
    const ym = ymOf(s.sale_date)
    if (!ym) continue
    const row = ensure(ym)
    row.contracted += num(s.gross_amount)
    row.clients += 1
  }

  for (const c of collections) {
    if (c.status !== 'collected' || !c.collected_at) continue
    const sale = saleMap.get(c.sale_id)
    if (!sale || !sale.sale_date) continue
    const ym = ymOf(sale.sale_date)
    if (!ym || !byCohort.has(ym)) continue
    const row = byCohort.get(ym)!
    const diff = daysBetween(sale.sale_date, c.collected_at)
    if (diff < 0) continue
    for (const w of WINDOWS) {
      if (diff <= w) row.collectedAt[w] += num(c.gross_amount)
    }
  }

  return Array.from(byCohort.values()).sort((a, b) => (a.ym < b.ym ? 1 : -1))
}

function pctColor(pct: number): string {
  if (pct >= 80) return 'text-emerald-400'
  if (pct >= 50) return 'text-amber-400'
  return 'text-red-400'
}

export default function CohortsPage() {
  const [loading, setLoading] = useState(true)
  const [sales, setSales] = useState<SaleRow[]>([])
  const [collections, setCollections] = useState<CollectionRow[]>([])

  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()
      const [salesRes, collRes] = await Promise.all([
        supabase.from('sales').select('id, sale_date, gross_amount, status'),
        supabase.from('collections').select('sale_id, gross_amount, collected_at, status'),
      ])
      if (!mounted) return
      setSales(salesRes.data || [])
      setCollections(collRes.data || [])
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const cohorts = useMemo(() => buildCohorts(sales, collections).slice(0, 12), [sales, collections])

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <CalendarRange className="w-5 h-5 text-brand-400" />
          <h1 className="text-2xl font-bold text-foreground">Cohortes</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          Cobro por cohorte de venta a 30/60/90/180 días
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
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
                    <th key={w} className="text-right px-4 py-3">%{w}d</th>
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
        Esta vista detecta el deterioro de la calidad de cobro antes de que impacte en el cashflow: si el %30d o %60d
        de las cohortes recientes empieza a caer respecto a cohortes anteriores, es una señal temprana de que las
        ventas nuevas están tardando más en convertirse en caja (o directamente no se están cobrando), aunque la
        facturación bruta siga viéndose bien.
      </p>
    </div>
  )
}
