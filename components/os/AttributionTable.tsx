'use client'

import { Megaphone } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/utils'
import type { AttribRow } from '@/lib/analytics'

export function AttributionTable({ rows }: { rows: AttribRow[] }) {
  const withData = rows.filter((r) => r.leads > 0 || r.sales > 0)
  return (
    <div className="dashboard-card p-5">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Megaphone className="w-4 h-4 text-brand-400" />
        <h3 className="text-sm font-semibold text-foreground">Actividad por fuente</h3>
        <span className="text-xs text-muted-foreground">
          leads y ventas del periodo; no es una cohorte de conversión
        </span>
      </div>
      {withData.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Sin leads atribuidos todavía.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-2xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left font-medium py-2">Fuente / Anuncio</th>
                <th className="text-right font-medium py-2">Leads</th>
                <th className="text-right font-medium py-2">Ventas</th>
                <th className="text-right font-medium py-2">Facturación</th>
              </tr>
            </thead>
            <tbody>
              {withData.map((r) => (
                <tr key={r.source} className="border-b border-border/50 last:border-0">
                  <td className="py-2.5 text-foreground max-w-[220px] truncate">{r.source}</td>
                  <td className="py-2.5 text-right text-foreground">{formatNumber(r.leads)}</td>
                  <td className="py-2.5 text-right text-foreground">{formatNumber(r.sales)}</td>
                  <td className="py-2.5 text-right font-semibold text-foreground">{formatCurrency(r.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
