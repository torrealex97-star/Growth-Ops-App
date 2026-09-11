'use client'

import { useEffect, useMemo, useState } from 'react'
import { Scale, Loader2, RefreshCw, Download, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/lib/tenant-context'
import { formatCurrency, formatDate, cn } from '@/lib/utils'

type Platform = 'stripe' | 'sequra' | 'transferencia' | 'bizum' | 'paypal' | 'otro'
type Status = 'conciliado' | 'descuadre' | 'pendiente'

type Row = {
  id: string
  platform: Platform
  date: string | null
  amount: number
  customer: string | null
  email: string | null
  saleId: string | null
  collectionId: string | null
  internalAmount: number | null
  status: Status
  detail: string
}

const PLATFORM_LABELS: Record<Platform, string> = {
  stripe: 'Stripe',
  sequra: 'seQura',
  transferencia: 'Transferencia',
  bizum: 'Bizum',
  paypal: 'PayPal',
  otro: 'Otro',
}

const STATUS_LABELS: Record<Status, string> = {
  conciliado: 'Conciliado',
  descuadre: 'Descuadre',
  pendiente: 'Pendiente',
}

const STATUS_STYLES: Record<Status, string> = {
  conciliado: 'text-emerald-600',
  descuadre: 'text-red-500',
  pendiente: 'text-amber-500',
}

const MANUAL_PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'bizum', label: 'Bizum' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'otro', label: 'Otro' },
]

function csvEscape(value: string): string {
  const needsQuotes = /[",\n;]/.test(value)
  const escaped = value.replace(/"/g, '""')
  return needsQuotes ? `"${escaped}"` : escaped
}

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows.map((row) => row.map(csvEscape).join(';')).join('\n')
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function ConciliacionPage() {
  const tenant = useTenant()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [reloading, setReloading] = useState(false)
  const [platformFilter, setPlatformFilter] = useState<Platform | 'todas'>('todas')
  const [statusFilter, setStatusFilter] = useState<Status | 'todos'>('todos')
  const [formOpen, setFormOpen] = useState(false)
  const [formPlatform, setFormPlatform] = useState<Platform>('transferencia')
  const [formReference, setFormReference] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = async (isReload = false) => {
    if (isReload) setReloading(true)
    else setLoading(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/finanzas/conciliacion`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error('No se pudo cargar la conciliación', { description: data.error })
        return
      }
      setRows(data.rows || [])
    } finally {
      setLoading(false)
      setReloading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (platformFilter !== 'todas' && r.platform !== platformFilter) return false
      if (statusFilter !== 'todos' && r.status !== statusFilter) return false
      return true
    })
  }, [rows, platformFilter, statusFilter])

  const summary = useMemo(() => {
    return {
      total: rows.length,
      conciliado: rows.filter((r) => r.status === 'conciliado').length,
      descuadre: rows.filter((r) => r.status === 'descuadre').length,
      pendiente: rows.filter((r) => r.status === 'pendiente').length,
    }
  }, [rows])

  const exportCsv = () => {
    const header = ['Plataforma', 'Fecha', 'Importe', 'Cliente', 'Email', 'Importe interno', 'Estado', 'Detalle']
    const body = filteredRows.map((r) => [
      PLATFORM_LABELS[r.platform],
      r.date ? formatDate(r.date) : '',
      r.amount.toFixed(2),
      r.customer || '',
      r.email || '',
      r.internalAmount == null ? '' : r.internalAmount.toFixed(2),
      STATUS_LABELS[r.status],
      r.detail,
    ])
    downloadCsv(`conciliacion_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body])
  }

  const submitManualRecord = async () => {
    if (!formAmount || !formDate) {
      toast.error('Importe y fecha son obligatorios')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/finanzas/conciliacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: formPlatform,
          reference: formReference || null,
          amount: Number(formAmount),
          transacted_at: formDate,
          notes: formNotes || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error('No se pudo guardar el registro', { description: data.error })
        return
      }
      toast.success('Registro de plataforma añadido')
      setFormOpen(false)
      setFormReference('')
      setFormAmount('')
      setFormDate('')
      setFormNotes('')
      await load(true)
    } finally {
      setSubmitting(false)
    }
  }

  const fmt = (n: number) => formatCurrency(n)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
            <Scale className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Conciliación</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Cruza cobros y devoluciones con Stripe, seQura y extractos cargados manualmente
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground hover:border-brand-500"
          >
            <Plus className="w-4 h-4" /> Cargar transferencia
          </button>
          <button
            onClick={() => load(true)}
            disabled={reloading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-brand-600/20 text-brand-400 border border-brand-600/30 hover:bg-brand-600/30 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-4 h-4', reloading && 'animate-spin')} /> {reloading ? 'Cotejando…' : 'Cotejar ahora'}
          </button>
        </div>
      </div>

      {formOpen && (
        <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Registro manual de transferencia / Bizum / PayPal</p>
            <button onClick={() => setFormOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <select
              value={formPlatform}
              onChange={(e) => setFormPlatform(e.target.value as Platform)}
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
            >
              {MANUAL_PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <input
              type="number" step="0.01" placeholder="Importe"
              value={formAmount} onChange={(e) => setFormAmount(e.target.value)}
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
            />
            <input
              type="date"
              value={formDate} onChange={(e) => setFormDate(e.target.value)}
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
            />
            <input
              type="text" placeholder="Referencia (opcional)"
              value={formReference} onChange={(e) => setFormReference(e.target.value)}
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
            />
            <input
              type="text" placeholder="Notas (opcional)"
              value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={submitManualRecord}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Guardar registro
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Cargando conciliación…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-xl font-bold text-foreground">{summary.total}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">Conciliados</p>
              <p className="text-xl font-bold text-emerald-500">{summary.conciliado}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">Descuadres</p>
              <p className="text-xl font-bold text-red-500">{summary.descuadre}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">Pendientes</p>
              <p className="text-xl font-bold text-amber-500">{summary.pendiente}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value as Platform | 'todas')}
              className="bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground"
            >
              <option value="todas">Todas las plataformas</option>
              {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
                <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as Status | 'todos')}
              className="bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground"
            >
              <option value="todos">Todos los estados</option>
              {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
            <button
              onClick={exportCsv}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-muted border border-border text-foreground hover:border-brand-500"
            >
              <Download className="w-3.5 h-3.5" /> Exportar CSV
            </button>
          </div>

          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium">Plataforma</th>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Importe</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Interno</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-sm">Sin resultados para este filtro</td></tr>
                ) : filteredRows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-card/50">
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">{PLATFORM_LABELS[r.platform]}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r.date ? formatDate(r.date) : '—'}</td>
                    <td className="px-4 py-3 text-foreground font-medium whitespace-nowrap">{fmt(r.amount)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.customer || r.email || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r.internalAmount == null ? '—' : fmt(r.internalAmount)}</td>
                    <td className={cn('px-4 py-3 font-medium', STATUS_STYLES[r.status])}>{STATUS_LABELS[r.status]}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
