'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useTenant } from '@/lib/tenant-context'

// VENTAS BORRADOR — pagos de Stripe que el webhook ya identificó por contacto (y, cuando pudo, por
// producto: venta activa del cliente, Price ID mapeado en Integraciones, o coincidencia de importe con
// un único plan). Aprobar aquí es lo ÚNICO que crea la venta/cobro real: el webhook nunca escribe
// `sales`/`collections` por sí solo (ver lib/finance/stripeSaleDrafts.ts).

type Contacto = { id: string; full_name: string | null; email: string | null }
type Producto = { id: string; name: string }
type Plan = { id: string; name: string; product_id: string; method: string | null; gross_price: number }

type Draft = {
  id: string
  amount: number
  currency: string
  email: string | null
  occurred_at: string
  contact_id: string | null
  contact: Contacto | null
  suggested_product_id: string | null
  suggested_payment_plan_id: string | null
  existing_sale_id: string | null
  reason: string | null
  stripe_price_id: string | null
  payment_reference: string
}

type Mapeo = {
  id: string
  stripe_price_id: string
  product_id: string
  payment_plan_id: string
  products: { name: string } | null
  payment_plans: { name: string } | null
}

function MapeoPrices({ tenant, products, plans }: { tenant: string; products: Producto[]; plans: Plan[] }) {
  const [mapeos, setMapeos] = useState<Mapeo[]>([])
  const [priceId, setPriceId] = useState('')
  const [productId, setProductId] = useState('')
  const [planId, setPlanId] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones/stripe-price-map`)
      const j = await r.json()
      if (r.ok) setMapeos(j.mapeos ?? [])
    } catch {
      // silencioso: no es crítico para el resto de la pantalla
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant])

  async function guardar() {
    if (!priceId.trim() || !productId || !planId) {
      toast.error('Rellena Price ID, producto y plan')
      return
    }
    setSaving(true)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones/stripe-price-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripePriceId: priceId.trim(), productId, paymentPlanId: planId }),
      })
      const j = await r.json()
      if (!r.ok) {
        toast.error(j.error || 'No se pudo guardar')
        return
      }
      toast.success('Mapeo guardado: los próximos pagos con este Price ID se reconocerán solos')
      setPriceId('')
      setProductId('')
      setPlanId('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setSaving(false)
    }
  }

  async function borrar(id: string) {
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones/stripe-price-map?id=${id}`, {
        method: 'DELETE',
      })
      if (!r.ok) {
        const j = await r.json()
        toast.error(j.error || 'No se pudo borrar')
        return
      }
      setMapeos((prev) => prev.filter((m) => m.id !== id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de conexión')
    }
  }

  const planesDelProducto = plans.filter((p) => p.product_id === productId)

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
      <div>
        <h3 className="font-medium text-foreground">Reconocimiento automático por Price ID de Stripe</h3>
        <p className="text-xs text-muted-foreground">
          Di una vez qué producto/plan vende cada Price de Stripe (Stripe Dashboard → Producto → Price ID, empieza por{' '}
          <code>price_</code>). A partir de ahí, cada pago con ese Price ID se reconocerá solo en Ventas borrador.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
          placeholder="price_..."
          value={priceId}
          onChange={(e) => setPriceId(e.target.value)}
        />
        <Select
          value={productId}
          onValueChange={(v) => {
            setProductId(v)
            setPlanId('')
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Producto" />
          </SelectTrigger>
          <SelectContent>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={planId} onValueChange={setPlanId} disabled={!productId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Plan" />
          </SelectTrigger>
          <SelectContent>
            {planesDelProducto.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={saving} onClick={guardar}>
          Añadir
        </Button>
      </div>

      {mapeos.length > 0 && (
        <div className="text-sm space-y-1">
          {mapeos.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 border-t border-border pt-1">
              <span className="text-muted-foreground">
                <code>{m.stripe_price_id}</code> → {m.products?.name} · {m.payment_plans?.name}
              </span>
              <Button size="sm" variant="ghost" onClick={() => borrar(m.id)}>
                Quitar
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BorradoresPage() {
  const tenant = useTenant()
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [products, setProducts] = useState<Producto[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [choice, setChoice] = useState<Record<string, { productId: string; planId: string }>>({})
  const [working, setWorking] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/sales/drafts`)
      const j = await r.json()
      if (!r.ok) {
        toast.error(j.error || 'No se pudieron cargar los borradores')
        return
      }
      setDrafts(j.drafts ?? [])
      setProducts(j.products ?? [])
      setPlans(j.plans ?? [])
      // Prellenar la elección con la sugerencia, para que aprobar sea un solo clic cuando acierta.
      const inicial: Record<string, { productId: string; planId: string }> = {}
      for (const d of j.drafts ?? []) {
        inicial[d.id] = {
          productId: d.suggested_product_id ?? '',
          planId: d.suggested_payment_plan_id ?? '',
        }
      }
      setChoice(inicial)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant])

  async function aprobar(d: Draft) {
    setWorking(d.id)
    try {
      const eleccion = choice[d.id]
      const body = d.existing_sale_id
        ? { saleId: d.existing_sale_id }
        : { productId: eleccion?.productId, paymentPlanId: eleccion?.planId }
      if (!d.existing_sale_id && (!body.productId || !body.paymentPlanId)) {
        toast.error('Elige producto y plan antes de aprobar')
        return
      }
      const r = await fetch(`/api/${tenant}/evergreen/sales/drafts/${d.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) {
        toast.error(j.error || 'No se pudo aprobar')
        return
      }
      toast.success(d.existing_sale_id ? 'Cobro registrado sobre la venta existente' : 'Venta creada', {
        description: j.avisoComisiones,
      })
      setDrafts((prev) => prev.filter((x) => x.id !== d.id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setWorking(null)
    }
  }

  async function rechazar(d: Draft) {
    setWorking(d.id)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/sales/drafts/${d.id}/reject`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) {
        toast.error(j.error || 'No se pudo rechazar')
        return
      }
      setDrafts((prev) => prev.filter((x) => x.id !== d.id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setWorking(null)
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Cargando…</div>

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Ventas borrador (Stripe)</h2>
        <p className="text-sm text-muted-foreground">
          Pagos identificados automáticamente por contacto. Revisa la sugerencia y aprueba, o corrígela antes de
          aprobar. Nada de esto es una venta real hasta que lo confirmas.
        </p>
      </div>

      {drafts.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/50 p-6 text-sm text-muted-foreground">
          No hay borradores pendientes.
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => {
            const eleccion = choice[d.id] ?? { productId: '', planId: '' }
            const planesDelProducto = plans.filter((p) => p.product_id === eleccion.productId)
            return (
              <div key={d.id} className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-foreground">
                      {d.contact?.full_name || d.email || 'Contacto sin nombre'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.email} · {formatDate(d.occurred_at)} · ref. {d.payment_reference}
                    </div>
                  </div>
                  <div className="text-lg font-semibold text-foreground">{formatCurrency(d.amount)}</div>
                </div>

                <div className="text-xs text-muted-foreground">{d.reason}</div>

                {d.existing_sale_id ? (
                  <div className="text-sm text-foreground">
                    Se registrará como <strong>cobro de una venta ya existente</strong> de este contacto.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Select
                      value={eleccion.productId}
                      onValueChange={(v) => setChoice((prev) => ({ ...prev, [d.id]: { productId: v, planId: '' } }))}
                    >
                      <SelectTrigger className="w-56">
                        <SelectValue placeholder="Producto" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={eleccion.planId}
                      onValueChange={(v) => setChoice((prev) => ({ ...prev, [d.id]: { ...prev[d.id], planId: v } }))}
                      disabled={!eleccion.productId}
                    >
                      <SelectTrigger className="w-56">
                        <SelectValue placeholder="Plan de pago" />
                      </SelectTrigger>
                      <SelectContent>
                        {planesDelProducto.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button size="sm" disabled={working === d.id} onClick={() => aprobar(d)}>
                    Aprobar
                  </Button>
                  <Button size="sm" variant="outline" disabled={working === d.id} onClick={() => rechazar(d)}>
                    Rechazar
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <MapeoPrices tenant={tenant} products={products} plans={plans} />
    </div>
  )
}
