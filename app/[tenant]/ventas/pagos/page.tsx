'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { KPICard } from '@/components/os/DashboardKPICard'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Wallet, TrendingUp, AlertTriangle, Clock, Download, User as UserIcon, MessageSquare } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import { SearchBox, normalizeText, phoneMatches } from '@/components/ui/search-box'
import type { SaleWithRelations, Collection, SaleExpectedInstallment } from '@/lib/types/database'
import { useTenant, useTenantId } from '@/lib/tenant-context'
import { getCustomDateRange } from '@/lib/filters/period'
import { getPeriodRange, PERIOD_LABELS, PERIOD_PRESETS_STANDARD, type PeriodPreset } from '@/lib/filters/period'

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

type PipelineStage = 'reserva_abierta' | 'con_impago' | 'en_curso' | 'completado'

const STAGE_LABELS: Record<PipelineStage, string> = {
  reserva_abierta: 'Reserva abierta',
  con_impago: 'Con impago',
  en_curso: 'En curso',
  completado: 'Completado',
}

const STAGE_COLORS: Record<PipelineStage, string> = {
  reserva_abierta: 'border-amber-500/30 bg-amber-500/5',
  con_impago: 'border-red-500/30 bg-red-500/5',
  en_curso: 'border-blue-500/30 bg-blue-500/5',
  completado: 'border-emerald-500/30 bg-emerald-500/5',
}

const STAGE_DOT: Record<PipelineStage, string> = {
  reserva_abierta: 'bg-amber-400',
  con_impago: 'bg-red-400',
  en_curso: 'bg-blue-400',
  completado: 'bg-emerald-400',
}

type SaleAggregate = {
  sale: SaleWithRelations
  cashCollected: number
  pendingAmount: number
  nextDueDate: string | null
  hasOverdue: boolean
  hasPending: boolean
  stage: PipelineStage
}

export default function PaymentsPipelinePage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [sales, setSales] = useState<SaleWithRelations[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [installments, setInstallments] = useState<SaleExpectedInstallment[]>([])
  const [lastNoteBySale, setLastNoteBySale] = useState<Map<string, { note: string; created_at: string }>>(new Map())
  const [loading, setLoading] = useState(true)

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [q, setQ] = useState('')

  const [noteSale, setNoteSale] = useState<{ id: string; name: string } | null>(null)
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  const submitNote = async () => {
    if (!noteSale || !noteText.trim()) return
    setSavingNote(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/sales/${noteSale.id}/follow-ups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteText.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al guardar la nota')
      setLastNoteBySale((prev) => {
        const next = new Map(prev)
        next.set(noteSale.id, { note: data.followUp.note, created_at: data.followUp.created_at })
        return next
      })
      toast.success('Nota de seguimiento añadida')
      setNoteSale(null)
      setNoteText('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar la nota')
    } finally {
      setSavingNote(false)
    }
  }

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()

      const [salesRes, collectionsRes, installmentsRes] = await Promise.all([
        supabase
          .from('sales')
          .select(
            `*, contacts(*), products(*), payment_plans(*), setter:setter_id(id, full_name), closer:closer_id(id, full_name), affiliate:affiliate_id(id, full_name)`
          )
          .eq('tenant_id', tenantId)
          .order('sale_date', { ascending: false }),
        // Solo 'collected': igual que Finanzas › Resumen y el resto de pantallas de Cash Collected —
        // antes incluía también cobros 'reversed'/'disputed', lo que sobrestimaba el total aquí
        // respecto a las demás pantallas.
        supabase
          .from('collections')
          .select('sale_id, gross_amount')
          .eq('tenant_id', tenantId)
          .eq('status', 'collected'),
        supabase
          .from('sale_expected_installments')
          .select('sale_id, status, due_date, expected_gross_amount, is_monitoring')
          .eq('is_monitoring', false)
          .eq('tenant_id', tenantId),
      ])

      // Última nota de seguimiento por venta (para el indicador en la tarjeta del kanban).
      const { data: notesData } = await supabase
        .from('payment_follow_ups')
        .select('sale_id, note, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
      const notesMap = new Map<string, { note: string; created_at: string }>()
      for (const n of (notesData ?? []) as { sale_id: string; note: string; created_at: string }[]) {
        if (!notesMap.has(n.sale_id)) notesMap.set(n.sale_id, { note: n.note, created_at: n.created_at })
      }
      setLastNoteBySale(notesMap)

      if (salesRes.error) {
        toast.error('Error al cargar las ventas')
        setLoading(false)
        return
      }

      setSales((salesRes.data ?? []) as SaleWithRelations[])
      setCollections((collectionsRes.data ?? []) as Collection[])
      setInstallments((installmentsRes.data ?? []) as SaleExpectedInstallment[])

      setLoading(false)
    }

    fetchData()
  }, [tenantId])

  const periodRange = useMemo(
    () => getPeriodRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo]
  )

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      if (periodPreset === 'all') return true
      const saleDate = s.sale_date ? new Date(s.sale_date) : null
      if (!saleDate) return false
      if (periodRange.from && saleDate < periodRange.from) return false
      if (periodRange.to && saleDate > periodRange.to) return false
      return true
    })
  }, [sales, periodPreset, periodRange])

  // Maps por sale_id para evitar N+1
  const collectionsBySale = useMemo(() => {
    const map = new Map<string, number>()
    collections.forEach((c) => {
      map.set(c.sale_id, (map.get(c.sale_id) ?? 0) + c.gross_amount)
    })
    return map
  }, [collections])

  const installmentsBySale = useMemo(() => {
    const map = new Map<string, SaleExpectedInstallment[]>()
    installments.forEach((inst) => {
      const arr = map.get(inst.sale_id) ?? []
      arr.push(inst)
      map.set(inst.sale_id, arr)
    })
    return map
  }, [installments])

  const { activeSales, excludedCount, aggregates } = useMemo(() => {
    const active: SaleWithRelations[] = []
    let excluded = 0

    filteredSales.forEach((s) => {
      if (s.status === 'refunded' || s.status === 'cancelled') {
        excluded += 1
      } else {
        active.push(s)
      }
    })

    const aggs: SaleAggregate[] = active.map((sale) => {
      const cashCollected = collectionsBySale.get(sale.id) ?? 0
      const saleInstallments = installmentsBySale.get(sale.id) ?? []

      const overdueInstallments = saleInstallments.filter((i) => i.status === 'overdue')
      const pendingInstallments = saleInstallments.filter((i) => i.status === 'pending')

      const hasOverdue = overdueInstallments.length > 0
      const hasPending = pendingInstallments.length > 0

      const pendingAmount = Math.max(sale.gross_amount - cashCollected, 0)

      const isFullyCollected =
        cashCollected >= sale.gross_amount ||
        (saleInstallments.length > 0 && saleInstallments.every((i) => i.status === 'collected'))

      const isOpenReservation = sale.payment_plans?.method === 'reserva' && !sale.reservation_completed_at

      let stage: PipelineStage
      if (isOpenReservation) {
        stage = 'reserva_abierta'
      } else if (hasOverdue) {
        stage = 'con_impago'
      } else if (isFullyCollected) {
        stage = 'completado'
      } else if (hasPending) {
        stage = 'en_curso'
      } else {
        stage = 'completado'
      }

      const upcoming = [...overdueInstallments, ...pendingInstallments]
        .filter((i) => i.due_date)
        .sort((a, b) => new Date(a.due_date as string).getTime() - new Date(b.due_date as string).getTime())

      const nextDueDate = upcoming.length > 0 ? upcoming[0].due_date : null

      return {
        sale,
        cashCollected,
        pendingAmount,
        nextDueDate,
        hasOverdue,
        hasPending,
        stage,
      }
    })

    return { activeSales: active, excludedCount: excluded, aggregates: aggs }
  }, [filteredSales, collectionsBySale, installmentsBySale])

  const kpis = useMemo(() => {
    const totalFacturado = activeSales.reduce((sum, s) => sum + s.gross_amount, 0)
    const totalCashCollected = aggregates.reduce((sum, a) => sum + a.cashCollected, 0)
    const totalPendiente = Math.max(totalFacturado - totalCashCollected, 0)

    const saleIds = new Set(activeSales.map((s) => s.id))
    const totalEnMora = installments
      .filter((i) => i.status === 'overdue' && saleIds.has(i.sale_id))
      .reduce((sum, i) => sum + i.expected_gross_amount, 0)

    return { totalFacturado, totalCashCollected, totalPendiente, totalEnMora }
  }, [activeSales, aggregates, installments])

  const stages: PipelineStage[] = ['reserva_abierta', 'con_impago', 'en_curso', 'completado']

  const aggregatesByStage = useMemo(() => {
    const map: Record<PipelineStage, SaleAggregate[]> = {
      reserva_abierta: [],
      con_impago: [],
      en_curso: [],
      completado: [],
    }
    const nq = normalizeText(q.trim())
    const list = nq
      ? aggregates.filter((a) => {
          const c = a.sale.contacts as { full_name?: string; email?: string | null; phone?: string | null } | null
          return (
            normalizeText(c?.full_name || '').includes(nq) ||
            normalizeText(c?.email || '').includes(nq) ||
            phoneMatches(c?.phone, q)
          )
        })
      : aggregates
    list.forEach((a) => {
      map[a.stage].push(a)
    })
    return map
  }, [aggregates, q])

  const periodFileTag = useMemo(() => {
    if (periodPreset === 'all') return 'todas'
    if (periodPreset === 'custom') {
      return `${customFrom || 'inicio'}_a_${customTo || 'fin'}`
    }
    return periodPreset
  }, [periodPreset, customFrom, customTo])

  const handleExportCSV = () => {
    const headers = [
      'Contacto',
      'Producto',
      'Closer',
      'Facturado',
      'Cobrado',
      'Pendiente',
      'Estado',
      'Próximo vencimiento',
    ]
    const rows = aggregates.map((a) => [
      a.sale.contacts?.full_name ?? '',
      a.sale.products?.name ?? '',
      a.sale.closer?.full_name ?? '',
      a.sale.gross_amount,
      a.cashCollected,
      a.pendingAmount,
      STAGE_LABELS[a.stage],
      a.nextDueDate ? formatDate(a.nextDueDate) : '',
    ])
    downloadCSV(`pipeline_pagos_${periodFileTag}.csv`, headers, rows)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-brand-600/20 flex items-center justify-center">
          <Wallet className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Pipeline de pagos</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Estado de cobro de cada venta, de reserva a pago completado
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Filtros</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExportCSV}>
            <Download className="w-3.5 h-3.5 mr-1" />
            Exportar CSV
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-xs text-muted-foreground">Buscar cliente</Label>
            <SearchBox value={q} onChange={setQ} placeholder="Nombre, email o teléfono..." className="w-full" />
          </div>
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
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="bg-muted border-border h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Periodo hasta</Label>
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="bg-muted border-border h-9"
                />
              </div>
            </>
          )}
        </div>
        {excludedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {excludedCount} venta(s) canceladas/devueltas excluidas del pipeline.
          </p>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total facturado"
          value={formatCurrency(kpis.totalFacturado)}
          icon={TrendingUp}
          loading={loading}
          description={`${activeSales.length} ventas`}
        />
        <KPICard
          title="Cash collected"
          value={formatCurrency(kpis.totalCashCollected)}
          icon={Wallet}
          loading={loading}
        />
        <KPICard
          title="Pendiente de cobro"
          value={formatCurrency(kpis.totalPendiente)}
          icon={Clock}
          loading={loading}
        />
        <KPICard title="En mora" value={formatCurrency(kpis.totalEnMora)} icon={AlertTriangle} loading={loading} />
      </div>

      {/* Kanban */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-96 bg-card rounded-lg animate-pulse" />
          ))}
        </div>
      ) : aggregates.length === 0 ? (
        <div className="rounded-lg border border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">
          No hay ventas con pagos en el periodo seleccionado.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {stages.map((stage) => {
            const stageSales = aggregatesByStage[stage]
            return (
              <div key={stage} className={`rounded-lg border ${STAGE_COLORS[stage]} flex flex-col`}>
                <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${STAGE_DOT[stage]}`} />
                    <h3 className="text-sm font-semibold text-foreground">{STAGE_LABELS[stage]}</h3>
                  </div>
                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                    {stageSales.length}
                  </span>
                </div>
                <div className="p-3 space-y-3 flex-1 overflow-y-auto max-h-[70vh]">
                  {stageSales.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">Sin ventas en esta etapa</p>
                  ) : (
                    stageSales.map((a) => {
                      const pct =
                        a.sale.gross_amount > 0
                          ? Math.min(Math.round((a.cashCollected / a.sale.gross_amount) * 100), 100)
                          : 0
                      return (
                        <Link
                          key={a.sale.id}
                          href={`/${tenant}/ventas/registro/${a.sale.id}`}
                          className="relative block rounded-lg border border-border bg-card p-3 hover:border-brand-500/50 transition-colors"
                        >
                          <button
                            type="button"
                            title="Añadir nota de seguimiento"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setNoteText('')
                              setNoteSale({ id: a.sale.id, name: a.sale.contacts?.full_name ?? 'esta venta' })
                            }}
                            className="absolute top-2 right-2 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                          <p className="text-sm font-medium text-foreground truncate">
                            {a.sale.contacts?.full_name ?? '—'}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{a.sale.products?.name ?? '—'}</p>
                          {a.sale.closer?.full_name && (
                            <div className="flex items-center gap-1 mt-1">
                              <UserIcon className="w-3 h-3 text-muted-foreground" />
                              <span className="text-[11px] text-muted-foreground truncate">
                                {a.sale.closer.full_name}
                              </span>
                            </div>
                          )}

                          <div className="mt-2.5">
                            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full ${stage === 'con_impago' ? 'bg-red-500' : stage === 'completado' ? 'bg-emerald-500' : 'bg-brand-500'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1">{pct}%</p>
                          </div>

                          <div className="mt-2 flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground">
                              Cobrado{' '}
                              <span className="text-foreground font-medium">{formatCurrency(a.cashCollected)}</span> /{' '}
                              {formatCurrency(a.sale.gross_amount)}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Pendiente{' '}
                            <span className="text-foreground font-medium">{formatCurrency(a.pendingAmount)}</span>
                          </p>

                          {a.nextDueDate && (
                            <p
                              className={`text-[11px] mt-1.5 flex items-center gap-1 ${a.hasOverdue ? 'text-red-400' : 'text-muted-foreground'}`}
                            >
                              <Clock className="w-3 h-3" />
                              Próximo venc.: {formatDate(a.nextDueDate)}
                            </p>
                          )}

                          {lastNoteBySale.has(a.sale.id) && (
                            <p className="text-[11px] mt-1.5 flex items-start gap-1 text-muted-foreground border-t border-border/60 pt-1.5">
                              <MessageSquare className="w-3 h-3 shrink-0 mt-0.5" />
                              <span className="truncate">{lastNoteBySale.get(a.sale.id)!.note}</span>
                            </p>
                          )}
                        </Link>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog
        open={!!noteSale}
        onOpenChange={(open) => {
          if (!open) setNoteSale(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nota de seguimiento — {noteSale?.name}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Ej: llamada de cobro, promesa de pago para el día X, acuerdo de aplazamiento..."
            rows={4}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteSale(null)}>
              Cancelar
            </Button>
            <Button onClick={submitNote} disabled={savingNote || !noteText.trim()}>
              {savingNote ? 'Guardando…' : 'Guardar nota'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
