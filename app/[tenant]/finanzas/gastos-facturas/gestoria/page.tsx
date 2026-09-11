'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Receipt, ExternalLink, Download } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { lastNMonths, monthLabel } from '@/lib/analytics'
import { computeMonthlyPnl, type PnlSaleRow, type PnlCommissionRow } from '@/lib/finance/pnl'

type CollectionRow = {
  id: string
  sale_id: string
  gross_amount: number | string
  processing_fee: number | string | null
  vat: number | string | null
  collected_at: string | null
  status: string
}
type ExpenseRow = {
  id: string
  concept: string
  category: string
  amount: number | string
  expense_date: string | null
  counterparty: string | null
  invoice_url: string | null
}
type RefundRow = {
  gross_refund_amount: number | string
  refund_date: string | null
}

const num = (x: number | string | null | undefined) => Number(x ?? 0)
const ymOf = (d: string | null | undefined) => (d ? String(d).slice(0, 7) : '')

function nowYm() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const CATEGORY_LABELS: Record<string, string> = {
  publicidad: 'Publicidad',
  sueldos: 'Sueldos',
  comisiones: 'Comisiones',
  herramientas: 'Herramientas',
  eventos: 'Eventos',
  cogs: 'COGS',
  impuestos: 'Impuestos',
  otros: 'Otros',
}

function MetricCard({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string
  value: string
  sublabel?: string
  tone?: 'positive' | 'negative' | 'neutral'
}) {
  const valueColor = tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-red-400' : 'text-foreground'
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${valueColor}`}>{value}</p>
      {sublabel && <p className="text-[11px] text-muted-foreground mt-1">{sublabel}</p>}
    </div>
  )
}

// --- Utilidades CSV ---
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

export default function GestoriaPage() {
  const [loading, setLoading] = useState(true)
  const [ym, setYm] = useState(nowYm())
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [refunds, setRefunds] = useState<RefundRow[]>([])
  const [sales, setSales] = useState<PnlSaleRow[]>([])
  const [commissions, setCommissions] = useState<PnlCommissionRow[]>([])

  const monthOptions = useMemo(() => lastNMonths(12, nowYm()).reverse(), [])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      const supabase = createClient()
      const [collRes, expensesRes, refundsRes, salesRes, commissionsRes] = await Promise.all([
        supabase.from('collections').select('id, sale_id, gross_amount, processing_fee, vat, collected_at, status'),
        supabase.from('expenses').select('id, concept, category, amount, expense_date, counterparty, invoice_url'),
        supabase.from('refunds').select('gross_refund_amount, refund_date'),
        supabase.from('sales').select('gross_amount, discount, sale_date'),
        supabase.from('commissions').select('commission_amount, direction, collection_id, liquidation_month'),
      ])
      if (!mounted) return
      setCollections(collRes.data || [])
      setExpenses(expensesRes.data || [])
      setRefunds(refundsRes.data || [])
      setSales(salesRes.data || [])
      setCommissions(commissionsRes.data || [])
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const monthCollections = useMemo(
    () => collections.filter((c) => c.status === 'collected' && ymOf(c.collected_at) === ym),
    [collections, ym]
  )
  const monthExpenses = useMemo(() => expenses.filter((e) => ymOf(e.expense_date) === ym), [expenses, ym])
  const monthRefunds = useMemo(() => refunds.filter((r) => ymOf(r.refund_date) === ym), [refunds, ym])
  const monthInvoices = useMemo(() => monthExpenses.filter((e) => !!e.invoice_url), [monthExpenses])

  // Resultado neto/margen: mismo servicio compartido que Analítica financiera › Resumen y el
  // I&G de Dirección › Métricas (lib/finance/pnl.ts) — no se recalcula aquí, solo se lee.
  const summary = useMemo(() => {
    const cashCollected = monthCollections.reduce((a, c) => a + num(c.gross_amount), 0)
    const platformFees = monthCollections.reduce((a, c) => a + num(c.processing_fee), 0)
    const vat = monthCollections.reduce((a, c) => a + num(c.vat), 0)
    const totalExpenses = monthExpenses.reduce((a, e) => a + num(e.amount), 0)
    const totalRefunds = monthRefunds.reduce((a, r) => a + num(r.gross_refund_amount), 0)
    const pnl = computeMonthlyPnl(ym, { sales, collections, refunds, expenses, commissions })
    const netResult = pnl.preTaxProfit
    const margin = pnl.preTaxMargin === null ? null : pnl.preTaxMargin * 100
    return { cashCollected, platformFees, vat, totalExpenses, totalRefunds, netResult, margin }
  }, [monthCollections, monthExpenses, monthRefunds, ym, sales, collections, refunds, expenses, commissions])

  const fmt = (n: number) => formatCurrency(n)
  const pct = (v: number | null) => (v === null || !isFinite(v) ? '—' : `${v.toFixed(1)}%`)

  const exportSummaryCsv = () => {
    const rows: string[][] = [
      ['Concepto', 'Importe'],
      ['Mes', monthLabel(ym)],
      ['Facturación / Cash Collected', summary.cashCollected.toFixed(2)],
      ['Devoluciones', (-summary.totalRefunds).toFixed(2)],
      ['Gastos totales', (-summary.totalExpenses).toFixed(2)],
      ['Comisiones de plataforma', (-summary.platformFees).toFixed(2)],
      ['IVA repercutido (informativo)', summary.vat.toFixed(2)],
      ['Resultado neto', summary.netResult.toFixed(2)],
      ['Margen (%)', summary.margin === null ? '—' : summary.margin.toFixed(1)],
    ]
    downloadCsv(`ig_${ym}.csv`, rows)
  }

  const exportInvoicesCsv = () => {
    const rows: string[][] = [
      ['Concepto', 'Proveedor', 'Categoria', 'Importe', 'Fecha', 'Enlace factura'],
      ...monthInvoices.map((e) => [
        e.concept || '',
        e.counterparty || '',
        CATEGORY_LABELS[e.category] || e.category,
        num(e.amount).toFixed(2),
        e.expense_date || '',
        e.invoice_url || '',
      ]),
    ]
    downloadCsv(`facturas_${ym}.csv`, rows)
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
            <Receipt className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Gestoría</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Resumen mensual de ingresos, gastos y facturas — listo para exportar
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
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 bg-card rounded-lg animate-pulse" />
            ))}
          </div>
          <div className="h-64 bg-card rounded-lg animate-pulse" />
        </div>
      ) : (
        <>
          {/* Resumen I&G del mes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
                Resumen I&amp;G — {monthLabel(ym)}
              </h2>
              <button
                onClick={exportSummaryCsv}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-muted border border-border text-foreground hover:border-brand-500"
              >
                <Download className="w-3.5 h-3.5 text-brand-400" /> Exportar CSV
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
              <MetricCard label="Facturación / Cash Collected" value={fmt(summary.cashCollected)} />
              <MetricCard
                label="Devoluciones"
                value={`− ${fmt(summary.totalRefunds)}`}
                tone={summary.totalRefunds > 0 ? 'negative' : 'neutral'}
              />
              <MetricCard
                label="Gastos totales"
                value={`− ${fmt(summary.totalExpenses)}`}
                tone={summary.totalExpenses > 0 ? 'negative' : 'neutral'}
              />
              <MetricCard
                label="Comisiones de plataforma"
                value={`− ${fmt(summary.platformFees)}`}
                tone={summary.platformFees > 0 ? 'negative' : 'neutral'}
              />
              <MetricCard label="IVA" value={fmt(summary.vat)} sublabel="repercutido en cobros" />
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground mb-1">Resultado neto</p>
                <p
                  className={`text-xl font-bold tabular-nums ${
                    summary.netResult >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {fmt(summary.netResult)}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">margen {pct(summary.margin)}</p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Resultado neto = mismo cálculo que I&amp;G (Dirección › Métricas): Net Revenue − COGS − OpEx
            </p>
          </div>

          {/* Facturas del mes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
                Facturas del mes — {monthLabel(ym)}
              </h2>
              <button
                onClick={exportInvoicesCsv}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-muted border border-border text-foreground hover:border-brand-500"
              >
                <Download className="w-3.5 h-3.5 text-brand-400" /> Exportar CSV
              </button>
            </div>
            <div className="bg-card/50 border border-border rounded-lg overflow-hidden">
              {monthInvoices.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No hay facturas registradas para este mes
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="px-4 py-3 font-medium">Concepto</th>
                      <th className="px-4 py-3 font-medium">Proveedor</th>
                      <th className="px-4 py-3 font-medium">Categoría</th>
                      <th className="px-4 py-3 font-medium">Importe</th>
                      <th className="px-4 py-3 font-medium">Fecha</th>
                      <th className="px-4 py-3 font-medium">Factura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthInvoices.map((e) => (
                      <tr key={e.id} className="border-b border-border/50 hover:bg-card/50">
                        <td className="px-4 py-3 text-foreground">{e.concept}</td>
                        <td className="px-4 py-3 text-muted-foreground">{e.counterparty || '—'}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2 py-1 rounded bg-muted text-foreground">
                            {CATEGORY_LABELS[e.category] || e.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-foreground font-medium">{fmt(num(e.amount))}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(e.expense_date)}</td>
                        <td className="px-4 py-3">
                          {e.invoice_url ? (
                            <a
                              href={e.invoice_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-brand-400 hover:text-brand-300 inline-flex items-center gap-1"
                            >
                              Ver/Descargar <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
