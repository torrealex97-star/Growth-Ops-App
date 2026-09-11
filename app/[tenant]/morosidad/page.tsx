'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, Flag, FlagOff, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { getPeriodRange, inPeriod, type PeriodPreset } from '@/lib/filters/period'
import { SearchBox, normalizeText, phoneMatches } from '@/components/ui/search-box'
import { useTenant } from '@/lib/tenant-context'

type InstallmentRow = {
  id: string
  sale_id: string
  installment_number: number
  due_date: string | null
  expected_gross_amount: number
  expected_commissionable_amount: number
  status: 'pending' | 'collected' | 'overdue' | 'cancelled'
  flagged_delinquent: boolean | null
  reminder_count: number | null
  is_monitoring: boolean | null
  created_at: string
  updated_at: string
  sales: {
    id: string
    gross_amount: number
    contact_id: string
    payment_plan_id: string
    contacts: { full_name: string; email: string | null; phone: string | null } | null
    payment_plans: { name: string; financing_provider: string | null } | null
  } | null
}

type TabKey = 'vencidas' | 'este_mes' | 'proximas' | 'todas'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'vencidas', label: 'Vencidas' },
  { key: 'este_mes', label: 'Este mes' },
  { key: 'proximas', label: 'Próximas' },
  { key: 'todas', label: 'Todas' },
]

const todayStr = () => new Date().toISOString().slice(0, 10)

function isOverdue(row: InstallmentRow, today: string): boolean {
  if (row.status === 'overdue') return true
  if (row.status === 'pending' && row.due_date && row.due_date < today) return true
  return false
}

function StatusBadge({ row, today }: { row: InstallmentRow; today: string }) {
  if (row.flagged_delinquent) {
    return (
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
        MOROSO
      </span>
    )
  }
  if (isOverdue(row, today)) {
    return (
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">
        VENCIDA
      </span>
    )
  }
  if (row.status === 'collected') {
    return (
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
        COBRADA
      </span>
    )
  }
  if (row.status === 'cancelled') {
    return (
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted/50 text-muted-foreground border border-border/30">
        CANCELADA
      </span>
    )
  }
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
      PENDIENTE
    </span>
  )
}

export default function MorosidadPage() {
  const tenant = useTenant()
  const [rows, setRows] = useState<InstallmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('vencidas')
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const range = useMemo(
    () => getPeriodRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo]
  )

  const load = async () => {
    setLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('sale_expected_installments')
      .select('*, sales(id, gross_amount, contact_id, payment_plan_id, contacts(full_name, email, phone), payment_plans(name, financing_provider))')
      .order('due_date')
    if (error) {
      toast.error('Error al cargar cuotas', { description: error.message })
      setRows([])
    } else {
      setRows((data as unknown as InstallmentRow[]) || [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const today = todayStr()

  const filteredRows = useMemo(
    () => rows.filter((r) => inPeriod(r.due_date, range)),
    [rows, range]
  )

  const { overdueRows, thisMonthRows, upcomingRows, kpis } = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)

    const overdue = filteredRows.filter((r) => isOverdue(r, today))
    const thisMonth = filteredRows.filter(
      (r) => r.status === 'pending' && r.due_date && r.due_date >= monthStart && r.due_date <= monthEnd
    )
    const upcoming = filteredRows.filter(
      (r) => r.status === 'pending' && r.due_date && r.due_date > monthEnd
    )
    const overdueAmount = overdue.reduce((sum, r) => sum + (r.expected_gross_amount || 0), 0)
    const flaggedCount = filteredRows.filter((r) => r.flagged_delinquent).length

    return {
      overdueRows: overdue,
      thisMonthRows: thisMonth,
      upcomingRows: upcoming,
      kpis: {
        overdueCount: overdue.length,
        overdueAmount,
        thisMonthCount: thisMonth.length,
        flaggedCount,
      },
    }
  }, [filteredRows, today])

  const visibleRows = useMemo(() => {
    let base: InstallmentRow[]
    switch (tab) {
      case 'vencidas': base = overdueRows; break
      case 'este_mes': base = thisMonthRows; break
      case 'proximas': base = upcomingRows; break
      case 'todas':
      default: base = filteredRows
    }
    const nq = normalizeText(q.trim())
    if (!nq) return base
    return base.filter((r) => {
      const c = r.sales?.contacts
      return normalizeText(c?.full_name || '').includes(nq) || normalizeText(c?.email || '').includes(nq) || phoneMatches(c?.phone, q)
    })
  }, [tab, overdueRows, thisMonthRows, upcomingRows, filteredRows, q])

  const applyAction = async (installmentId: string, action: 'paid' | 'delinquent' | 'unflag') => {
    setBusyId(installmentId)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/payments/mark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installmentId, action }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        toast.error('No se pudo actualizar la cuota', { description: data.error })
        return
      }
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== installmentId) return r
          if (action === 'paid') return { ...r, status: 'collected', flagged_delinquent: false }
          if (action === 'delinquent') return { ...r, status: 'overdue', flagged_delinquent: true }
          return { ...r, status: 'pending', flagged_delinquent: false }
        })
      )
      const messages = {
        paid: 'Cuota marcada como pagada',
        delinquent: 'Cuota marcada como morosa',
        unflag: 'Marca retirada',
      }
      toast.success(messages[action])
    } catch (err) {
      toast.error('Error de red', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-brand-400" /> Morosidad
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Control de pagos a plazos y financiados</p>
      </div>

      <PeriodFilterBar
        preset={periodPreset}
        onPresetChange={setPeriodPreset}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        onClear={() => { setPeriodPreset('all'); setCustomFrom(''); setCustomTo('') }}
        hasActiveFilters={periodPreset !== 'all'}
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-card rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Cuotas vencidas</p>
              <p className="text-2xl font-bold text-orange-400 mt-1">{kpis.overdueCount}</p>
            </div>
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Importe vencido</p>
              <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(kpis.overdueAmount)}</p>
            </div>
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">A cobrar este mes</p>
              <p className="text-2xl font-bold text-brand-400 mt-1">{kpis.thisMonthCount}</p>
            </div>
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Marcadas morosas</p>
              <p className="text-2xl font-bold text-red-400 mt-1">{kpis.flaggedCount}</p>
            </div>
          </div>

          <div className="flex justify-end">
            <SearchBox value={q} onChange={setQ} placeholder="Buscar por alumno, email o teléfono..." />
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
                  ({t.key === 'vencidas' ? overdueRows.length : t.key === 'este_mes' ? thisMonthRows.length : t.key === 'proximas' ? upcomingRows.length : filteredRows.length})
                </span>
              </button>
            ))}
          </div>

          {visibleRows.length === 0 ? (
            <div className="bg-card/50 border border-border rounded-lg p-10 text-center">
              <p className="text-muted-foreground text-sm">Sin cuotas registradas</p>
            </div>
          ) : (
            <div className="bg-card/50 border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">Alumno</th>
                    <th className="px-4 py-3 font-medium">Contacto</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium">Nº cuota</th>
                    <th className="px-4 py-3 font-medium">Vencimiento</th>
                    <th className="px-4 py-3 font-medium">Importe</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const contact = row.sales?.contacts
                    const plan = row.sales?.payment_plans
                    const overdueFlag = isOverdue(row, today)
                    const isBusy = busyId === row.id
                    return (
                      <tr key={row.id} className="border-b border-border/70 last:border-0 hover:bg-card/70">
                        <td className="px-4 py-3">
                          <p className="text-foreground">{contact?.full_name || '—'}</p>
                          {row.sale_id && (
                            <Link
                              href={`/${tenant}/sales/${row.sale_id}`}
                              className="text-xs text-brand-400 hover:text-brand-300 inline-flex items-center gap-1 mt-0.5"
                            >
                              Ver venta <ExternalLink className="w-3 h-3" />
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {contact?.email && <p>{contact.email}</p>}
                          {contact?.phone && <p>{contact.phone}</p>}
                          {!contact?.email && !contact?.phone && '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          <p>{plan?.name || '—'}</p>
                          {plan?.financing_provider && (
                            <p className="text-muted-foreground">{plan.financing_provider}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {row.is_monitoring ? '—' : row.installment_number}
                          {row.is_monitoring && (
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30" title="Cuota del alumno con la financiera (Sequra). Solo control de impago; no es cash nuestro.">
                              monitor. Sequra
                            </span>
                          )}
                        </td>
                        <td className={`px-4 py-3 ${overdueFlag ? 'text-orange-400' : 'text-foreground'}`}>
                          {formatDate(row.due_date)}
                        </td>
                        <td className="px-4 py-3 text-foreground font-medium">
                          {formatCurrency(row.expected_gross_amount)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge row={row} today={today} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {row.status !== 'collected' && (
                              <button
                                disabled={isBusy}
                                onClick={() => applyAction(row.id, 'paid')}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 hover:bg-emerald-600/30 disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-3 h-3" /> Marcar pagada
                              </button>
                            )}
                            {!row.flagged_delinquent && row.status !== 'collected' && (
                              <button
                                disabled={isBusy}
                                onClick={() => applyAction(row.id, 'delinquent')}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/30 disabled:opacity-50"
                              >
                                <Flag className="w-3 h-3" /> Marcar moroso
                              </button>
                            )}
                            {(row.flagged_delinquent || overdueFlag) && (
                              <button
                                disabled={isBusy}
                                onClick={() => applyAction(row.id, 'unflag')}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted text-muted-foreground border border-border hover:bg-muted disabled:opacity-50"
                              >
                                <FlagOff className="w-3 h-3" /> Quitar marca
                              </button>
                            )}
                          </div>
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
