'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TrendingUp, Download } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { downloadCSV } from '@/lib/filters/period'
import { useTenantId } from '@/lib/tenant-context'

// Proyección de caja (cash-flow) a 30/60/90 días a partir de las cuotas PENDIENTES de cobro de
// ventas ya realizadas (sale_expected_installments), más las comisiones aprobadas que se liquidarán
// en cada ventana (salida de caja). Solo lectura — para planificación financiera.

type ContactEmbed = { full_name: string } | { full_name: string }[] | null
type SaleEmbed = { contacts: ContactEmbed } | { contacts: ContactEmbed }[] | null
type InstallmentRow = {
  id: string
  due_date: string | null
  expected_gross_amount: number | string
  status: string
  sales: SaleEmbed
}
type CommissionRow = { commission_amount: number | string; direction: string; status: string; liquidation_month: string | null }

const WINDOWS = [30, 60, 90] as const
const num = (x: number | string | null | undefined) => Number(x ?? 0)

export default function ProyeccionPage() {
  const tenantId = useTenantId()
  const [loading, setLoading] = useState(true)
  const [installments, setInstallments] = useState<InstallmentRow[]>([])
  const [commissions, setCommissions] = useState<CommissionRow[]>([])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const supabase = createClient()
      const [instRes, commRes] = await Promise.all([
        supabase
          .from('sale_expected_installments')
          .select('id, due_date, expected_gross_amount, status, sales(contacts(full_name))')
          .eq('tenant_id', tenantId)
          .neq('status', 'collected')
          .order('due_date'),
        supabase
          .from('commissions')
          .select('commission_amount, direction, status, liquidation_month')
          .eq('tenant_id', tenantId)
          .in('status', ['approved', 'pending']),
      ])
      if (!mounted) return
      setInstallments((instRes.data as unknown as InstallmentRow[]) ?? [])
      setCommissions((commRes.data as CommissionRow[]) ?? [])
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [])

  const proj = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dayMs = 1000 * 60 * 60 * 24
    const daysFromNow = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - today.getTime()) / dayMs) : null)

    const buckets = WINDOWS.map((w) => {
      const cobros = installments
        .filter((i) => {
          const dd = daysFromNow(i.due_date)
          return dd !== null && dd <= w // incluye vencidas (dd<=0) y las que vencen dentro de la ventana
        })
        .reduce((a, i) => a + num(i.expected_gross_amount), 0)
      // Comisiones a liquidar dentro de la ventana (por liquidation_month)
      const comisiones = commissions
        .filter((c) => {
          const dd = daysFromNow(c.liquidation_month)
          return dd !== null && dd <= w
        })
        .reduce((a, c) => a + (c.direction === 'negative' ? -num(c.commission_amount) : num(c.commission_amount)), 0)
      return { w, cobros, comisiones, neto: cobros - comisiones }
    })

    const overdue = installments
      .filter((i) => { const dd = daysFromNow(i.due_date); return dd !== null && dd < 0 })
      .reduce((a, i) => a + num(i.expected_gross_amount), 0)

    return { buckets, overdue }
  }, [installments, commissions])

  const nameOf = (s: InstallmentRow['sales']) => {
    const sale = Array.isArray(s) ? s[0] : s
    const c = sale?.contacts
    return (Array.isArray(c) ? c[0]?.full_name : c?.full_name) ?? '—'
  }

  const handleExport = () => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const rows = installments.map((i) => [
      i.due_date ?? '', nameOf(i.sales), num(i.expected_gross_amount).toFixed(2), i.status,
    ])
    downloadCSV('proyeccion_cuotas.csv', ['Vencimiento', 'Alumno', 'Importe', 'Estado'], rows)
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Proyección de caja</h1>
            <p className="text-muted-foreground text-sm mt-1">Cobros previstos a 30/60/90 días desde cuotas pendientes</p>
          </div>
        </div>
        <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-card text-foreground border-border hover:border-border">
          <Download className="w-3.5 h-3.5" /> Exportar CSV
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 bg-card border border-border rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <>
          {proj.overdue > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
              Cuotas ya vencidas pendientes de cobro: <strong>{formatCurrency(proj.overdue)}</strong> (incluidas en todas las ventanas)
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {proj.buckets.map((b) => (
              <div key={b.w} className="bg-card border border-border rounded-lg p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Próximos {b.w} días</p>
                <p className="text-2xl font-bold text-emerald-400 mt-2">{formatCurrency(b.cobros)}</p>
                <p className="text-xs text-muted-foreground mt-1">Cobros previstos</p>
                <div className="mt-3 pt-3 border-t border-border space-y-1 text-xs">
                  <div className="flex justify-between text-muted-foreground"><span>− Comisiones a liquidar</span><span>{formatCurrency(b.comisiones)}</span></div>
                  <div className="flex justify-between text-foreground font-medium"><span>Neto proyectado</span><span>{formatCurrency(b.neto)}</span></div>
                </div>
              </div>
            ))}
          </div>

          {installments.length === 0 && (
            <div className="bg-card border border-border rounded-lg p-10 text-center">
              <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No hay cuotas pendientes registradas.</p>
              <p className="text-muted-foreground text-sm mt-1">Las ventas a plazos generan cuotas esperadas que alimentan esta proyección.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
