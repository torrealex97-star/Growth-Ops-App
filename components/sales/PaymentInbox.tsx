'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSesion, useTenant } from '@/lib/tenant-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import type { PendingPayment } from '@/lib/sales/payment-inbox'

type Detail = {
  payment: PendingPayment
  products: { id: string; name: string }[]
  plans: {
    id: string
    name: string
    product_id: string
    gross_price: number
    number_of_payments: number
    method: string | null
  }[]
  sales: { id: string; sale_date: string; gross_amount: number; products: { name: string } | null }[]
}
const changed = 'growthops:payment-inbox-changed'

export function PaymentInbox({ compact = false, onCount }: { compact?: boolean; onCount?: (count: number) => void }) {
  const tenant = useTenant()
  const session = useSesion()
  const router = useRouter()
  const allowed = !!session && (session.isSuperAdmin || ['admin', 'director', 'closer'].includes(session.rol ?? ''))
  const [rows, setRows] = useState<PendingPayment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState('')
  const [saleId, setSaleId] = useState('')
  const [product, setProduct] = useState('')
  const [plan, setPlan] = useState('')
  const [gross, setGross] = useState('')
  const [date, setDate] = useState('')
  const [count, setCount] = useState('')
  const [start, setStart] = useState('')
  const [page, setPage] = useState(0)
  const reviewRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (detail) reviewRef.current?.scrollIntoView({ block: 'start' })
  }, [detail])

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!allowed) return
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/${tenant}/evergreen/sales/payment-inbox`, { signal, cache: 'no-store' })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error)
        if (signal?.aborted) return
        setRows(body.rows)
        onCount?.(body.total)
        setPage(0)
      } catch (e) {
        if (!signal?.aborted) {
          setRows([])
          onCount?.(0)
          setError(e instanceof Error ? e.message : 'No se pudieron cargar los cobros.')
        }
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [allowed, tenant, onCount]
  )
  useEffect(() => {
    const controller = new AbortController()
    setRows([])
    onCount?.(0)
    void refresh(controller.signal)
    const update = () => {
      void refresh(controller.signal)
    }
    window.addEventListener(changed, update)
    window.addEventListener('focus', update)
    return () => {
      controller.abort()
      window.removeEventListener(changed, update)
      window.removeEventListener('focus', update)
    }
  }, [refresh, onCount])

  async function open(paymentId: string) {
    setOpening(paymentId)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/sales/payment-inbox?payment=${encodeURIComponent(paymentId)}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      setDetail(body)
      setMode('')
      setSaleId('')
      setProduct('')
      setPlan('')
      setGross('')
      setCount('')
      setStart('')
      setDate(body.payment.paid_at?.slice(0, 10) ?? '')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo abrir el cobro')
    } finally {
      setOpening(null)
    }
  }
  async function save() {
    if (!detail) return
    setSaving(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/sales/payment-inbox/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId: detail.payment.payment_id,
          ...(mode === 'existing'
            ? { saleId }
            : {
                productId: product,
                planId: plan,
                grossAmount: Number(gross),
                saleDate: date,
                restCount: Number(count),
                ...(start ? { startDate: start } : {}),
              }),
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      if (body.warning) toast.warning(body.warning)
      else toast.success(mode === 'existing' ? 'Cobro añadido a la venta' : 'Venta y cobro registrados')
      setDetail(null)
      window.dispatchEvent(new Event(changed))
      router.push(`/${tenant}/ventas/registro/${body.saleId}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo registrar')
    } finally {
      setSaving(false)
    }
  }
  if (!allowed) return null
  const visible = compact ? rows.slice(0, 3) : rows.slice(page * 10, page * 10 + 10)
  const selectClass = 'mt-1 w-full rounded-md border border-border bg-background p-2 text-sm'
  return (
    <section
      id={compact ? undefined : 'cobros-pendientes'}
      className={compact ? 'px-4 py-3 space-y-2' : 'dashboard-card p-5 space-y-4'}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Cobros pendientes de registrar{!loading && !error ? ` · ${rows.length}` : ''}
        </h2>
        <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refresh()}>
          Actualizar
        </Button>
      </div>
      {!compact && (
        <p className="text-sm text-muted-foreground">
          Revisa los cobros de Stripe sincronizados, de cualquier fecha. Decide si corresponden a una venta nueva o a
          una cuota. Los cobros manuales se registran desde la venta.
        </p>
      )}
      {loading && (
        <p className="text-xs text-muted-foreground" role="status">
          Comprobando cobros…
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No hay cobros pendientes en las fuentes sincronizadas a las que tienes acceso.
        </p>
      )}
      {visible.map((p) => (
        <div
          key={p.payment_id}
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium break-words">
              {p.contactName || p.customer_email || 'Contacto por identificar'}
            </p>
            <p className="text-xs text-muted-foreground">
              Stripe · {p.paid_at ? formatDate(p.paid_at) : 'Sin fecha'} ·{' '}
              {p.currency.toUpperCase() === 'EUR'
                ? formatCurrency(Number(p.amount))
                : `${p.amount} ${p.currency.toUpperCase()}`}
            </p>
          </div>
          {compact ? (
            <Link className="text-xs text-primary underline" href={`/${tenant}/ventas/registro#cobros-pendientes`}>
              Revisar cobro
            </Link>
          ) : (
            <Button size="sm" variant="outline" disabled={opening !== null} onClick={() => void open(p.payment_id)}>
              {opening === p.payment_id ? 'Abriendo…' : 'Revisar cobro'}
            </Button>
          )}
        </div>
      ))}
      {compact && rows.length > 3 && (
        <Link className="block text-xs text-primary underline" href={`/${tenant}/ventas/registro#cobros-pendientes`}>
          Ver los {rows.length} pendientes
        </Link>
      )}
      {!compact && rows.length > 10 && (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span className="text-xs">
            {page + 1} / {Math.ceil(rows.length / 10)}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={(page + 1) * 10 >= rows.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}
      {detail && (
        <section
          ref={reviewRef}
          aria-label="Registrar cobro recibido"
          className="scroll-mt-24 rounded-xl border border-border p-5 space-y-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Registrar cobro recibido</h3>
              <p className="text-sm text-muted-foreground">
                {detail.payment.contactName || detail.payment.customer_email} ·{' '}
                {formatCurrency(Number(detail.payment.amount))} recibidos
              </p>
            </div>
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDetail(null)}>
              Cerrar
            </Button>
          </div>
          {detail &&
            (!detail.payment.contactId ? (
              <p className="text-sm">
                No hay un contacto único con este email.{' '}
                <Link className="text-primary underline" href={`/${tenant}/crm/contactos`}>
                  Identifica el contacto en CRM
                </Link>{' '}
                y actualiza la bandeja.
              </p>
            ) : (
              <div className="space-y-4">
                <label className="block text-sm">
                  ¿A qué corresponde este pago?
                  <select className={selectClass} value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="">Seleccionar…</option>
                    <option value="new">Una venta nueva</option>
                    <option value="existing">Una venta ya registrada / cuota</option>
                  </select>
                </label>
                {mode === 'existing' && (
                  <label className="block text-sm">
                    Venta
                    <select className={selectClass} value={saleId} onChange={(e) => setSaleId(e.target.value)}>
                      <option value="">Seleccionar venta…</option>
                      {detail.sales.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.products?.name ?? 'Venta'} · {formatDate(s.sale_date)} ·{' '}
                          {formatCurrency(Number(s.gross_amount))}
                        </option>
                      ))}
                    </select>
                    {detail.sales.length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        No hay ventas activas de este contacto a las que tengas acceso.
                      </span>
                    )}
                  </label>
                )}
                {mode === 'new' && (
                  <>
                    {detail.sales.length > 0 && (
                      <p className="text-sm text-amber-400">
                        Este contacto ya tiene ventas. Confirma que es otra compra y no una cuota.
                      </p>
                    )}
                    <label className="block text-sm">
                      Producto
                      <select
                        className={selectClass}
                        value={product}
                        onChange={(e) => {
                          setProduct(e.target.value)
                          setPlan('')
                          setGross('')
                        }}
                      >
                        <option value="">Seleccionar…</option>
                        {detail.products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm">
                      Plan
                      <select
                        className={selectClass}
                        value={plan}
                        onChange={(e) => {
                          setPlan(e.target.value)
                          const p = detail.plans.find((p) => p.id === e.target.value)
                          setGross(p ? String(p.gross_price) : '')
                          setCount('')
                        }}
                      >
                        <option value="">Seleccionar…</option>
                        {detail.plans
                          .filter((p) => p.product_id === product && !['sequra', 'reserva'].includes(p.method ?? ''))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="block text-sm">
                      Importe total pactado (€)
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={gross}
                        onChange={(e) => setGross(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      Fecha de venta
                      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                    </label>
                    {Number(gross) > Number(detail.payment.amount) && (
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-sm">
                          Cuotas restantes
                          <Input
                            type="number"
                            min="1"
                            max="120"
                            value={count}
                            onChange={(e) => setCount(e.target.value)}
                          />
                        </label>
                        <label className="text-sm">
                          Siguiente vencimiento
                          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                        </label>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Se conserva el equipo asignado en CRM. El importe recibido se verifica en Stripe y no se puede
                      modificar aquí.
                    </p>
                  </>
                )}
                <Button
                  disabled={saving || !mode || (mode === 'existing' ? !saleId : !product || !plan || !gross || !date)}
                  onClick={() => void save()}
                >
                  {saving
                    ? 'Registrando…'
                    : mode === 'existing'
                      ? 'Añadir cobro a esta venta'
                      : 'Registrar venta nueva'}
                </Button>
              </div>
            ))}
        </section>
      )}
    </section>
  )
}
