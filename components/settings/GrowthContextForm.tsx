'use client'

import { useCallback, useEffect, useState } from 'react'
import { BrainCircuit, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { EstadoPanel } from '@/components/ui/carga/EstadoPanel'
import { useTenant } from '@/lib/tenant-context'
import { esFalloVisible, pedir, type Fallo } from '@/lib/ui/pedir'
import type { ContextoNegocio } from '@/lib/ai/agent/growth-operator'

type Campos = {
  business_type: string
  offer_name: string
  offer_price_eur: string
  sales_cycle_days: string
  target_monthly_revenue_eur: string
  target_ltgp_cac: string
  target_cash_roas: string
  capacity_calls_per_week: string
  capacity_active_clients: string
  avg_delivery_cost_eur: string
  notes: string
}

type Respuesta = { contexto: ContextoNegocio; puedeEditar: boolean }

const VACIO: Campos = {
  business_type: '',
  offer_name: '',
  offer_price_eur: '',
  sales_cycle_days: '',
  target_monthly_revenue_eur: '',
  target_ltgp_cac: '',
  target_cash_roas: '',
  capacity_calls_per_week: '',
  capacity_active_clients: '',
  avg_delivery_cost_eur: '',
  notes: '',
}

const textoInput = (valor: string | number | null): string => (valor === null ? '' : String(valor))

function desdeContexto(contexto: ContextoNegocio): Campos {
  return {
    business_type: textoInput(contexto.tipoNegocio),
    offer_name: textoInput(contexto.nombreOferta),
    offer_price_eur: textoInput(contexto.precioOfertaEur),
    sales_cycle_days: textoInput(contexto.cicloVentaDias),
    target_monthly_revenue_eur: textoInput(contexto.objetivoFacturacionMensualEur),
    target_ltgp_cac: textoInput(contexto.objetivoLtgpCac),
    target_cash_roas: textoInput(contexto.objetivoCashRoas),
    capacity_calls_per_week: textoInput(contexto.capacidadLlamadasSemana),
    capacity_active_clients: textoInput(contexto.capacidadClientesActivos),
    avg_delivery_cost_eur: textoInput(contexto.costeMedioEntregaEur),
    notes: textoInput(contexto.notas),
  }
}

type CampoNumero = {
  key: keyof Campos
  label: string
  help: string
  min: number
  max: number
  step: string
}

const OBJETIVOS: CampoNumero[] = [
  {
    key: 'target_monthly_revenue_eur',
    label: 'Facturación mensual objetivo (€)',
    help: 'Facturación contratada que quieres alcanzar cada mes.',
    min: 0.01,
    max: 100_000_000,
    step: '0.01',
  },
  {
    key: 'target_cash_roas',
    label: 'Cash ROAS objetivo',
    help: 'Cobros atribuidos por cada euro invertido en publicidad.',
    min: 0.01,
    max: 1000,
    step: '0.01',
  },
  {
    key: 'target_ltgp_cac',
    label: 'LTGP:CAC objetivo',
    help: 'Objetivo estratégico. La métrica REAL necesita además el coste de entrega de abajo — y aun con eso, calcular el LTV de por vida es un motor que todavía no está construido.',
    min: 0.01,
    max: 1000,
    step: '0.01',
  },
]

const COSTE_ENTREGA: CampoNumero = {
  key: 'avg_delivery_cost_eur',
  label: 'Coste medio de entrega por cliente (€)',
  help: 'Cuánto cuesta entregar tu oferta a UN cliente a lo largo de toda su vida (soporte, materiales, tiempo del equipo). Sin este número, LTGP:CAC no se puede calcular aunque haya facturación.',
  min: 0,
  max: 1_000_000,
  step: '0.01',
}

const CAPACIDAD: CampoNumero[] = [
  {
    key: 'capacity_calls_per_week',
    label: 'Llamadas disponibles por semana',
    help: 'Capacidad real del equipo comercial, no el objetivo de llamadas.',
    min: 1,
    max: 10_000,
    step: '1',
  },
  {
    key: 'capacity_active_clients',
    label: 'Clientes activos soportados',
    help: 'Techo operativo actual de entrega o acompañamiento.',
    min: 1,
    max: 1_000_000,
    step: '1',
  },
]

export function GrowthContextForm() {
  const tenant = useTenant()
  const [campos, setCampos] = useState<Campos>(VACIO)
  const [puedeEditar, setPuedeEditar] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<Fallo | null>(null)

  const cargar = useCallback(
    async (signal?: AbortSignal) => {
      setCargando(true)
      setError(null)
      try {
        const res = await pedir<Respuesta>(`/api/${tenant}/evergreen/ai/contexto`, { signal })
        if (!res.ok) {
          if (esFalloVisible(res)) setError(res)
          return
        }
        setCampos(desdeContexto(res.data.contexto))
        setPuedeEditar(res.data.puedeEditar)
      } finally {
        setCargando(false)
      }
    },
    [tenant]
  )

  useEffect(() => {
    const control = new AbortController()
    void cargar(control.signal)
    return () => control.abort()
  }, [cargar])

  const actualizar = (key: keyof Campos, value: string) => setCampos((actual) => ({ ...actual, [key]: value }))

  const guardar = async () => {
    setGuardando(true)
    try {
      const body = Object.fromEntries(
        Object.entries(campos).map(([key, value]) => [key, value.trim() === '' ? null : value.trim()])
      )
      const res = await pedir<{ contexto: ContextoNegocio }>(`/api/${tenant}/evergreen/ai/contexto`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        toast.error('No se pudo guardar el contexto estratégico', { description: res.mensaje })
        return
      }
      setCampos(desdeContexto(res.data.contexto))
      toast.success('Contexto estratégico guardado', {
        description: 'El Growth Brief y el agente usarán estos valores desde ahora.',
      })
    } finally {
      setGuardando(false)
    }
  }

  const campoNumero = ({ key, label, help, min, max, step }: CampoNumero) => (
    <div key={key} className="space-y-1.5">
      <Label htmlFor={`growth-${key}`}>{label}</Label>
      <Input
        id={`growth-${key}`}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={campos[key]}
        onChange={(event) => actualizar(key, event.target.value)}
        disabled={!puedeEditar}
        className="border-border bg-muted tabular-nums"
      />
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  )

  if (error) {
    return (
      <EstadoPanel
        estado={error.tipo === 'permiso' ? 'sin_permiso' : 'error'}
        que="el contexto estratégico"
        mensajeError={error.mensaje}
        onReintentar={error.reintentable ? () => void cargar() : undefined}
      />
    )
  }
  if (cargando) return <EstadoPanel estado="cargando" que="el contexto estratégico" filasSkeleton={4} />

  return (
    <section className="space-y-5 rounded-lg border border-border bg-card/50 p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--brand-500)/0.1)]">
          <BrainCircuit className="h-4.5 w-4.5 text-[hsl(var(--brand-500))]" aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-semibold text-foreground">Contexto estratégico del Growth Operator</h2>
          <p className="text-sm text-muted-foreground">
            Decisiones que no pueden deducirse de los históricos. Un campo vacío se trata como “sin configurar”, nunca
            como cero.
          </p>
        </div>
      </div>

      {!puedeEditar && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Puedes consultar estos valores. Solo dirección puede modificarlos.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="growth-business-type">Tipo de negocio</Label>
          <Input
            id="growth-business-type"
            value={campos.business_type}
            onChange={(event) => actualizar('business_type', event.target.value)}
            disabled={!puedeEditar}
            className="border-border bg-muted"
            placeholder="Ej. formación B2C, consultoría B2B"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="growth-offer-name">Oferta principal</Label>
          <Input
            id="growth-offer-name"
            value={campos.offer_name}
            onChange={(event) => actualizar('offer_name', event.target.value)}
            disabled={!puedeEditar}
            className="border-border bg-muted"
            placeholder="Nombre del programa o servicio"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="growth-offer-price">Precio comprometido de la oferta (€)</Label>
          <Input
            id="growth-offer-price"
            type="number"
            inputMode="decimal"
            min="0.01"
            max="1000000"
            step="0.01"
            value={campos.offer_price_eur}
            onChange={(event) => actualizar('offer_price_eur', event.target.value)}
            disabled={!puedeEditar}
            className="border-border bg-muted tabular-nums"
          />
          <p className="text-xs text-muted-foreground">Precio total pactado, no la cuota cobrada este mes.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="growth-sales-cycle">Ciclo de venta habitual (días)</Label>
          <Input
            id="growth-sales-cycle"
            type="number"
            inputMode="numeric"
            min="0"
            max="3650"
            step="1"
            value={campos.sales_cycle_days}
            onChange={(event) => actualizar('sales_cycle_days', event.target.value)}
            disabled={!puedeEditar}
            className="border-border bg-muted tabular-nums"
          />
        </div>
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="mb-3 text-sm font-medium text-foreground">Objetivos de economía</h3>
        <div className="grid gap-4 sm:grid-cols-2">{OBJETIVOS.map(campoNumero)}</div>
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="mb-3 text-sm font-medium text-foreground">Capacidad operativa</h3>
        <div className="grid gap-4 sm:grid-cols-2">{CAPACIDAD.map(campoNumero)}</div>
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="mb-3 text-sm font-medium text-foreground">Coste de entrega</h3>
        <div className="grid gap-4 sm:grid-cols-2">{campoNumero(COSTE_ENTREGA)}</div>
      </div>

      <div className="space-y-1.5 border-t border-border pt-5">
        <Label htmlFor="growth-notes">Notas para el agente</Label>
        <Textarea
          id="growth-notes"
          value={campos.notes}
          onChange={(event) => actualizar('notes', event.target.value)}
          disabled={!puedeEditar}
          maxLength={2000}
          className="min-h-[96px] border-border bg-muted"
          placeholder="Restricciones, estacionalidad o decisiones que el agente debe respetar."
        />
      </div>

      {puedeEditar && (
        <div className="flex justify-end">
          <Button onClick={() => void guardar()} disabled={guardando}>
            {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Guardar contexto estratégico
          </Button>
        </div>
      )}
    </section>
  )
}
