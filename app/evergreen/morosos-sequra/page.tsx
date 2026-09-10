'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { SearchBox, normalizeText } from '@/components/ui/search-box'

type StatusKey = 'pendiente' | 'contactado' | 'recuperado' | 'incobrable'

type DelinquentRow = {
  id: string
  order_reference: string
  customer_name: string | null
  customer_email: string | null
  product_name: string | null
  order_value: number | null
  debt_amount: number | null
  overdue_days: number | null
  overdue_since: string | null
  status: StatusKey
  notes: string | null
  last_synced_at: string
}

type TabKey = StatusKey | 'todas'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'pendiente', label: 'Pendientes' },
  { key: 'contactado', label: 'Contactados' },
  { key: 'recuperado', label: 'Recuperados' },
  { key: 'incobrable', label: 'Incobrables' },
  { key: 'todas', label: 'Todas' },
]

const STATUS_BADGE: Record<StatusKey, string> = {
  pendiente: 'bg-red-500/20 text-red-400 border-red-500/30',
  contactado: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  recuperado: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  incobrable: 'bg-muted/50 text-muted-foreground border-border/30',
}

export default function MorososSequraPage() {
  const [rows, setRows] = useState<DelinquentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [tab, setTab] = useState<TabKey>('pendiente')
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('sequra_delinquent_customers')
      .select('*')
      .order('overdue_days', { ascending: false })
    if (error) {
      toast.error('Error al cargar morosos', { description: error.message })
      setRows([])
    } else {
      setRows((data as DelinquentRow[]) || [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const lastSyncedAt = useMemo(
    () => rows.reduce<string | null>((max, r) => (!max || r.last_synced_at > max ? r.last_synced_at : max), null),
    [rows]
  )

  const visibleRows = useMemo(() => {
    const base = tab === 'todas' ? rows : rows.filter((r) => r.status === tab)
    const nq = normalizeText(q.trim())
    if (!nq) return base
    return base.filter(
      (r) =>
        normalizeText(r.customer_name || '').includes(nq) ||
        normalizeText(r.customer_email || '').includes(nq) ||
        normalizeText(r.order_reference || '').includes(nq)
    )
  }, [rows, tab, q])

  const kpis = useMemo(() => {
    const pendientes = rows.filter((r) => r.status === 'pendiente')
    return {
      pendientesCount: pendientes.length,
      pendientesAmount: pendientes.reduce((sum, r) => sum + (r.debt_amount || 0), 0),
      totalCount: rows.length,
    }
  }, [rows])

  const runSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/evergreen/cron/sequra-morosos', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        toast.error('No se pudo sincronizar con sequra', { description: data.error })
        return
      }
      toast.success(
        `Sincronizado: ${data.delinquentFound} morosos activos (${data.checked} pedidos revisados, ${data.recovered} recuperados)`
      )
      await load()
    } catch (err) {
      toast.error('Error de red', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setSyncing(false)
    }
  }

  const updateRow = async (id: string, fields: { status?: StatusKey; notes?: string }) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/evergreen/sequra-morosos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        toast.error('No se pudo actualizar', { description: data.error })
        return
      }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)))
    } catch (err) {
      toast.error('Error de red', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-brand-400" /> Morosos sequra
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Clientes de IA Winners con cuotas de sequra realmente vencidas — para seguimiento de cobro
          </p>
        </div>
        <div className="text-right shrink-0">
          <button
            onClick={runSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-3 py-2 rounded text-sm bg-brand-600/20 text-brand-400 border border-brand-600/30 hover:bg-brand-600/30 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando…' : 'Actualizar ahora'}
          </button>
          {lastSyncedAt && (
            <p className="text-xs text-muted-foreground mt-1.5">
              Última sincronización: {formatDate(lastSyncedAt)}
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 bg-card rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Morosos pendientes</p>
              <p className="text-2xl font-bold text-red-400 mt-1">{kpis.pendientesCount}</p>
            </div>
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Deuda vencida pendiente</p>
              <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(kpis.pendientesAmount)}</p>
            </div>
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Total histórico</p>
              <p className="text-2xl font-bold text-brand-400 mt-1">{kpis.totalCount}</p>
            </div>
          </div>

          <div className="flex justify-end">
            <SearchBox value={q} onChange={setQ} placeholder="Buscar por cliente, email o pedido..." />
          </div>

          <div className="flex gap-2 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                  tab === t.key
                    ? 'border-brand-500 text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({t.key === 'todas' ? rows.length : rows.filter((r) => r.status === t.key).length})
                </span>
              </button>
            ))}
          </div>

          {visibleRows.length === 0 ? (
            <div className="bg-card/50 border border-border rounded-lg p-10 text-center">
              <p className="text-muted-foreground text-sm">Sin morosos en esta vista</p>
            </div>
          ) : (
            <div className="bg-card/50 border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Producto</th>
                    <th className="px-4 py-3 font-medium">Vencido desde</th>
                    <th className="px-4 py-3 font-medium">Días de mora</th>
                    <th className="px-4 py-3 font-medium">Deuda</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium">Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const isBusy = busyId === row.id
                    return (
                      <tr key={row.id} className="border-b border-border/70 last:border-0 hover:bg-card/70 align-top">
                        <td className="px-4 py-3">
                          <p className="text-foreground">{row.customer_name || '—'}</p>
                          <p className="text-xs text-muted-foreground">{row.customer_email || '—'}</p>
                          <p className="text-xs text-muted-foreground">{row.order_reference}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{row.product_name || '—'}</td>
                        <td className="px-4 py-3 text-orange-400">{formatDate(row.overdue_since)}</td>
                        <td className="px-4 py-3 text-foreground">{row.overdue_days ?? '—'}</td>
                        <td className="px-4 py-3 text-foreground font-medium">{formatCurrency(row.debt_amount)}</td>
                        <td className="px-4 py-3">
                          <select
                            value={row.status}
                            disabled={isBusy}
                            onChange={(e) => updateRow(row.id, { status: e.target.value as StatusKey })}
                            className={`text-[10px] font-semibold px-2 py-1 rounded border disabled:opacity-50 ${STATUS_BADGE[row.status]}`}
                          >
                            {TABS.filter((t) => t.key !== 'todas').map((t) => (
                              <option key={t.key} value={t.key} className="bg-card text-foreground">
                                {t.label.toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            defaultValue={row.notes ?? ''}
                            disabled={isBusy}
                            onBlur={(e) => {
                              if (e.target.value !== (row.notes ?? '')) updateRow(row.id, { notes: e.target.value })
                            }}
                            placeholder="Añadir nota..."
                            className="w-48 bg-transparent border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground disabled:opacity-50"
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
