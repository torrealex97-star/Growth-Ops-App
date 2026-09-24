'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { CreditCard, Pencil, Plus, Trash2 } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchBox, normalizeText } from '@/components/ui/search-box'
import { isLeadership, type AppRole } from '@/lib/auth/permissions'
import type { Contact, PaymentPlan, Product } from '@/lib/types/database'
import { useSesion, useTenant, useTenantId } from '@/lib/tenant-context'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getPeriodRange, PERIOD_LABELS, PERIOD_PRESETS_STANDARD, type PeriodPreset } from '@/lib/filters/period'
import { DateRangeCalendarPopover } from '@/components/ui/calendar-popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type ReservationRow = {
  id: string
  contact_id: string
  product_id: string | null
  payment_plan_id: string | null
  gross_amount: number
  sale_date: string
  reservation_amount: number | null
  reservation_completed_at: string | null
  closer_id: string | null
  setter_id: string | null
  contacts: Pick<Contact, 'full_name' | 'email'> | null
  products: Pick<Product, 'id' | 'name'> | null
  payment_plans: Pick<PaymentPlan, 'method' | 'name'> | null
}

export default function ReservasPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const sesion = useSesion()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [reservations, setReservations] = useState<ReservationRow[]>([])
  const [completed, setCompleted] = useState<ReservationRow[]>([])
  const [referencePriceByProduct, setReferencePriceByProduct] = useState<Record<string, number>>({})

  // Filtro de periodo (§4 del pipeline): mismo estándar que el resto de pantallas de ventas.
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  // Alta manual de reserva: prefill del flujo de nueva venta con el plan de reserva del producto.
  const [newOpen, setNewOpen] = useState(false)
  const [products, setProducts] = useState<Pick<Product, 'id' | 'name'>[]>([])
  const [newProductId, setNewProductId] = useState('')
  const [newContactId, setNewContactId] = useState('')
  const [newContactSearch, setNewContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<Pick<Contact, 'id' | 'full_name' | 'email'>[]>([])

  // Editar / eliminar (registros manuales: siempre recuperables si uno se equivoca).
  const [editRow, setEditRow] = useState<ReservationRow | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleteRow, setDeleteRow] = useState<ReservationRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const periodRange = useMemo(
    () => getPeriodRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo]
  )

  const inPeriod = (date: string | null | undefined) => {
    if (periodPreset === 'all') return true
    if (!date) return false
    const d = new Date(date)
    if (periodRange.from && d < periodRange.from) return false
    if (periodRange.to && d > periodRange.to) return false
    return true
  }

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      const supabase = createClient()

      if (!sesion) {
        setLoading(false)
        return
      }
      const myId = sesion.userId
      const roleKey = sesion.rol as AppRole | null
      const canViewAll = roleKey ? isLeadership(roleKey) : false

      const cols =
        'id, contact_id, product_id, payment_plan_id, gross_amount, sale_date, reservation_amount, reservation_completed_at, closer_id, setter_id, contacts(full_name,email), products(id,name), payment_plans(method,name)'

      let openQuery = supabase
        .from('sales')
        .select(cols.replace('payment_plans(', 'payment_plans!inner('))
        .eq('tenant_id', tenantId)
        .eq('payment_plans.method', 'reserva')
        .is('reservation_completed_at', null)
        .order('sale_date', { ascending: false })
      let completedQuery = supabase
        .from('sales')
        .select(cols)
        .eq('tenant_id', tenantId)
        .not('reservation_completed_at', 'is', null)
        .order('reservation_completed_at', { ascending: false })

      if (!canViewAll && myId) {
        openQuery = openQuery.or(`closer_id.eq.${myId},setter_id.eq.${myId}`)
        completedQuery = completedQuery.or(`closer_id.eq.${myId},setter_id.eq.${myId}`)
      }

      const [openRes, completedRes, productsRes] = await Promise.all([
        openQuery,
        completedQuery,
        supabase.from('products').select('id, name').eq('tenant_id', tenantId).eq('is_active', true).order('name'),
      ])

      const reservationRows = (openRes.data ?? []) as unknown as ReservationRow[]
      setReservations(reservationRows)
      setCompleted((completedRes.data ?? []) as unknown as ReservationRow[])
      setProducts((productsRes.data ?? []) as Pick<Product, 'id' | 'name'>[])

      // Cargar planes de los productos implicados para calcular el precio de referencia
      const productIds = Array.from(
        new Set(reservationRows.map((r) => r.product_id).filter((id): id is string => !!id))
      )

      if (productIds.length > 0) {
        const { data: plansData } = await supabase
          .from('payment_plans')
          .select('*')
          .eq('tenant_id', tenantId)
          .in('product_id', productIds)

        const plans = (plansData ?? []) as PaymentPlan[]
        const refByProduct: Record<string, number> = {}

        for (const productId of productIds) {
          const productPlans = plans.filter((p) => p.product_id === productId)
          const nonReserva = productPlans.filter((p) => p.method !== 'reserva')

          let refPlan = nonReserva.find((p) => p.method === 'stripe' || p.number_of_payments === 1)
          if (!refPlan && nonReserva.length > 0) {
            refPlan = nonReserva.reduce((min, p) => (p.gross_price < min.gross_price ? p : min), nonReserva[0])
          }

          if (refPlan) {
            refByProduct[productId] = refPlan.gross_price
          }
        }

        setReferencePriceByProduct(refByProduct)
      }

      setLoading(false)
    }

    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion, tenantId])

  // Búsqueda de contactos para el alta manual (mismo patrón que nueva venta).
  useEffect(() => {
    if (!newOpen) return
    const query = newContactSearch.trim()
    if (query.length < 2) {
      setContactResults([])
      return
    }
    const timer = setTimeout(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('contacts')
        .select('id, full_name, email')
        .or(`full_name.ilike.%${query}%,email.ilike.%${query}%`)
        .eq('tenant_id', tenantId)
        .limit(8)
      setContactResults((data ?? []) as Pick<Contact, 'id' | 'full_name' | 'email'>[])
    }, 300)
    return () => clearTimeout(timer)
  }, [newContactSearch, newOpen, tenantId])

  const nq = normalizeText(q.trim())
  const matchesQ = (row: ReservationRow) =>
    !nq ||
    normalizeText(row.contacts?.full_name || '').includes(nq) ||
    normalizeText(row.contacts?.email || '').includes(nq) ||
    normalizeText(row.products?.name || '').includes(nq)
  const openReservations = reservations.filter((r) => matchesQ(r) && inPeriod(r.sale_date))
  const completedReservations = completed.filter(
    (r) => matchesQ(r) && inPeriod(r.reservation_completed_at ?? r.sale_date)
  )

  const getReferencePrice = (row: ReservationRow) =>
    row.product_id ? (referencePriceByProduct[row.product_id] ?? null) : null

  const getPending = (row: ReservationRow) => {
    const ref = getReferencePrice(row)
    if (ref == null) return null
    return Math.max(ref - row.gross_amount, 0)
  }

  const kpis = useMemo(() => {
    const totalReservado = openReservations.reduce((sum, r) => sum + r.gross_amount, 0)
    const totalPendiente = openReservations.reduce((sum, r) => {
      const pending = getPending(r)
      return sum + (pending ?? 0)
    }, 0)
    return {
      count: openReservations.length,
      totalReservado,
      totalPendiente,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openReservations, referencePriceByProduct])

  const handleCompletarPago = (row: ReservationRow) => {
    const params = new URLSearchParams()
    params.set('contact', row.contact_id)
    params.set('reserva', String(row.reservation_amount ?? row.gross_amount))
    if (row.product_id) params.set('product', row.product_id)
    params.set('reservationId', row.id)
    router.push(`/${tenant}/ventas/registro/nueva?${params.toString()}`)
  }

  // Alta manual: redirige al flujo de nueva venta con el plan de reserva preseleccionado
  // (?plan=reserva) — reutiliza el flujo validado (cobro de la reserva + contrato opcional).
  const handleGoNewReservation = () => {
    const params = new URLSearchParams()
    if (newContactId) params.set('contact', newContactId)
    if (newProductId) params.set('product', newProductId)
    params.set('plan', 'reserva')
    setNewOpen(false)
    router.push(`/${tenant}/ventas/registro/nueva?${params.toString()}`)
  }

  const openEdit = (row: ReservationRow) => {
    setEditRow(row)
    setEditAmount(String(row.reservation_amount ?? row.gross_amount))
    setEditDate(row.sale_date ? row.sale_date.slice(0, 10) : '')
  }

  // Edita importe/fecha de la reserva vía sales/update (server-side; el cliente no puede UPDATE).
  const submitEdit = async () => {
    if (!editRow) return
    const amount = parseFloat(editAmount)
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Importe inválido')
      return
    }
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/sales/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saleId: editRow.id,
          gross_amount: amount,
          ...(editDate ? { sale_date: editDate } : {}),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || 'No se pudo guardar el cambio')
      toast.success('Reserva actualizada')
      setEditRow(null)
      window.location.reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar el cambio')
    } finally {
      setSavingEdit(false)
    }
  }

  // Elimina la reserva completa vía sales/delete (borra también sus cobros/comisiones colgando).
  const submitDelete = async () => {
    if (!deleteRow) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/sales/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId: deleteRow.id, reason: 'Reserva eliminada manualmente' }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || 'No se pudo eliminar la reserva')
      toast.success('Reserva eliminada')
      setDeleteRow(null)
      setReservations((prev) => prev.filter((r) => r.id !== deleteRow.id))
      setCompleted((prev) => prev.filter((r) => r.id !== deleteRow.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar la reserva')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-brand-600/20 flex items-center justify-center">
          <CreditCard className="w-5 h-5 text-brand-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Reservas</h1>
          <p className="text-sm text-muted-foreground">Ventas con reserva pendientes de completar el pago</p>
        </div>
        <Button
          onClick={() => {
            setNewContactId('')
            setNewContactSearch('')
            setNewProductId('')
            setNewOpen(true)
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          Nueva reserva
        </Button>
        <SearchBox value={q} onChange={setQ} placeholder="Buscar por cliente o producto..." />
      </div>

      {/* Filtros de periodo */}
      <div className="rounded-lg border border-border bg-card/50 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Reservas abiertas</p>
          <p className="text-2xl font-bold text-foreground">{kpis.count}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Total reservado</p>
          <p className="text-2xl font-bold text-emerald-400">{formatCurrency(kpis.totalReservado)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Total pendiente</p>
          <p className="text-2xl font-bold text-amber-400">{formatCurrency(kpis.totalPendiente)}</p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-card rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && openReservations.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-10 text-center">
          <CreditCard className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No hay reservas abiertas en el periodo seleccionado</p>
        </div>
      )}

      {/* Open reservations */}
      {!loading && openReservations.length > 0 && (
        <div className="space-y-3">
          {openReservations.map((row) => {
            const referencia = getReferencePrice(row)
            const pendiente = getPending(row)
            const nombrePersona = row.contacts?.full_name || 'Sin nombre'
            const nombreProducto = row.products?.name || 'Producto desconocido'

            return (
              <div
                key={row.id}
                className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-foreground font-medium truncate">
                    {nombrePersona} pagó {formatCurrency(row.gross_amount)} de reserva
                    {pendiente != null && (
                      <>
                        {' '}
                        · falta <span className="text-amber-400 font-semibold">{formatCurrency(pendiente)}</span> por
                        pagar
                      </>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                    <span>Producto: {nombreProducto}</span>
                    {referencia != null && <span>Precio referencia: {formatCurrency(referencia)}</span>}
                    <span>Fecha: {formatDate(row.sale_date)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-foreground whitespace-nowrap"
                    onClick={() => handleCompletarPago(row)}
                  >
                    <CreditCard className="w-4 h-4 mr-2" />
                    Completar pago
                  </Button>
                  <Button size="sm" variant="ghost" title="Editar reserva" onClick={() => openEdit(row)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    title="Eliminar reserva"
                    onClick={() => setDeleteRow(row)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Completed reservations (secundario, atenuado) */}
      {!loading && completedReservations.length > 0 && (
        <div className="pt-4">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Reservas ya completadas</h2>
          <div className="space-y-2">
            {completedReservations.map((row) => (
              <div
                key={row.id}
                className="bg-card/50 border border-border/50 rounded-lg p-3 flex items-center justify-between gap-4 opacity-60"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-muted-foreground text-sm truncate">
                    {row.contacts?.full_name || 'Sin nombre'} · {row.products?.name || 'Producto desconocido'} ·{' '}
                    {formatCurrency(row.gross_amount)}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDate(row.reservation_completed_at ?? row.sale_date)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Diálogo de alta manual */}
      <Dialog
        open={newOpen}
        onOpenChange={(open) => {
          if (!open) setNewOpen(false)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva reserva</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Producto</Label>
              <Select value={newProductId} onValueChange={setNewProductId}>
                <SelectTrigger className="bg-muted border-border h-9">
                  <SelectValue placeholder="Selecciona producto" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Se preseleccionará el plan de reserva del producto; el importe y el contacto se ajustan en el siguiente
                paso.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Contacto (opcional)</Label>
              <SearchBox
                value={newContactSearch}
                onChange={setNewContactSearch}
                placeholder="Buscar por nombre o email..."
              />
              {contactResults.length > 0 && (
                <div className="rounded-lg border border-border divide-y divide-border max-h-44 overflow-y-auto">
                  {contactResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setNewContactId(c.id)
                        setNewContactSearch(c.full_name || c.email || '')
                        setContactResults([])
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${newContactId === c.id ? 'bg-brand-600/10' : ''}`}
                    >
                      <span className="text-foreground">{c.full_name || 'Sin nombre'}</span>
                      {c.email && <span className="text-muted-foreground"> · {c.email}</span>}
                    </button>
                  ))}
                </div>
              )}
              {newContactId && (
                <p className="text-[11px] text-emerald-400">Contacto seleccionado ✓ (puedes cambiarlo arriba)</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleGoNewReservation} disabled={!newProductId}>
              Continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de edición */}
      <Dialog
        open={!!editRow}
        onOpenChange={(open) => {
          if (!open) setEditRow(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar reserva — {editRow?.contacts?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Importe de la reserva (€)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Fecha</Label>
              <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>
              Cancelar
            </Button>
            <Button onClick={submitEdit} disabled={savingEdit}>
              {savingEdit ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de confirmación de borrado */}
      <Dialog
        open={!!deleteRow}
        onOpenChange={(open) => {
          if (!open) setDeleteRow(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar esta reserva?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se eliminará la reserva de <span className="text-foreground">{deleteRow?.contacts?.full_name}</span> (
            {deleteRow ? formatCurrency(deleteRow.gross_amount) : ''}) junto con sus cobros y comisiones asociados. Esta
            acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRow(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={submitDelete} disabled={deleting}>
              {deleting ? 'Eliminando…' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
