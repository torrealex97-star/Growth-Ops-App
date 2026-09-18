'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, Search, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { calculateCommissionsForCollection } from '@/lib/commissions/calculator'
import { differenceInDays } from 'date-fns'
import { toast } from 'sonner'
import type { SaleWithRelations, CommissionRule } from '@/lib/types/database'
import { useTenant, useTenantId } from '@/lib/tenant-context'

const PAYMENT_METHODS = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'bizum', label: 'Bizum' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'sequra', label: 'Sequra' },
  { value: 'otro', label: 'Otro' },
]

export default function NewCollectionPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const router = useRouter()
  const [saleSearch, setSaleSearch] = useState('')
  const [saleResults, setSaleResults] = useState<SaleWithRelations[]>([])
  const [selectedSale, setSelectedSale] = useState<SaleWithRelations | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [rules, setRules] = useState<CommissionRule[]>([])
  const [cashByRep, setCashByRep] = useState<Record<string, number>>({})

  const [grossAmount, setGrossAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [collectedAt, setCollectedAt] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [hasEligiblePriorCollection, setHasEligiblePriorCollection] = useState(false)

  // Si venimos de "Registrar cobro" en una venta concreta, precarga esa venta directamente
  // en vez de dejar al usuario que la busque de nuevo por nombre/email.
  useEffect(() => {
    const saleId = new URLSearchParams(window.location.search).get('saleId')
    if (!saleId) return
    const loadSale = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('sales')
        .select(
          `*, contacts(*), products(*), payment_plans(*), setter:setter_id(id, full_name), closer:closer_id(id, full_name), affiliate:affiliate_id(id, full_name)`
        )
        .eq('id', saleId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (data) setSelectedSale(data as SaleWithRelations)
    }
    loadSale()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const fetchRules = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('commission_rules')
        .select('*')
        .eq('is_active', true)
        .eq('tenant_id', tenantId)
      setRules(data ?? [])
    }
    fetchRules()
  }, [tenantId])

  // Al elegir la venta, calcula el cash collected acumulado del setter y closer
  // (para que el calculador elija el tramo de comisión correcto).
  useEffect(() => {
    const loadRepCash = async () => {
      if (!selectedSale) {
        setCashByRep({})
        return
      }
      const supabase = createClient()
      const reps = [selectedSale.setter_id, selectedSale.closer_id].filter(Boolean) as string[]
      const acc: Record<string, number> = {}
      await Promise.all(
        reps.map(async (repId) => {
          const { data } = await supabase
            .from('collections')
            .select('commissionable_amount, sales!inner(setter_id, closer_id)')
            .or(`setter_id.eq.${repId},closer_id.eq.${repId}`, { foreignTable: 'sales' })
            .eq('status', 'collected')
            .eq('tenant_id', tenantId)
          acc[repId] = (data ?? []).reduce(
            (s, c: { commissionable_amount: number | string }) => s + Number(c.commissionable_amount || 0),
            0
          )
        })
      )
      setCashByRep(acc)
    }
    loadRepCash()
  }, [selectedSale, tenantId])

  // Plan personalizado: si esta venta ya tiene un cobro elegible previo (reserva/entrada u otra
  // cuota ya aprobada), este nuevo cobro NO debe comisionar automáticamente — va a revisión.
  useEffect(() => {
    const checkPriorEligible = async () => {
      if (!selectedSale || selectedSale.payment_plans?.method !== 'custom') {
        setHasEligiblePriorCollection(false)
        return
      }
      const supabase = createClient()
      const { data } = await supabase
        .from('collections')
        .select('id')
        .eq('sale_id', selectedSale.id)
        .eq('is_eligible_for_commission', true)
        .neq('status', 'reversed')
        .eq('tenant_id', tenantId)
        .limit(1)
      setHasEligiblePriorCollection(!!data && data.length > 0)
    }
    checkPriorEligible()
  }, [selectedSale, tenantId])

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
          `*, contacts(*), products(*), payment_plans(*), setter:setter_id(id, full_name), closer:closer_id(id, full_name), affiliate:affiliate_id(id, full_name)`
        )
        .or(`contacts.full_name.ilike.%${query}%,contacts.email.ilike.%${query}%`)
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

  const commissionableAmount =
    selectedSale && grossAmount ? parseFloat(grossAmount) * (selectedSale.payment_plans?.cash_collection_ratio ?? 1) : 0

  const feePercent = selectedSale?.payment_plans?.fee_percent ?? 0
  const processingFee = selectedSale && grossAmount ? parseFloat(grossAmount) * (feePercent / 100) : 0
  const netCashCollected = selectedSale && grossAmount ? parseFloat(grossAmount) - processingFee : 0

  const refundDeadline = selectedSale ? new Date(selectedSale.refund_deadline_at) : null
  const today = new Date(collectedAt)
  const daysUntilEligible = refundDeadline ? differenceInDays(refundDeadline, today) : null
  const isCustomPlan = selectedSale?.payment_plans?.method === 'custom'
  const needsCommissionReview = isCustomPlan && hasEligiblePriorCollection
  const isEligible = needsCommissionReview ? false : refundDeadline ? today >= refundDeadline : false

  const previewCommissions =
    selectedSale && grossAmount && !needsCommissionReview
      ? calculateCommissionsForCollection(
          tenantId,
          {
            id: 'preview',
            sale_id: selectedSale.id,
            expected_installment_id: null,
            collected_at: collectedAt,
            gross_amount: parseFloat(grossAmount),
            commissionable_amount: commissionableAmount,
            payment_method: paymentMethod,
            payment_provider: null,
            payment_reference: paymentReference,
            is_confirmed: true,
            is_eligible_for_commission: true,
            eligible_at: collectedAt,
            status: 'collected',
            notes: null,
            recovered: false,
            recovered_at: null,
            processing_fee: processingFee,
            extra_fee: 0,
            payment_channel: null,
            from_follow_up: false,
            vat: 0,
            invoice_link: null,
            billing_info: null,
            needs_commission_review: false,
            created_at: '',
            updated_at: '',
          },
          selectedSale,
          rules,
          cashByRep
        )
      : []

  const handleSubmit = async () => {
    if (!selectedSale || !grossAmount || !paymentMethod) {
      toast.error('Completa todos los campos obligatorios')
      return
    }

    setSubmitting(true)
    // Por la ruta canónica (POST /collections/record) en vez de insertar desde el navegador.
    //
    // POR QUÉ. Esta pantalla era una SEGUNDA implementación de "registrar un cobro", y peor: no
    // pasaba los tramos a la calculadora (así que un rep con regla por tramo cobraba el % genérico),
    // no recalculaba los tramos después, no resolvía la atribución por UTM (un setter atribuido por
    // enlace se quedaba sin comisión) y no avisaba a creatuagente. El mismo hecho de negocio daba
    // resultados distintos según por dónde entrara.
    const res = await fetch(`/api/${tenant}/evergreen/collections/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        saleId: selectedSale.id,
        grossAmount: parseFloat(grossAmount),
        commissionableAmount,
        method: paymentMethod,
        collectedAt: new Date(collectedAt).toISOString(),
        notes: notes || null,
        paymentReference: paymentReference || null,
      }),
    })
    const payload = (await res.json().catch(() => ({}))) as { error?: string; needsReview?: boolean }
    if (!res.ok) {
      toast.error('Error al registrar el cobro', { description: payload.error })
      setSubmitting(false)
      return
    }
    if (payload.needsReview) {
      toast.info('El cobro queda en revisión de cobros: es una cuota posterior de un plan personalizado')
    }

    toast.success('Cobro registrado correctamente')
    router.push(`/${tenant}/finanzas/cobros/cobros`)
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 text-muted-foreground hover:text-foreground"
          onClick={() => router.back()}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Registrar Cobro</h1>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-5">
        {/* Buscar venta */}
        <div className="space-y-2">
          <Label>Venta *</Label>
          {selectedSale ? (
            <div className="bg-muted border border-border rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-foreground">{selectedSale.contacts?.full_name}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedSale.payment_plans?.name} — {formatCurrency(selectedSale.gross_amount)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Plazo devolucion: {formatDate(selectedSale.refund_deadline_at)}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSelectedSale(null)}>
                Cambiar
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar venta por nombre de contacto..."
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
                        className="w-full text-left px-4 py-3 hover:bg-muted border-b border-border last:border-0 transition-colors"
                        onClick={() => {
                          setSelectedSale(s)
                          setSaleSearch('')
                          setSaleResults([])
                          setGrossAmount(String(s.gross_amount))
                        }}
                      >
                        <p className="text-foreground text-sm font-medium">{s.contacts?.full_name}</p>
                        <p className="text-muted-foreground text-xs">
                          {s.payment_plans?.name} — {formatCurrency(s.gross_amount)}
                        </p>
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
          <Label>Fecha del cobro *</Label>
          <Input
            type="date"
            value={collectedAt}
            onChange={(e) => setCollectedAt(e.target.value)}
            className="bg-muted border-border"
          />
        </div>

        {/* Importe */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Importe bruto *</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={grossAmount}
              onChange={(e) => setGrossAmount(e.target.value)}
              className="bg-muted border-border"
              placeholder="0.00"
            />
          </div>
          <div className="space-y-2">
            <Label>Importe comisionable</Label>
            <div className="h-10 bg-muted/50 border border-border rounded-md px-3 flex items-center text-foreground">
              {formatCurrency(commissionableAmount)}
            </div>
          </div>
        </div>

        {/* Comision plataforma */}
        {selectedSale && grossAmount && (
          <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Comisión plataforma ({feePercent}%)</span>
              <span className="text-red-400 font-medium">-{formatCurrency(processingFee)}</span>
            </div>
            <div className="flex justify-between text-sm pt-1 border-t border-border">
              <span className="text-muted-foreground">Cash collected neto (bruto − comisión)</span>
              <span className="text-emerald-400 font-medium">{formatCurrency(netCashCollected)}</span>
            </div>
          </div>
        )}

        {/* Metodo */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Metodo de pago *</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger className="bg-muted border-border">
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Referencia</Label>
            <Input
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              className="bg-muted border-border"
              placeholder="REF-001"
            />
          </div>
        </div>

        {/* Plan personalizado: cuota en revisión */}
        {selectedSale && needsCommissionReview && (
          <div className="rounded-lg p-4 border flex items-start gap-3 bg-blue-500/10 border-blue-500/30">
            <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-400">Cuota en revisión (plan personalizado)</p>
              <p className="text-xs text-blue-300/70 mt-0.5">
                Esta venta ya tiene un cobro comisionable (reserva/entrada). Este cobro se registrará pero NO generará
                comisión automáticamente: quedará en revisión de pagos hasta que el equipo lo apruebe manualmente.
              </p>
            </div>
          </div>
        )}

        {/* Elegibilidad */}
        {selectedSale && !needsCommissionReview && (
          <div
            className={`rounded-lg p-4 border flex items-start gap-3 ${
              isEligible ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'
            }`}
          >
            {isEligible ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-emerald-400">Elegible para comision</p>
                  <p className="text-xs text-emerald-300/70 mt-0.5">
                    El plazo de devolucion ya ha pasado. Se generaran comisiones.
                  </p>
                </div>
              </>
            ) : (
              <>
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-400">No elegible aun</p>
                  <p className="text-xs text-amber-300/70 mt-0.5">
                    Quedan {daysUntilEligible} dias para el plazo de devolucion (
                    {formatDate(refundDeadline?.toISOString())}).
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Preview comisiones */}
        {previewCommissions.length > 0 && (
          <div className="bg-muted border border-border rounded-lg p-4">
            <p className="text-sm font-medium text-foreground mb-3">Comisiones que se generaran:</p>
            <div className="space-y-2">
              {previewCommissions.map((com, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-muted-foreground capitalize">
                    {com.participant_type} ({com.percent}%)
                  </span>
                  <span className="text-emerald-400 font-medium">{formatCurrency(com.commission_amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notas */}
        <div className="space-y-2">
          <Label>Notas</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="bg-muted border-border min-h-[80px]"
            placeholder="Observaciones..."
          />
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !selectedSale || !grossAmount || !paymentMethod}>
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Registrando...
              </>
            ) : (
              'Registrar Cobro'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
