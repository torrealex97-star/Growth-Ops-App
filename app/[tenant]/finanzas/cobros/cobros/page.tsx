'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CollectionsTable } from '@/components/collections/CollectionsTable'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Plus, DollarSign, Download, X } from 'lucide-react'
import { toast } from 'sonner'
import { SearchBox, normalizeText, phoneMatches } from '@/components/ui/search-box'
import type { CollectionWithRelations } from '@/lib/types/database'
import { useTenant, useTenantId } from '@/lib/tenant-context'
import { DEFAULT_PERIOD, getCustomDateRange, inPeriod } from '@/lib/filters/period'
import { getPeriodRange, PERIOD_LABELS, PERIOD_PRESETS_STANDARD, type PeriodPreset } from '@/lib/filters/period'
import { DateRangeCalendarPopover } from '@/components/ui/calendar-popover'

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

export default function CollectionsPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const router = useRouter()
  const [collections, setCollections] = useState<CollectionWithRelations[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [q, setQ] = useState('')
  const [eligibleFilter, setEligibleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Periodo
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(DEFAULT_PERIOD)
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('collections')
        .select(`*, sales(*, contacts(*), payment_plans(*))`)
        .eq('tenant_id', tenantId)
        .order('collected_at', { ascending: false })

      if (error) {
        toast.error('Error al cargar cobros')
      } else {
        setCollections(data as CollectionWithRelations[])
      }
      setLoading(false)
    }
    fetchData()
  }, [tenantId])

  const periodRange = useMemo(
    () => getPeriodRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo]
  )
  const directDateRange = useMemo(() => getCustomDateRange(dateFrom, dateTo), [dateFrom, dateTo])

  const filtered = useMemo(() => {
    const nq = normalizeText(q.trim())
    return collections.filter((c) => {
      if (nq) {
        const ct = c.sales?.contacts as { full_name?: string; email?: string | null; phone?: string | null } | null
        const ok =
          normalizeText(ct?.full_name || '').includes(nq) ||
          normalizeText(ct?.email || '').includes(nq) ||
          phoneMatches(ct?.phone, q) ||
          normalizeText(c.sales?.payment_plans?.name || '').includes(nq)
        if (!ok) return false
      }
      if (eligibleFilter === 'yes' && !c.is_eligible_for_commission) return false
      if (eligibleFilter === 'no' && c.is_eligible_for_commission) return false
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if ((dateFrom || dateTo) && !inPeriod(c.collected_at, directDateRange)) return false

      if (periodPreset !== 'all') {
        const relevant = c.collected_at ? new Date(c.collected_at) : null
        if (!relevant) return false
        if (periodRange.from && relevant < periodRange.from) return false
        if (periodRange.to && relevant > periodRange.to) return false
      }

      return true
    })
  }, [collections, q, eligibleFilter, statusFilter, dateFrom, dateTo, directDateRange, periodPreset, periodRange])

  const hasActiveFilters =
    !!q || eligibleFilter !== 'all' || statusFilter !== 'all' || dateFrom || dateTo || periodPreset !== 'all'

  const clearFilters = () => {
    setQ('')
    setEligibleFilter('all')
    setStatusFilter('all')
    setDateFrom('')
    setDateTo('')
    setPeriodPreset('all')
    setCustomFrom('')
    setCustomTo('')
  }

  const periodFileTag = useMemo(() => {
    if (periodPreset === 'all') return 'todos'
    if (periodPreset === 'custom') {
      return `${customFrom || 'inicio'}_a_${customTo || 'fin'}`
    }
    return periodPreset
  }, [periodPreset, customFrom, customTo])

  const handleExportCSV = () => {
    const headers = ['Fecha', 'Cliente', 'Plan', 'Importe', 'Elegible comision', 'Estado']
    const rows = filtered.map((c) => [
      c.collected_at ? new Date(c.collected_at).toLocaleDateString('es-ES') : '',
      c.sales?.contacts?.full_name ?? '',
      c.sales?.payment_plans?.name ?? '',
      c.gross_amount,
      c.is_eligible_for_commission ? 'Si' : 'No',
      c.status,
    ])
    downloadCSV(`cobros_${periodFileTag}.csv`, headers, rows)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cobros</h1>
          <p className="text-muted-foreground text-sm mt-1">Registro de todos los pagos recibidos</p>
        </div>
        <Button onClick={() => router.push(`/${tenant}/finanzas/cobros/cobros/new`)}>
          <Plus className="w-4 h-4 mr-2" />
          Registrar Cobro
        </Button>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Filtros</span>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
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
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-xs text-muted-foreground">Buscar cliente</Label>
            <SearchBox value={q} onChange={setQ} placeholder="Nombre, email, teléfono o plan..." className="w-full" />
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

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Elegibilidad</Label>
            <Select value={eligibleFilter} onValueChange={setEligibleFilter}>
              <SelectTrigger className="bg-muted border-border h-9">
                <SelectValue placeholder="Elegibilidad" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="yes">Elegibles</SelectItem>
                <SelectItem value="no">No elegibles</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Estado</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-muted border-border h-9">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="collected">Cobrado</SelectItem>
                <SelectItem value="reversed">Revertido</SelectItem>
                <SelectItem value="disputed">Disputado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">Fechas del cobro</Label>
            <DateRangeCalendarPopover
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
              className="h-9"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-card rounded-lg animate-pulse" />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <DollarSign className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No hay cobros</h3>
          <p className="text-muted-foreground text-sm mb-4">Registra el primer cobro</p>
          <Button onClick={() => router.push(`/${tenant}/finanzas/cobros/cobros/new`)}>
            <Plus className="w-4 h-4 mr-2" />
            Registrar Cobro
          </Button>
        </div>
      ) : (
        <>
          <CollectionsTable collections={filtered} />
          <p className="text-xs text-muted-foreground">
            {filtered.length} de {collections.length} cobros
          </p>
        </>
      )}
    </div>
  )
}
