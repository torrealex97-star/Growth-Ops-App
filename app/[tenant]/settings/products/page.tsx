"use client"

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, ChevronDown, ChevronRight, Edit2, Loader2, Package } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import type { Product, PaymentPlan } from '@/lib/types/database'
import { ProductExtrasManager } from '@/components/settings/ProductExtrasManager'

type ProductWithPlans = Product & { payment_plans: PaymentPlan[] }

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductWithPlans[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)
  const [productDialog, setProductDialog] = useState(false)
  const [planDialog, setPlanDialog] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [editingPlan, setEditingPlan] = useState<PaymentPlan | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Product form
  const [productName, setProductName] = useState('')
  const [productDesc, setProductDesc] = useState('')
  const [productDuration, setProductDuration] = useState('')

  // Plan form
  const [planName, setPlanName] = useState('')
  const [planCode, setPlanCode] = useState('')
  const [planGrossPrice, setPlanGrossPrice] = useState('')
  const [planPayments, setPlanPayments] = useState('1')
  const [planProvider, setPlanProvider] = useState('')
  const [planRatio, setPlanRatio] = useState('1')
  const [planSortOrder, setPlanSortOrder] = useState('0')

  const fetchData = async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('products')
      .select(`*, payment_plans(*)`)
      .order('name')

    if (error) {
      toast.error('Error al cargar productos')
    } else {
      setProducts((data ?? []) as ProductWithPlans[])
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const openNewProduct = () => {
    setEditingProduct(null)
    setProductName('')
    setProductDesc('')
    setProductDuration('')
    setProductDialog(true)
  }

  const openEditProduct = (p: Product) => {
    setEditingProduct(p)
    setProductName(p.name)
    setProductDesc(p.description ?? '')
    setProductDuration(p.duration_months !== null && p.duration_months !== undefined ? String(p.duration_months) : '')
    setProductDialog(true)
  }

  const openNewPlan = (productId: string) => {
    setEditingPlan(null)
    setSelectedProductId(productId)
    setPlanName('')
    setPlanCode('')
    setPlanGrossPrice('')
    setPlanPayments('1')
    setPlanProvider('')
    setPlanRatio('1')
    setPlanSortOrder('0')
    setPlanDialog(true)
  }

  const openEditPlan = (plan: PaymentPlan) => {
    setEditingPlan(plan)
    setSelectedProductId(plan.product_id)
    setPlanName(plan.name)
    setPlanCode(plan.code ?? '')
    setPlanGrossPrice(String(plan.gross_price))
    setPlanPayments(String(plan.number_of_payments))
    setPlanProvider(plan.financing_provider ?? '')
    setPlanRatio(String(plan.cash_collection_ratio))
    setPlanSortOrder(String(plan.sort_order))
    setPlanDialog(true)
  }

  const handleSaveProduct = async () => {
    if (!productName) return
    setSubmitting(true)
    const supabase = createClient()

    const durationMonths = productDuration.trim() === '' ? null : parseInt(productDuration, 10)

    if (editingProduct) {
      const { error } = await supabase
        .from('products')
        .update({ name: productName, description: productDesc || null, duration_months: durationMonths })
        .eq('id', editingProduct.id)

      if (error) {
        toast.error('Error al actualizar producto')
        setSubmitting(false)
        return
      }
      toast.success('Producto actualizado')
    } else {
      const { error } = await supabase
        .from('products')
        .insert({ name: productName, description: productDesc || null, duration_months: durationMonths, is_active: true })

      if (error) {
        toast.error('Error al crear producto', { description: error.message })
        setSubmitting(false)
        return
      }
      toast.success('Producto creado')
    }

    setSubmitting(false)
    setProductDialog(false)
    fetchData()
  }

  const handleSavePlan = async () => {
    if (!planName || !planGrossPrice || !selectedProductId) return
    setSubmitting(true)
    const supabase = createClient()

    const payload = {
      product_id: selectedProductId,
      name: planName,
      code: planCode || null,
      gross_price: parseFloat(planGrossPrice),
      number_of_payments: parseInt(planPayments),
      financing_provider: planProvider || null,
      cash_collection_ratio: parseFloat(planRatio),
      sort_order: parseInt(planSortOrder),
      is_active: true,
    }

    if (editingPlan) {
      const { error } = await supabase.from('payment_plans').update(payload).eq('id', editingPlan.id)
      if (error) {
        toast.error('Error al actualizar plan')
        setSubmitting(false)
        return
      }
      toast.success('Plan actualizado')
    } else {
      const { error } = await supabase.from('payment_plans').insert(payload)
      if (error) {
        toast.error('Error al crear plan', { description: error.message })
        setSubmitting(false)
        return
      }
      toast.success('Plan creado')
    }

    setSubmitting(false)
    setPlanDialog(false)
    fetchData()
  }

  const toggleProductActive = async (p: Product) => {
    const supabase = createClient()
    await supabase.from('products').update({ is_active: !p.is_active }).eq('id', p.id)
    fetchData()
  }

  const togglePlanActive = async (plan: PaymentPlan) => {
    const supabase = createClient()
    await supabase.from('payment_plans').update({ is_active: !plan.is_active }).eq('id', plan.id)
    fetchData()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Productos</h1>
          <p className="text-muted-foreground text-sm mt-1">Gestiona los productos y planes de pago</p>
        </div>
        <Button onClick={openNewProduct}>
          <Plus className="w-4 h-4 mr-2" />
          Nuevo Producto
        </Button>
      </div>

      <ProductExtrasManager />

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-card rounded-lg animate-pulse" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Package className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No hay productos</h3>
          <Button onClick={openNewProduct}>
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Producto
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {products.map((product) => (
            <div key={product.id} className="bg-card border border-border rounded-lg overflow-hidden">
              <div
                className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}
              >
                <div className="text-muted-foreground">
                  {expandedProduct === product.id
                    ? <ChevronDown className="w-4 h-4" />
                    : <ChevronRight className="w-4 h-4" />
                  }
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground">{product.name}</p>
                  {product.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{product.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={product.is_active ? 'success' : 'secondary'}>
                    {product.is_active ? 'Activo' : 'Inactivo'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {product.duration_months ? `${product.duration_months} meses` : '—'}
                  </span>
                  <span className="text-xs text-muted-foreground">{product.payment_plans?.length ?? 0} planes</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); openEditProduct(product) }}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {expandedProduct === product.id && (
                <div className="border-t border-border px-5 py-4">
                  <div className="flex justify-between items-center mb-3">
                    <p className="text-sm font-medium text-muted-foreground">Planes de Pago</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openNewPlan(product.id)}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Nuevo Plan
                    </Button>
                  </div>

                  {(!product.payment_plans || product.payment_plans.length === 0) ? (
                    <p className="text-muted-foreground text-sm">No hay planes de pago</p>
                  ) : (
                    <div className="space-y-2">
                      {product.payment_plans.map((plan) => (
                        <div
                          key={plan.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border ${
                            plan.is_active ? 'bg-muted border-border' : 'bg-card border-border opacity-60'
                          }`}
                        >
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground">{plan.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatCurrency(plan.gross_price)} — {plan.number_of_payments} pago{plan.number_of_payments > 1 ? 's' : ''}
                              {plan.financing_provider && ` — ${plan.financing_provider}`}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            ratio: {plan.cash_collection_ratio}
                          </span>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => togglePlanActive(plan)}
                              title={plan.is_active ? 'Desactivar' : 'Activar'}
                            >
                              <span className="text-xs">{plan.is_active ? 'OFF' : 'ON'}</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => openEditPlan(plan)}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Product Dialog */}
      <Dialog open={productDialog} onOpenChange={setProductDialog}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProduct ? 'Editar Producto' : 'Nuevo Producto'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input value={productName} onChange={(e) => setProductName(e.target.value)} className="bg-muted border-border" />
            </div>
            <div className="space-y-2">
              <Label>Descripcion</Label>
              <Textarea value={productDesc} onChange={(e) => setProductDesc(e.target.value)} className="bg-muted border-border min-h-[80px]" />
            </div>
            <div className="space-y-2">
              <Label>Duración (meses)</Label>
              <Input
                type="number"
                min="0"
                value={productDuration}
                onChange={(e) => setProductDuration(e.target.value)}
                className="bg-muted border-border"
                placeholder="Ej. 6"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setProductDialog(false)} disabled={submitting}>Cancelar</Button>
              <Button onClick={handleSaveProduct} disabled={submitting || !productName}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Guardar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Plan Dialog */}
      <Dialog open={planDialog} onOpenChange={setPlanDialog}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPlan ? 'Editar Plan' : 'Nuevo Plan de Pago'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Nombre *</Label>
                <Input value={planName} onChange={(e) => setPlanName(e.target.value)} className="bg-muted border-border" placeholder="1 pago" />
              </div>
              <div className="space-y-2">
                <Label>Codigo</Label>
                <Input value={planCode} onChange={(e) => setPlanCode(e.target.value)} className="bg-muted border-border" placeholder="1PAY" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Precio bruto *</Label>
                <Input type="number" min="0" step="0.01" value={planGrossPrice} onChange={(e) => setPlanGrossPrice(e.target.value)} className="bg-muted border-border" />
              </div>
              <div className="space-y-2">
                <Label>Nro pagos</Label>
                <Input type="number" min="1" value={planPayments} onChange={(e) => setPlanPayments(e.target.value)} className="bg-muted border-border" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Proveedor financiacion</Label>
                <Input value={planProvider} onChange={(e) => setPlanProvider(e.target.value)} className="bg-muted border-border" placeholder="Sequra" />
              </div>
              <div className="space-y-2">
                <Label>Ratio comisionable (0-1)</Label>
                <Input type="number" min="0" max="1" step="0.01" value={planRatio} onChange={(e) => setPlanRatio(e.target.value)} className="bg-muted border-border" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Orden</Label>
              <Input type="number" min="0" value={planSortOrder} onChange={(e) => setPlanSortOrder(e.target.value)} className="bg-muted border-border" />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setPlanDialog(false)} disabled={submitting}>Cancelar</Button>
              <Button onClick={handleSavePlan} disabled={submitting || !planName || !planGrossPrice}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Guardar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
