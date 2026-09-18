'use client'

// OBJETIVOS DEL DASHBOARD (spec §27: los targets NO viven hardcodeados en el código).
//
// Edita la MISMA tabla `targets` que ya consumen el dashboard principal y el ranking vía
// `targetCurrentValue` (lib/analytics.ts): scope_type='company', metric_key del catálogo
// compartido (lib/targets/vs-actual.ts) y ventana [period_start, period_end] según period_type.
// Crear aquí un objetivo lo conecta al dashboard global sin tocar nada más — y borrarlo lo
// desconecta con la misma inmediatez. La escritura queda gated por la RLS de la tabla
// (is_admin_or_director): un rol sin permiso recibe el error del servidor, no una promesa falsa.

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSesion, useTenantId } from '@/lib/tenant-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Trash2, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { METRICAS_CON_OBJETIVO, valorTarget } from '@/lib/targets/vs-actual'
import { formatCurrency } from '@/lib/utils'

type TargetRow = {
  id: string
  name: string
  metric_key: string
  scope_type: string
  period_type: string
  period_start: string
  period_end: string
  target_value: number | string
  is_active: boolean
}

const PERIODOS = [
  { value: 'monthly', label: 'Mensual' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'annual', label: 'Anual' },
  { value: 'daily', label: 'Diario' },
]

// Ventana por defecto según el tipo de periodo, sobre partes UTC — las mismas convenciones de
// targetUnitBounds (lib/analytics.ts). Que el formulario proponga la ventana correcta evita
// objetivos "de este mes" creados con fechas del mes pasado por pereza de teclear.
const ymd = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

function ventanaPorDefecto(pt: string): { period_start: string; period_end: string } {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  switch (pt) {
    case 'daily':
      return { period_start: ymd(now), period_end: ymd(now) }
    case 'weekly': {
      const dow = now.getUTCDay() === 0 ? 7 : now.getUTCDay() // lunes = 1
      const start = new Date(now)
      start.setUTCDate(now.getUTCDate() - dow + 1)
      const end = new Date(start)
      end.setUTCDate(start.getUTCDate() + 6)
      return { period_start: ymd(start), period_end: ymd(end) }
    }
    case 'quarterly': {
      const q = Math.floor(m / 3)
      return {
        period_start: ymd(new Date(Date.UTC(y, q * 3, 1))),
        period_end: ymd(new Date(Date.UTC(y, q * 3 + 3, 0))),
      }
    }
    case 'annual':
      return { period_start: `${y}-01-01`, period_end: `${y}-12-31` }
    case 'monthly':
    default:
      return { period_start: ymd(new Date(Date.UTC(y, m, 1))), period_end: ymd(new Date(Date.UTC(y, m + 1, 0))) }
  }
}

const muestraValor = (tipo: string, v: number) =>
  tipo === 'money'
    ? formatCurrency(v)
    : tipo === 'ratio'
      ? `${v.toLocaleString('es-ES', { maximumFractionDigits: 2 })}x`
      : String(Math.round(v))

export function TargetEditor() {
  const tenantId = useTenantId()
  const sesion = useSesion()
  const [rows, setRows] = useState<TargetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TargetRow | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [metricKey, setMetricKey] = useState('revenue')
  const [periodType, setPeriodType] = useState('monthly')
  const [valor, setValor] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  const fetchTargets = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('targets')
      .select('id, name, metric_key, scope_type, period_type, period_start, period_end, target_value, is_active')
      .eq('tenant_id', tenantId)
      .eq('scope_type', 'company')
      .order('period_start', { ascending: false })

    if (error) {
      toast.error('Error al cargar los objetivos')
      return
    }
    setRows((data as TargetRow[]) || [])
    setLoading(false)
  }, [tenantId])

  useEffect(() => {
    fetchTargets()
  }, [fetchTargets])

  const openNew = () => {
    setEditing(null)
    setMetricKey('revenue')
    setPeriodType('monthly')
    setValor('')
    const v = ventanaPorDefecto('monthly')
    setDesde(v.period_start)
    setHasta(v.period_end)
    setDialogOpen(true)
  }

  const openEdit = (t: TargetRow) => {
    setEditing(t)
    setMetricKey(t.metric_key)
    setPeriodType(t.period_type || 'monthly')
    setValor(String(valorTarget(t) ?? ''))
    setDesde(t.period_start)
    setHasta(t.period_end)
    setDialogOpen(true)
  }

  const cambiarPeriodo = (pt: string) => {
    setPeriodType(pt)
    const v = ventanaPorDefecto(pt)
    setDesde(v.period_start)
    setHasta(v.period_end)
  }

  const guardar = async () => {
    if (!sesion) {
      toast.error('Sin sesión: no se puede atribuir el objetivo')
      return
    }
    const n = Number(valor.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Introduce un valor de objetivo válido')
      return
    }
    if (!desde || !hasta || desde > hasta) {
      toast.error('Revisa la ventana del objetivo')
      return
    }
    setSubmitting(true)
    const supabase = createClient()
    const metrica = METRICAS_CON_OBJETIVO.find((m) => m.key === metricKey)
    const payload = {
      name: metrica ? metrica.label : metricKey,
      metric_key: metricKey,
      scope_type: 'company',
      period_type: periodType,
      period_start: desde,
      period_end: hasta,
      target_value: n,
      is_active: true,
    }
    const { error } = editing
      ? await supabase.from('targets').update(payload).eq('id', editing.id).eq('tenant_id', tenantId)
      : await supabase.from('targets').insert({ ...payload, created_by: sesion.userId })

    setSubmitting(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success(editing ? 'Objetivo actualizado' : 'Objetivo creado')
    setDialogOpen(false)
    fetchTargets()
  }

  const borrar = async (t: TargetRow) => {
    const supabase = createClient()
    const { error } = await supabase.from('targets').delete().eq('id', t.id).eq('tenant_id', tenantId)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Objetivo eliminado')
    fetchTargets()
  }

  const alternarActivo = async (t: TargetRow) => {
    const supabase = createClient()
    const { error } = await supabase
      .from('targets')
      .update({ is_active: !t.is_active })
      .eq('id', t.id)
      .eq('tenant_id', tenantId)
    if (error) {
      toast.error('Error al actualizar el objetivo')
      return
    }
    fetchTargets()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground max-w-xl">
          Los objetivos alimentan las tarjetas del dashboard global (target vs actual, gap y color). Métrica sin
          objetivo: la tarjeta se muestra limpia, nunca un falso «0% del objetivo».
        </p>
        <Button onClick={openNew} size="sm">
          <Plus className="w-4 h-4 mr-1" /> Nuevo objetivo
        </Button>
      </div>

      {loading ? (
        <div className="h-40 bg-muted/40 rounded-lg animate-pulse" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Sin objetivos de dashboard. Crea uno y la tarjeta correspondiente empezará a comparar contra él.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((t) => {
            const metrica = METRICAS_CON_OBJETIVO.find((m) => m.key === t.metric_key)
            const v = valorTarget(t)
            const periodo = PERIODOS.find((p) => p.value === t.period_type)?.label ?? t.period_type
            return (
              <div
                key={t.id}
                className={`flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-4 py-3 ${t.is_active ? '' : 'opacity-50'}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {metrica?.label ?? t.name}
                    {!t.is_active && <span className="ml-2 text-xs text-muted-foreground">· inactivo</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {periodo} · {t.period_start} → {t.period_end}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {v !== null ? muestraValor(metrica?.tipo ?? 'count', v) : '—'}
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)} title="Editar">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => alternarActivo(t)}>
                    {t.is_active ? 'Desactivar' : 'Activar'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-400 hover:text-red-300"
                    onClick={() => borrar(t)}
                    title="Eliminar"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar objetivo' : 'Nuevo objetivo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Métrica</Label>
              <Select value={metricKey} onValueChange={setMetricKey}>
                <SelectTrigger>
                  <SelectValue placeholder="Elige la métrica" />
                </SelectTrigger>
                <SelectContent>
                  {METRICAS_CON_OBJETIVO.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {METRICAS_CON_OBJETIVO.find((m) => m.key === metricKey)?.descripcion}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Tipo de periodo</Label>
              <Select
                value={periodType}
                onValueChange={(v) => {
                  setMetricKey(metricKey)
                  cambiarPeriodo(v)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODOS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Desde</Label>
                <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Hasta</Label>
                <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Valor objetivo</Label>
              <Input
                inputMode="decimal"
                placeholder="p. ej. 30000"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
                Cancelar
              </Button>
              <Button onClick={guardar} disabled={submitting}>
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editing ? 'Guardar cambios' : 'Crear objetivo'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
