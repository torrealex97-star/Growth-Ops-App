'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, RotateCcw, Search, Loader2, Download, X } from 'lucide-react'
import { formatDate, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import type { Refund, SaleWithRelations } from '@/lib/types/database'
import { useTenant, useTenantId } from '@/lib/tenant-context'
import { DEFAULT_PERIOD, getCustomDateRange } from '@/lib/filters/period'
import { getPeriodRange, PERIOD_LABELS, PERIOD_PRESETS_STANDARD, type PeriodPreset } from '@/lib/filters/period'
import { DateRangeCalendarPopover } from '@/components/ui/calendar-popover'

type RefundWithSale = Refund & { sales?: SaleWithRelations }

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

export default function RefundsPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [refunds, setRefunds] = useState<RefundWithSale[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [saleSearch, setSaleSearch] = useState('')
  const [saleResults, setSaleResults] = useState<SaleWithRelations[]>([])
  const [selectedSale, setSelectedSale] = useState<SaleWithRelations | null>(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [reason, setReason] = useState('')
  const [refundDate, setRefundDate] = useState(new Date().toISOString().split('T')[0])
  const [searchLoading, setSearchLoading] = useState(false)

  // Periodo
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(DEFAULT_PERIOD)
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')

  const fetchRefunds = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('refunds')
      .select(`*, sales(*, contacts(*), payment_plans(*))`)
      .eq('tenant_id', tenantId)
      .order('refund_date', { ascending: false })

    if (error) {
      toast.error('Error al cargar devoluciones')
    } else {
      setRefunds(data as RefundWithSale[])
    }
    setLoading(false)
  }, [tenantId])

  useEffect(() => {
    fetchRefunds()
  }, [fetchRefunds])

  const searchSales = useCallback(
    async (query: string) => {
      if (!query || query.length < 2) {
        setSaleResults([])
        return
      }
      setSearchLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('sales')
        .select(
          `*, contacts(*), payment_plans(*), setter:setter_id(id, full_name), closer:closer_id(id, full_name), affiliate:affiliate_id(id, full_name), products(*)`
        )
        .neq('status', 'refunded')
        .eq('tenant_id', tenantId)
        .limit(6)

      setSaleResults((data ?? []) as SaleWithRelations[])
      setSearchLoading(false)
    },
    [tenantId]
  )

  useEffect(() => {
    const timer = setTimeout(() => searchSales(saleSearch), 300)
    return () => clearTimeout(timer)
  }, [saleSearch, searchSales])

  const periodRange = useMemo(
    () => getPeriodRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo]
  )

  const filteredRefunds = useMemo(() => {
    return refunds.filter((r) => {
      if (periodPreset !== 'all') {
        const relevant = r.refund_date ? new Date(r.refund_date) : null
        if (!relevant) return false
        if (periodRange.from && relevant < periodRange.from) return false
        if (periodRange.to && relevant > periodRange.to) return false
      }
      return true
    })
  }, [refunds, periodPreset, periodRange])

  const periodFileTag = useMemo(() => {
    if (periodPreset === 'all') return 'todas'
    if (periodPreset === 'custom') {
      return `${customFrom || 'inicio'}_a_${customTo || 'fin'}`
    }
    return periodPreset
  }, [periodPreset, customFrom, customTo])

  const clearFilters = () => {
    setPeriodPreset('all')
    setCustomFrom('')
    setCustomTo('')
  }

  const handleExportCSV = () => {
    const headers = ['Fecha', 'Cliente', 'Plan', 'Importe devuelto', 'Importe comisionable', 'Motivo', 'Estado']
    const rows = filteredRefunds.map((r) => [
      r.refund_date ? new Date(r.refund_date).toLocaleDateString('es-ES') : '',
      r.sales?.contacts?.full_name ?? '',
      r.sales?.payment_plans?.name ?? '',
      r.gross_refund_amount,
      r.commissionable_refund_amount,
      r.reason ?? '',
      r.status,
    ])
    downloadCSV(`devoluciones_${periodFileTag}.csv`, headers, rows)
  }

  const handleSubmit = async () => {
    if (!selectedSale || !refundAmount || !reason) {
      toast.error('Completa todos los campos obligatorios')
      return
    }

    setSubmitting(true)
    // Por la ruta canónica (POST /refunds/create) en vez de escribir desde el navegador.
    //
    // POR QUÉ. Esta pantalla era una SEGUNDA implementación de "registrar una devolución", y se
    // saltaba reglas que la ruta sí aplica: la VENTANA DE 15 DÍAS (aquí se podía devolver una venta
    // fuera de plazo sin que nadie lo impidiera), el recálculo del tramo del rep (al bajar el cash
    // collected puede bajar de nivel y su % debe bajar con él), el tope de "no más de lo cobrado", y
    // el importe comisionable proporcional calculado sobre los cobros REALES en vez de estimado en
    // cliente. También marca la venta como devuelta comprobando que la escritura surtió efecto.
    const res = await fetch(`/api/${tenant}/evergreen/refunds/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        saleId: selectedSale.id,
        grossRefundAmount: parseFloat(refundAmount),
        reason,
        refundDate,
      }),
    })
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string
      outOfWindow?: boolean
      negativeCommissions?: number
    }
    if (!res.ok) {
      toast.error(payload.outOfWindow ? 'Fuera del plazo de devolución' : 'Error al registrar la devolucion', {
        description: payload.error,
      })
      setSubmitting(false)
      return
    }

    toast.success(
      payload.negativeCommissions
        ? `Devolución registrada — se han restado ${payload.negativeCommissions} comisiones`
        : 'Devolución registrada correctamente'
    )
    setDialogOpen(false)
    fetchRefunds()
    setSubmitting(false)
    setSelectedSale(null)
    setSaleSearch('')
    setRefundAmount('')
    setReason('')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Devoluciones</h1>
          <p className="text-muted-foreground text-sm mt-1">Gestion de reembolsos y cancelaciones</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Registrar Devolucion
        </Button>
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
                onClick={clearFilters}
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">Periodo personalizado</Label>
              <DateRangeCalendarPopover
                from={customFrom}
                to={customTo}
                onFromChange={setCustomFrom}
                onToChange={setCustomTo}
                className="h-9"
              />
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 bg-card rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filteredRefunds.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <RotateCcw className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No hay devoluciones</h3>
          <p className="text-muted-foreground text-sm">Las devoluciones registradas apareceran aqui</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Fecha</TableHead>
                <TableHead className="text-muted-foreground">Venta</TableHead>
                <TableHead className="text-muted-foreground">Importe devuelto</TableHead>
                <TableHead className="text-muted-foreground">Motivo</TableHead>
                <TableHead className="text-muted-foreground">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRefunds.map((r) => (
                <TableRow key={r.id} className="border-border">
                  <TableCell className="text-foreground text-sm">{formatDate(r.refund_date)}</TableCell>
                  <TableCell>
                    <p className="text-foreground text-sm">{r.sales?.contacts?.full_name || '—'}</p>
                    <p className="text-muted-foreground text-xs">{r.sales?.payment_plans?.name || ''}</p>
                  </TableCell>
                  <TableCell className="text-red-400 font-medium">{formatCurrency(r.gross_refund_amount)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-xs truncate">{r.reason || '—'}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === 'processed' ? 'destructive' : r.status === 'pending' ? 'warning' : 'secondary'
                      }
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar Devolucion</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Buscar venta */}
            <div className="space-y-2">
              <Label>Venta *</Label>
              {selectedSale ? (
                <div className="bg-muted border border-border rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground text-sm">{selectedSale.contacts?.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedSale.payment_plans?.name} — {formatCurrency(selectedSale.gross_amount)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground text-xs"
                    onClick={() => setSelectedSale(null)}
                  >
                    Cambiar
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar venta..."
                    value={saleSearch}
                    onChange={(e) => setSaleSearch(e.target.value)}
                    className="pl-9 bg-muted border-border"
                  />
                  {(saleResults.length > 0 || searchLoading) && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-1 border border-border rounded-lg overflow-hidden bg-card">
                      {searchLoading ? (
                        <div className="p-3 text-center text-muted-foreground text-sm">Buscando...</div>
                      ) : (
                        saleResults.map((s) => (
                          <button
                            key={s.id}
                            className="w-full text-left px-4 py-3 hover:bg-muted border-b border-border last:border-0 text-sm"
                            onClick={() => {
                              setSelectedSale(s)
                              setSaleSearch('')
                              setSaleResults([])
                              setRefundAmount(String(s.gross_amount))
                            }}
                          >
                            <p className="text-foreground font-medium">{s.contacts?.full_name}</p>
                            <p className="text-muted-foreground text-xs">{s.payment_plans?.name}</p>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Fecha */}
            <div className="space-y-2">
              <Label>Fecha *</Label>
              <Input
                type="date"
                value={refundDate}
                onChange={(e) => setRefundDate(e.target.value)}
                className="bg-muted border-border"
              />
            </div>

            {/* Importe */}
            <div className="space-y-2">
              <Label>Importe a devolver *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="bg-muted border-border"
                placeholder="0.00"
              />
            </div>

            {/* Motivo */}
            <div className="space-y-2">
              <Label>Motivo *</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="bg-muted border-border min-h-[80px]"
                placeholder="Razon de la devolucion..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={handleSubmit}
                disabled={submitting || !selectedSale || !refundAmount || !reason}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  'Registrar Devolucion'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
