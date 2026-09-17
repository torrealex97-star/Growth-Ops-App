'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SalesTable } from '@/components/sales/SalesTable'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Download, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate, formatCurrency } from '@/lib/utils'
import type { SaleWithRelations, User, Product, SaleStatus } from '@/lib/types/database'
import { useSesion, useTenant, useTenantId } from '@/lib/tenant-context'
import { DEFAULT_PERIOD,  getCustomDateRange, inPeriod } from '@/lib/filters/period'
import {  getPeriodRange, PERIOD_LABELS, PERIOD_PRESETS_STANDARD, type PeriodPreset } from '@/lib/filters/period'
import { SearchBox, normalizeText, phoneMatches } from '@/components/ui/search-box'
import { StripePendientesAviso } from '@/components/os/StripePendientesAviso'
import { DateRangeCalendarPopover } from '@/components/ui/calendar-popover'

const STATUS_LABELS: Record<SaleStatus, string> = {
  active: 'Activa',
  refunded: 'Devuelta',
  partial_refund: 'Dev. Parcial',
  chargeback: 'Chargeback',
  cancelled: 'Cancelada',
}

// Normaliza el canal de origen (primer touch) a una etiqueta legible
function channelLabel(source: string | null | undefined): string {
  const s = (source || '').trim().toLowerCase()
  if (!s) return 'Directo / sin atribución'
  const map: Record<string, string> = {
    meta: 'Meta Ads',
    facebook: 'Meta Ads',
    fb: 'Meta Ads',
    instagram: 'Instagram',
    ig: 'Instagram',
    google: 'Google',
    youtube: 'YouTube',
    tiktok: 'TikTok',
    calendly: 'Calendly',
    whatsapp: 'WhatsApp',
    organic: 'Orgánico',
    referral: 'Referido',
    afiliado: 'Afiliado',
    affiliate: 'Afiliado',
  }
  return map[s] ?? source!.trim()
}

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

export default function SalesPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const sesion = useSesion()
  const router = useRouter()
  const [sales, setSales] = useState<SaleWithRelations[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  // Canal de origen por contacto (first-touch UTM source) → contact_id -> source
  const [channelByContact, setChannelByContact] = useState<Map<string, string>>(new Map())

  // Filters
  const [search, setSearch] = useState('')
  // El input va sin debounce (para que se sienta fluido al teclear); el filtrado usa la versión
  // debounced, así no se recalcula filteredSales (y no se re-renderiza toda la tabla) en cada
  // tecla, que es lo que se notaba como "se bloquea" al buscar con muchas ventas cargadas.
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])
  const [statusFilter, setStatusFilter] = useState('all')
  const [setterFilter, setSetterFilter] = useState('all')
  const [closerFilter, setCloserFilter] = useState('all')
  const [productFilter, setProductFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(DEFAULT_PERIOD)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()

      const [salesRes, usersRes, productsRes, attrRes] = await Promise.all([
        supabase
          .from('sales')
          .select(
            `*, contacts(*), products(*), payment_plans(*), setter:setter_id(id, full_name), closer:closer_id(id, full_name), affiliate:affiliate_id(id, full_name)`
          )
          .eq('tenant_id', tenantId)
          .order('sale_date', { ascending: false }),
        supabase.from('users').select('*, roles(key)').eq('is_active', true),
        supabase.from('products').select('*').eq('is_active', true).eq('tenant_id', tenantId),
        supabase
          .from('contact_attributions')
          .select('contact_id, first_utm_source, utm_source')
          .eq('tenant_id', tenantId),
      ])

      if (salesRes.error) {
        toast.error('Error al cargar ventas', { description: salesRes.error.message })
      } else {
        setSales(salesRes.data as SaleWithRelations[])
      }
      // No se comprobaban estos errores: si RLS bloqueaba usuarios/productos para un rol no-admin,
      // los filtros de Setter/Closer/Producto se quedaban vacíos en silencio, sin avisar de nada.
      if (usersRes.error) toast.error('Error al cargar usuarios', { description: usersRes.error.message })
      if (productsRes.error) toast.error('Error al cargar productos', { description: productsRes.error.message })

      // Mapa canal por contacto: primero first-touch, si no el utm_source suelto
      const chMap = new Map<string, string>()
      for (const a of (attrRes.data ?? []) as {
        contact_id: string
        first_utm_source: string | null
        utm_source: string | null
      }[]) {
        const src = a.first_utm_source || a.utm_source
        if (a.contact_id && src && !chMap.has(a.contact_id)) chMap.set(a.contact_id, src)
      }
      setChannelByContact(chMap)

      setUsers(usersRes.data ?? [])
      setProducts(productsRes.data ?? [])
      setLoading(false)

      setIsAdmin(sesion?.rol === 'admin' || sesion?.rol === 'director')
    }

    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, sesion])

  const setters = useMemo(
    () => users.filter((u) => (u as { roles?: { key?: string } }).roles?.key === 'setter'),
    [users]
  )
  const closers = useMemo(
    () => users.filter((u) => ['closer', 'admin'].includes((u as { roles?: { key?: string } }).roles?.key ?? '')),
    [users]
  )

  const handleSaleDeleted = useCallback((saleId: string) => {
    setSales((prev) => prev.filter((s) => s.id !== saleId))
  }, [])

  const periodRange = useMemo(
    () => getPeriodRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo]
  )
  const directDateRange = useMemo(() => getCustomDateRange(dateFrom, dateTo), [dateFrom, dateTo])

  const filteredSales = useMemo(() => {
    const q = normalizeText(debouncedSearch.trim())
    return sales.filter((s) => {
      if (q) {
        const c = s.contacts as { full_name?: string | null; email?: string | null; phone?: string | null } | null
        const name = normalizeText(c?.full_name ?? '')
        const email = normalizeText(c?.email ?? '')
        const matchesText = name.includes(q) || email.includes(q)
        const matchesPhone = phoneMatches(c?.phone, debouncedSearch)
        if (!matchesText && !matchesPhone) return false
      }
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (setterFilter !== 'all' && s.setter_id !== setterFilter) return false
      if (closerFilter !== 'all' && s.closer_id !== closerFilter) return false
      if (productFilter !== 'all' && s.product_id !== productFilter) return false
      if ((dateFrom || dateTo) && !inPeriod(s.sale_date, directDateRange)) return false

      if (periodPreset !== 'all') {
        const saleDate = s.sale_date ? new Date(s.sale_date) : null
        if (!saleDate) return false
        if (periodRange.from && saleDate < periodRange.from) return false
        if (periodRange.to && saleDate > periodRange.to) return false
      }

      return true
    })
  }, [
    sales,
    debouncedSearch,
    statusFilter,
    setterFilter,
    closerFilter,
    productFilter,
    dateFrom,
    dateTo,
    directDateRange,
    periodPreset,
    periodRange,
  ])

  // Canal de una venta: first-touch UTM del contacto → si no, lead_channel del contacto → Directo
  const channelOfSale = useCallback(
    (s: SaleWithRelations): string => {
      const src =
        (s.contact_id && channelByContact.get(s.contact_id)) ||
        (s.contacts as { lead_channel?: string } | null)?.lead_channel
      return channelLabel(src)
    },
    [channelByContact]
  )

  // Desglose de ventas por canal (respeta los filtros aplicados)
  const salesByChannel = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number }>()
    for (const s of filteredSales) {
      const ch = channelOfSale(s)
      const cur = map.get(ch) ?? { count: 0, revenue: 0 }
      cur.count += 1
      cur.revenue += Number(s.gross_amount ?? 0)
      map.set(ch, cur)
    }
    return Array.from(map.entries())
      .map(([channel, v]) => ({ channel, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [filteredSales, channelOfSale])

  const periodFileTag = useMemo(() => {
    if (periodPreset === 'all') return 'todas'
    if (periodPreset === 'custom') {
      return `${customFrom || 'inicio'}_a_${customTo || 'fin'}`
    }
    return periodPreset
  }, [periodPreset, customFrom, customTo])

  const clearPeriod = () => {
    setPeriodPreset('all')
    setCustomFrom('')
    setCustomTo('')
  }

  const handleExportCSV = () => {
    const headers = ['Fecha', 'Contacto', 'Email', 'Teléfono', 'Canal', 'Plan', 'Importe', 'Setter', 'Closer', 'Estado']
    const rows = filteredSales.map((s) => [
      formatDate(s.sale_date),
      s.contacts?.full_name ?? '',
      s.contacts?.email ?? '',
      s.contacts?.phone ?? '',
      channelOfSale(s),
      s.payment_plans?.name ?? '',
      formatCurrency(s.gross_amount),
      s.setter?.full_name ?? '',
      s.closer?.full_name ?? '',
      s.status,
    ])
    downloadCSV(`ventas_${periodFileTag}.csv`, headers, rows)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ventas</h1>
          <p className="text-muted-foreground text-sm mt-1">Registro de todas las ventas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportCSV}>
            <Download className="w-4 h-4 mr-2" />
            Exportar CSV
          </Button>
          <Button onClick={() => router.push(`/${tenant}/ventas/registro/nueva`)}>
            <Plus className="w-4 h-4 mr-2" />
            Nueva Venta
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar por nombre, email o teléfono..." />

        <Select value={periodPreset} onValueChange={(v) => setPeriodPreset(v as PeriodPreset)}>
          <SelectTrigger className="w-44 bg-card border-border">
            <SelectValue placeholder="Periodo" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            {PERIOD_PRESETS_STANDARD.map((p) => (
              <SelectItem key={p} value={p}>
                {PERIOD_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {periodPreset === 'custom' && (
          <DateRangeCalendarPopover
            from={customFrom}
            to={customTo}
            onFromChange={setCustomFrom}
            onToChange={setCustomTo}
            className="w-full sm:w-72"
          />
        )}

        {periodPreset !== 'all' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs text-muted-foreground hover:text-foreground"
            onClick={clearPeriod}
          >
            Limpiar periodo
          </Button>
        )}

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 bg-card border-border">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={setterFilter} onValueChange={setSetterFilter}>
          <SelectTrigger className="w-40 bg-card border-border">
            <SelectValue placeholder="Setter" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Todos los setters</SelectItem>
            {setters.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={closerFilter} onValueChange={setCloserFilter}>
          <SelectTrigger className="w-40 bg-card border-border">
            <SelectValue placeholder="Closer" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Todos los closers</SelectItem>
            {closers.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={productFilter} onValueChange={setProductFilter}>
          <SelectTrigger className="w-44 bg-card border-border">
            <SelectValue placeholder="Producto" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Todos los productos</SelectItem>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DateRangeCalendarPopover
          from={dateFrom}
          to={dateTo}
          onFromChange={setDateFrom}
          onToChange={setDateTo}
          className="w-full sm:w-72"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-card rounded-lg animate-pulse" />
          ))}
        </div>
      ) : sales.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ShoppingCart className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No hay ventas</h3>
          <p className="text-muted-foreground text-sm mb-4">Crea tu primera venta</p>
          <Button onClick={() => router.push(`/${tenant}/ventas/registro/nueva`)}>
            <Plus className="w-4 h-4 mr-2" />
            Nueva Venta
          </Button>
          {/* Si hay clientes de Stripe sincronizados, este vacío tiene una explicación concreta y un
              sitio al que ir. Sin esto, "No hay ventas" se lee como "el importador no funciona". */}
          <StripePendientesAviso tenant={tenant} contexto="ventas" />
        </div>
      ) : (
        <>
          {/* Desglose por canal de origen (first-touch UTM del contacto) */}
          {salesByChannel.length > 0 && (
            <div className="rounded-lg border border-border bg-card/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-foreground">Ventas por canal</h2>
                <span className="text-xs text-muted-foreground">
                  {filteredSales.length} ventas · origen del contacto
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {salesByChannel.map((c) => (
                  <div key={c.channel} className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="text-xs text-muted-foreground truncate" title={c.channel}>
                      {c.channel}
                    </div>
                    <div className="text-lg font-semibold text-foreground tabular-nums mt-0.5">
                      {formatCurrency(c.revenue)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {c.count} {c.count === 1 ? 'venta' : 'ventas'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <SalesTable sales={filteredSales} isAdmin={isAdmin} onDeleted={handleSaleDeleted} />
          <p className="text-xs text-muted-foreground">
            {filteredSales.length} de {sales.length} ventas
          </p>
        </>
      )}
    </div>
  )
}
