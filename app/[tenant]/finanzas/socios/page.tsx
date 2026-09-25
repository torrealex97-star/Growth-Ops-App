'use client'

import { useEffect, useMemo, useState } from 'react'
import { Handshake } from 'lucide-react'
import { lastNMonths, monthLabel } from '@/lib/analytics'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { useTenant } from '@/lib/tenant-context'

type RepartoSocio = { id: string; name: string; profitPercent: number; amount: number }
type RepartoCompleto = { ym: string; preTaxProfit: number; totalPercent: number; socios: RepartoSocio[] }
type RepartoPropio = { ym: string; socios: RepartoSocio[] }

function nowYm() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Ganancias REALES de los socios: % fijo sobre el Pre-Tax Profit del periodo (lib/finance/pnl.ts),
// NO una comisión de venta (docs/MONEY.md D9). El endpoint decide qué se ve: dirección ve el
// reparto completo con el beneficio total; un socio sin rol de dirección (vinculado por
// partners.user_id) ve SOLO su propia fila, nunca el beneficio total de la empresa ni el reparto
// de los demás.
export default function SociosGananciasPage() {
  const tenant = useTenant()
  const [ym, setYm] = useState(nowYm())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<RepartoCompleto | RepartoPropio | null>(null)

  const monthOptions = useMemo(() => lastNMonths(12, nowYm()).reverse(), [])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/${tenant}/evergreen/finanzas/socios?ym=${ym}`)
        const d = await res.json().catch(() => ({}))
        if (!mounted) return
        if (!res.ok) {
          setError(d?.error || 'No se pudo cargar el reparto de socios')
          setData(null)
          return
        }
        setData(d)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [tenant, ym])

  const esRepartoCompleto = (d: RepartoCompleto | RepartoPropio | null): d is RepartoCompleto =>
    !!d && 'preTaxProfit' in d

  return (
    <div className="dashboard-surface space-y-5 max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Handshake className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Socios</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Reparto de beneficio real del periodo — no es comisión de venta.
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

      {loading ? (
        <div className="dashboard-card p-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 bg-muted rounded animate-pulse" style={{ width: `${50 + (i % 3) * 15}%` }} />
          ))}
        </div>
      ) : error ? (
        <div className="dashboard-card p-6 text-sm text-red-400">{error}</div>
      ) : !data || data.socios.length === 0 ? (
        <div className="dashboard-card p-6 text-sm text-muted-foreground">
          No hay socios activos configurados. Añádelos en Configuración → Socios.
        </div>
      ) : (
        <>
          {esRepartoCompleto(data) && (
            <div className="dashboard-card p-6 space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Beneficio real del periodo (Pre-Tax Profit)
              </p>
              <p className="text-3xl font-semibold tabular-nums text-foreground">{formatCurrency(data.preTaxProfit)}</p>
              <p className="text-xs text-muted-foreground">
                Ya descuenta gastos y comisiones de venta del periodo. Reparto activo:{' '}
                {formatPercent(data.totalPercent, 0)}
                {data.totalPercent > 100 && (
                  <span className="text-red-400"> — supera el 100%, revisa Configuración → Socios</span>
                )}
              </p>
            </div>
          )}

          <div className="dashboard-card divide-y divide-border">
            {data.socios.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{formatPercent(s.profitPercent, 2)} del beneficio</p>
                </div>
                <p
                  className={`text-lg font-semibold tabular-nums ${s.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}
                >
                  {formatCurrency(s.amount)}
                </p>
              </div>
            ))}
          </div>

          {!esRepartoCompleto(data) && (
            <p className="text-xs text-muted-foreground">
              Ves solo tu propia parte. El beneficio total y el reparto de otros socios lo ve dirección en esta misma
              pantalla.
            </p>
          )}
        </>
      )}
    </div>
  )
}
