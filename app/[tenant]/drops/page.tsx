'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { activeUserNamesQuery } from '@/lib/users'
import { UserMinus, Plus, X, Download } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchBox, normalizeText } from '@/components/ui/search-box'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getCustomDateRange } from '@/lib/filters/period'
import { getPeriodRange, PERIOD_LABELS, PERIOD_PRESETS_STANDARD, type PeriodPreset } from '@/lib/filters/period'
import { useSesion } from '@/lib/tenant-context'

function csvEscape(value: string): string {
  if (value == null) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const lines = [headers, ...rows].map((r) => r.map((c) => csvEscape(String(c))).join(','))
  const csv = '﻿' + lines.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const REASONS = [
  { value: 'impago', label: 'Impago' },
  { value: 'no_ve_valor', label: 'No ve valor' },
  { value: 'cambio_circunstancias', label: 'Cambio de circunstancias' },
  { value: 'competencia', label: 'Competencia' },
  { value: 'mala_experiencia', label: 'Mala experiencia' },
  { value: 'otro', label: 'Otro' },
] as const

const TYPES = [
  { value: 'voluntaria', label: 'Voluntaria' },
  { value: 'impago', label: 'Impago' },
  { value: 'refund', label: 'Refund' },
  { value: 'pausa', label: 'Pausa' },
] as const

const RESULTS = [
  { value: 'perdida', label: 'Perdida' },
  { value: 'recuperada', label: 'Recuperada' },
  { value: 'en_proceso', label: 'En proceso' },
  { value: 'pausada', label: 'Pausada' },
] as const

function reasonLabel(v: string | null) {
  return REASONS.find((r) => r.value === v)?.label || v || '—'
}
function typeLabel(v: string | null) {
  return TYPES.find((t) => t.value === v)?.label || v || '—'
}
function resultBadgeClass(v: string) {
  switch (v) {
    case 'recuperada':
      return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    case 'en_proceso':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'pausada':
      return 'bg-sky-500/20 text-sky-400 border-sky-500/30'
    default:
      return 'bg-red-500/20 text-red-400 border-red-500/30'
  }
}

type Contact = { id: string; full_name: string }
type DbUser = { id: string; full_name: string }
type DropRow = {
  id: string
  sale_id: string | null
  contact_id: string
  request_date: string | null
  effective_date: string | null
  reason: string | null
  reason_detail: string | null
  type: string
  handled_by: string | null
  retention_action: string | null
  result: string
  refund_amount: number
  notes: string | null
  created_at: string
  contacts?: { full_name: string } | null
  handler?: { full_name: string } | null
}

export default function DropsPage() {
  const sesion = useSesion()
  const [items, setItems] = useState<DropRow[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [users, setUsers] = useState<DbUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [nd, setNd] = useState({
    contact_id: '',
    reason: 'impago',
    type: 'voluntaria',
    request_date: '',
    retention_action: '',
    result: 'perdida',
    refund_amount: '',
    notes: '',
  })

  // Periodo
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [q, setQ] = useState('')

  const load = async () => {
    const supabase = createClient()
    const [dRes, cRes, uRes] = await Promise.all([
      supabase
        .from('drops')
        .select('*, contacts(full_name), handler:handled_by(full_name)')
        .order('created_at', { ascending: false }),
      supabase.from('contacts').select('id, full_name').order('full_name').limit(300),
      activeUserNamesQuery(supabase),
    ])
    setItems((dRes.data as DropRow[]) || [])
    setContacts((cRes.data as Contact[]) || [])
    setUsers((uRes.data as DbUser[]) || [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const periodRange = useMemo(
    () => getPeriodRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo]
  )

  const filteredItems = useMemo(() => {
    return items.filter((d) => {
      if (periodPreset !== 'all') {
        const dateSrc = d.request_date || d.created_at
        const relevant = dateSrc ? new Date(dateSrc) : null
        if (!relevant) return false
        if (periodRange.from && relevant < periodRange.from) return false
        if (periodRange.to && relevant > periodRange.to) return false
      }
      return true
    })
  }, [items, periodPreset, periodRange])

  const visibleItems = useMemo(() => {
    const nq = normalizeText(q.trim())
    if (!nq) return filteredItems
    return filteredItems.filter(
      (d) =>
        normalizeText(d.contacts?.full_name || '').includes(nq) ||
        normalizeText(d.handler?.full_name || '').includes(nq) ||
        normalizeText(d.notes || '').includes(nq)
    )
  }, [filteredItems, q])

  const periodFileTag = useMemo(() => {
    if (periodPreset === 'all') return 'todas'
    if (periodPreset === 'custom') {
      return `${customFrom || 'inicio'}_a_${customTo || 'fin'}`
    }
    return periodPreset
  }, [periodPreset, customFrom, customTo])

  const handleExportCSV = () => {
    const headers = ['Alumno', 'Motivo', 'Tipo', 'Fecha solicitud', 'Resultado', 'Refund']
    const rows = filteredItems.map((d) => [
      d.contacts?.full_name ?? '',
      reasonLabel(d.reason),
      typeLabel(d.type),
      d.request_date ? new Date(d.request_date).toLocaleDateString('es-ES') : '',
      d.result,
      d.refund_amount,
    ])
    downloadCSV(`cancelaciones_${periodFileTag}.csv`, headers, rows)
  }

  const kpis = useMemo(() => {
    const now = new Date()
    const thisMonth = filteredItems.filter((d) => {
      if (!d.request_date) return false
      const rd = new Date(d.request_date)
      return rd.getFullYear() === now.getFullYear() && rd.getMonth() === now.getMonth()
    }).length

    const total = filteredItems.length
    const recuperadas = filteredItems.filter((d) => d.result === 'recuperada').length
    const recoveryRate = total > 0 ? (recuperadas / total) * 100 : 0

    const totalRefunds = filteredItems.reduce((sum, d) => sum + (d.refund_amount || 0), 0)

    const byReason: Record<string, number> = {}
    for (const d of filteredItems) {
      const key = d.reason || 'otro'
      byReason[key] = (byReason[key] || 0) + 1
    }

    return { thisMonth, recoveryRate, totalRefunds, byReason }
  }, [filteredItems])

  const updateResult = async (id: string, result: string) => {
    setItems((prev) => prev.map((d) => (d.id === id ? { ...d, result } : d)))
    const supabase = createClient()
    const { error } = await supabase.from('drops').update({ result }).eq('id', id)
    if (error) toast.error('No se pudo actualizar el resultado')
  }

  const create = async () => {
    if (!nd.contact_id) {
      toast.error('Selecciona un alumno')
      return
    }
    const supabase = createClient()
    const { error } = await supabase.from('drops').insert({
      contact_id: nd.contact_id,
      reason: nd.reason,
      type: nd.type,
      request_date: nd.request_date || null,
      retention_action: nd.retention_action || null,
      result: nd.result,
      refund_amount: nd.refund_amount ? Number(nd.refund_amount) : 0,
      notes: nd.notes || null,
      created_by: sesion?.userId ?? null,
    })
    if (error) {
      toast.error('Error al crear', { description: error.message })
      return
    }
    toast.success('Cancelación registrada')
    setShowNew(false)
    setNd({
      contact_id: '',
      reason: 'impago',
      type: 'voluntaria',
      request_date: '',
      retention_action: '',
      result: 'perdida',
      refund_amount: '',
      notes: '',
    })
    load()
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <UserMinus className="w-6 h-6 text-brand-400" /> Cancelaciones
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Bajas, motivos, retención y churn</p>
        </div>
        <div className="flex items-center gap-3">
          <SearchBox value={q} onChange={setQ} placeholder="Buscar alumno..." className="w-64" />
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-brand-600 text-white hover:bg-brand-500 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> Nueva cancelación
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Filtros</span>
          <div className="flex items-center gap-2">
            {periodPreset !== 'all' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setPeriodPreset('all')
                  setCustomFrom('')
                  setCustomTo('')
                }}
              >
                <X className="w-3.5 h-3.5 mr-1" />
                Limpiar filtros
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExportCSV}>
              <Download className="w-3.5 h-3.5 mr-1" />
              Exportar CSV
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Periodo</Label>
            <Select value={periodPreset} onValueChange={(v) => setPeriodPreset(v as PeriodPreset)}>
              <SelectTrigger className="bg-muted border-border h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {PERIOD_PRESETS_STANDARD.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PERIOD_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {periodPreset === 'custom' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Periodo desde</Label>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={cls} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Periodo hasta</Label>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={cls} />
              </div>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="h-64 bg-card rounded-lg animate-pulse" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Bajas este mes</p>
              <p className="text-2xl font-bold text-foreground mt-1">{kpis.thisMonth}</p>
            </div>
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Tasa de recuperación</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">{kpis.recoveryRate.toFixed(1)}%</p>
            </div>
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Total refunds</p>
              <p className="text-2xl font-bold text-red-400 mt-1">{formatCurrency(kpis.totalRefunds)}</p>
            </div>
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Desglose por motivo</p>
              <div className="space-y-0.5">
                {REASONS.map((r) =>
                  kpis.byReason[r.value] ? (
                    <div key={r.value} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className="text-foreground font-medium">{kpis.byReason[r.value]}</span>
                    </div>
                  ) : null
                )}
                {Object.keys(kpis.byReason).length === 0 && <p className="text-xs text-muted-foreground">—</p>}
              </div>
            </div>
          </div>

          <div className="bg-card/50 border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-card text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Alumno</th>
                  <th className="text-left px-4 py-3">Motivo</th>
                  <th className="text-left px-4 py-3">Tipo</th>
                  <th className="text-left px-4 py-3">Fecha solicitud</th>
                  <th className="text-left px-4 py-3">Resultado</th>
                  <th className="text-left px-4 py-3">Refund</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((d) => (
                  <tr key={d.id} className="border-t border-border hover:bg-card/60">
                    <td className="px-4 py-3 text-foreground">{d.contacts?.full_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 rounded bg-muted text-foreground border border-border">
                        {reasonLabel(d.reason)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{typeLabel(d.type)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(d.request_date)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={d.result}
                        onChange={(e) => updateResult(d.id, e.target.value)}
                        className={`text-xs rounded border px-2 py-1 bg-transparent ${resultBadgeClass(d.result)}`}
                      >
                        {RESULTS.map((r) => (
                          <option key={r.value} value={r.value} className="bg-card text-foreground">
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-foreground">{formatCurrency(d.refund_amount)}</td>
                  </tr>
                ))}
                {visibleItems.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground text-sm">
                      No hay cancelaciones registradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowNew(false)}
        >
          <div
            className="bg-card border border-border rounded-xl p-5 w-full max-w-md space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">Nueva cancelación</h3>
              <button onClick={() => setShowNew(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <select
              value={nd.contact_id}
              onChange={(e) => setNd({ ...nd, contact_id: e.target.value })}
              className={cls}
            >
              <option value="">— alumno —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <select value={nd.reason} onChange={(e) => setNd({ ...nd, reason: e.target.value })} className={cls}>
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <select value={nd.type} onChange={(e) => setNd({ ...nd, type: e.target.value })} className={cls}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="date"
                value={nd.request_date}
                onChange={(e) => setNd({ ...nd, request_date: e.target.value })}
                className={cls}
              />
              <select value={nd.result} onChange={(e) => setNd({ ...nd, result: e.target.value })} className={cls}>
                {RESULTS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={nd.retention_action}
              onChange={(e) => setNd({ ...nd, retention_action: e.target.value })}
              placeholder="Acción de retención"
              className={cls}
            />
            <input
              type="number"
              step="0.01"
              value={nd.refund_amount}
              onChange={(e) => setNd({ ...nd, refund_amount: e.target.value })}
              placeholder="Importe refund (€)"
              className={cls}
            />
            <textarea
              value={nd.notes}
              onChange={(e) => setNd({ ...nd, notes: e.target.value })}
              rows={2}
              placeholder="Notas"
              className={cls}
            />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowNew(false)} className="px-3 py-2 text-sm text-muted-foreground">
                Cancelar
              </button>
              <button onClick={create} className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg">
                Crear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const cls =
  'w-full bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-500'
