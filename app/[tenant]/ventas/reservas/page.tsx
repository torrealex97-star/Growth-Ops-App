'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { CreditCard } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchBox, normalizeText } from '@/components/ui/search-box'
import { isLeadership, type AppRole } from '@/lib/auth/permissions'
import type { Contact, PaymentPlan, Product } from '@/lib/types/database'
import { useSesion, useTenant, useTenantId } from '@/lib/tenant-context'

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

      const [openRes, completedRes] = await Promise.all([openQuery, completedQuery])

      const reservationRows = (openRes.data ?? []) as unknown as ReservationRow[]
      setReservations(reservationRows)
      setCompleted((completedRes.data ?? []) as unknown as ReservationRow[])

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

  const nq = normalizeText(q.trim())
  const matchesQ = (row: ReservationRow) =>
    !nq ||
    normalizeText(row.contacts?.full_name || '').includes(nq) ||
    normalizeText(row.contacts?.email || '').includes(nq) ||
    normalizeText(row.products?.name || '').includes(nq)
  const openReservations = reservations.filter(matchesQ)
  const completedReservations = completed.filter(matchesQ)

  const getReferencePrice = (row: ReservationRow) =>
    row.product_id ? (referencePriceByProduct[row.product_id] ?? null) : null

  const getPending = (row: ReservationRow) => {
    const ref = getReferencePrice(row)
    if (ref == null) return null
    return Math.max(ref - row.gross_amount, 0)
  }

  const kpis = useMemo(() => {
    const totalReservado = reservations.reduce((sum, r) => sum + r.gross_amount, 0)
    const totalPendiente = reservations.reduce((sum, r) => {
      const pending = getPending(r)
      return sum + (pending ?? 0)
    }, 0)
    return {
      count: reservations.length,
      totalReservado,
      totalPendiente,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservations, referencePriceByProduct])

  const handleCompletarPago = (row: ReservationRow) => {
    const params = new URLSearchParams()
    params.set('contact', row.contact_id)
    params.set('reserva', String(row.reservation_amount ?? row.gross_amount))
    if (row.product_id) params.set('product', row.product_id)
    params.set('reservationId', row.id)
    router.push(`/${tenant}/ventas/registro/nueva?${params.toString()}`)
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
        <SearchBox value={q} onChange={setQ} placeholder="Buscar por cliente o producto..." />
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
          <p className="text-muted-foreground">No hay reservas abiertas</p>
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
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-foreground whitespace-nowrap"
                  onClick={() => handleCompletarPago(row)}
                >
                  <CreditCard className="w-4 h-4 mr-2" />
                  Completar pago
                </Button>
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
                <span className="text-xs text-muted-foreground">{formatDate(row.sale_date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
