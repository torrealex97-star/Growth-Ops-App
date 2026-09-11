"use client"

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, Target, Loader2, Pencil, Trash2, History, Check, X, Clock } from 'lucide-react'
import { formatDate, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import type { Target as TargetType, User } from '@/lib/types/database'
import {
  targetCurrentWindow, targetValueBetween, targetHistory,
  type SaleRow, type CollectionRow, type AppointmentRow, type TargetData,
} from '@/lib/analytics'
import { useTenantId } from '@/lib/tenant-context'

const METRIC_OPTIONS = [
  { value: 'sales_count', label: 'Numero de ventas' },
  { value: 'cash_collected', label: 'Cobros totales' },
  { value: 'appointments_set', label: 'Agendas establecidas' },
  { value: 'shows', label: 'Shows' },
  { value: 'conversion_rate', label: 'Tasa de conversion' },
  { value: 'revenue', label: 'Ingresos brutos' },
]

const PERIOD_OPTIONS = [
  { value: 'daily', label: 'Diario' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensual' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'annual', label: 'Anual' },
]

export default function TargetsPage() {
  const tenantId = useTenantId()
  const [targets, setTargets] = useState<TargetType[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [sales, setSales] = useState<SaleRow[]>([])
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [appointments, setAppointments] = useState<AppointmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // --- Filtro por persona + expansión del historial ---
  const [member, setMember] = useState('all')
  const [historyOpen, setHistoryOpen] = useState<string | null>(null)

  // "Hoy" en fecha local (YYYY-MM-DD) para anclar las ventanas móviles de los objetivos.
  const todayStr = useMemo(() => {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
  }, [])

  // Form
  const [name, setName] = useState('')
  const [scopeType, setScopeType] = useState('company')
  const [scopeUserId, setScopeUserId] = useState('')
  const [scopeRoleKey, setScopeRoleKey] = useState('')
  const [metricKey, setMetricKey] = useState('')
  const [periodType, setPeriodType] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [targetValue, setTargetValue] = useState('')

  const fetchData = async () => {
    const supabase = createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) return

    const { data: userData } = await supabase.from('users').select('*, roles(key)').eq('id', authUser.id).single()
    const role = (userData as { roles?: { key?: string } })?.roles?.key ?? ''
    const isManager = ['admin', 'director'].includes(role)
    setCanManage(isManager)
    setCurrentUserId(authUser.id)

    let query = supabase.from('targets').select('*').eq('tenant_id', tenantId).eq('is_active', true).order('created_at', { ascending: false })
    if (!isManager) {
      // Un usuario ve: objetivos de empresa, los suyos propios y los de SU rol (p.ej. closer).
      const conds = ['scope_type.eq.company', `scope_user_id.eq.${authUser.id}`]
      if (role) conds.push(`and(scope_type.eq.role,scope_role_key.eq.${role})`)
      query = query.or(conds.join(','))
    }

    const [targetsRes, usersRes, salesRes, collRes, apptRes] = await Promise.all([
      query,
      supabase.from('users').select('*').eq('is_active', true),
      supabase.from('sales').select('id, gross_amount, status, sale_date, closer_id, setter_id, contact_id').eq('tenant_id', tenantId),
      supabase.from('collections').select('sale_id, gross_amount, collected_at, status').eq('tenant_id', tenantId),
      supabase.from('appointments').select('appointment_datetime, status, setter_id, closer_id').eq('tenant_id', tenantId),
    ])

    setTargets(targetsRes.data ?? [])
    setUsers(usersRes.data ?? [])
    setSales(salesRes.data ?? [])
    setCollections(collRes.data ?? [])
    setAppointments(apptRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [tenantId])

  // Cada objetivo filtra por su propia ventana (period_type) y su propio alcance (scope),
  // por eso el cálculo usa los datos completos y no se acota por la barra superior.
  const data: TargetData = useMemo(() => ({ sales, collections, appointments }), [sales, collections, appointments])

  // Filtro por persona: al elegir un miembro se muestran sus objetivos + los de empresa/rol.
  const visibleTargets = useMemo(() => {
    if (member === 'all') return targets
    return targets.filter((t) => t.scope_type !== 'user' || t.scope_user_id === member)
  }, [targets, member])

  const resetForm = () => {
    setName('')
    setScopeType('company')
    setScopeUserId('')
    setScopeRoleKey('')
    setMetricKey('')
    setPeriodType('')
    setPeriodStart('')
    setPeriodEnd('')
    setTargetValue('')
    setEditingId(null)
  }

  const openCreateDialog = () => {
    resetForm()
    setDialogOpen(true)
  }

  const openEditDialog = (t: TargetType) => {
    setEditingId(t.id)
    setName(t.name)
    setScopeType(t.scope_type)
    setScopeUserId(t.scope_user_id ?? '')
    setScopeRoleKey(t.scope_role_key ?? '')
    setMetricKey(t.metric_key)
    setPeriodType(t.period_type)
    setPeriodStart(t.period_start ? t.period_start.slice(0, 10) : '')
    setPeriodEnd(t.period_end ? t.period_end.slice(0, 10) : '')
    setTargetValue(String(t.target_value))
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!name || !metricKey || !periodType || !periodStart || !periodEnd || !targetValue) {
      toast.error('Completa todos los campos')
      return
    }

    setSubmitting(true)
    const supabase = createClient()
    const { data: authUser } = await supabase.auth.getUser()

    const payload = {
      name,
      scope_type: scopeType,
      scope_user_id: scopeType === 'user' ? scopeUserId || null : null,
      scope_role_key: scopeType === 'role' ? scopeRoleKey || null : null,
      metric_key: metricKey,
      period_type: periodType,
      period_start: periodStart,
      period_end: periodEnd,
      target_value: parseFloat(targetValue),
    }

    const { error } = editingId
      ? await supabase.from('targets').update(payload).eq('id', editingId).eq('tenant_id', tenantId)
      : await supabase.from('targets').insert({
          ...payload,
          is_active: true,
          created_by: authUser.user?.id ?? '',
          tenant_id: tenantId,
        })

    setSubmitting(false)
    if (error) {
      toast.error(editingId ? 'Error al actualizar el objetivo' : 'Error al crear el objetivo', { description: error.message })
      return
    }

    toast.success(editingId ? 'Objetivo actualizado' : 'Objetivo creado')
    setDialogOpen(false)
    resetForm()
    fetchData()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este objetivo? Esta acción no se puede deshacer.')) return

    setDeletingId(id)
    const supabase = createClient()
    const { error } = await supabase.from('targets').delete().eq('id', id).eq('tenant_id', tenantId)
    setDeletingId(null)

    if (error) {
      toast.error('Error al eliminar el objetivo', { description: error.message })
      return
    }

    toast.success('Objetivo eliminado')
    fetchData()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Objetivos</h1>
          <p className="text-muted-foreground text-sm mt-1">Seguimiento de metas del equipo</p>
        </div>
        {canManage && (
          <Button onClick={openCreateDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Objetivo
          </Button>
        )}
      </div>

      {canManage && users.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Persona</span>
          <Select value={member} onValueChange={setMember}>
            <SelectTrigger className="bg-muted border-border w-60"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">Toda la empresa</SelectItem>
              {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-36 bg-card rounded-lg animate-pulse" />
          ))}
        </div>
      ) : visibleTargets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Target className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No hay objetivos</h3>
          <p className="text-muted-foreground text-sm">Crea objetivos para el equipo o usuarios especificos</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleTargets.map((t) => {
            const metric = METRIC_OPTIONS.find(m => m.value === t.metric_key)
            const period = PERIOD_OPTIONS.find(p => p.value === t.period_type)
            const isMoney = ['revenue', 'cash_collected'].includes(t.metric_key)
            const isPct = t.metric_key === 'conversion_rate'
            const fmtVal = (n: number) =>
              isMoney ? formatCurrency(n) : isPct ? `${n.toFixed(0)}%` : Math.round(n).toLocaleString('es-ES')

            // Progreso de la VENTANA VIGENTE (hoy / esta semana / este mes…), no de todo el rango.
            const { window, state } = targetCurrentWindow(t, todayStr)
            const currentValue = targetValueBetween(t, data, window.start, window.end)
            const progress = Math.min((currentValue / Number(t.target_value)) * 100, 100)
            const stateLabel = state === 'active' ? 'Vigente' : state === 'ended' ? 'Finalizado' : 'Próximo'
            const stateClass = state === 'active' ? 'bg-emerald-500/15 text-emerald-400'
              : state === 'ended' ? 'bg-muted text-muted-foreground' : 'bg-amber-500/15 text-amber-400'

            const history = historyOpen === t.id ? targetHistory(t, data, todayStr) : []

            return (
              <div key={t.id} className="bg-card border border-border rounded-lg p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-medium text-foreground text-sm">{t.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{metric?.label || t.metric_key}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {period?.label || t.period_type}
                    </span>
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditDialog(t)}
                          className="text-muted-foreground hover:text-foreground transition-colors p-1"
                          title="Editar objetivo"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          disabled={deletingId === t.id}
                          className="text-muted-foreground hover:text-red-400 transition-colors p-1 disabled:opacity-50"
                          title="Eliminar objetivo"
                        >
                          {deletingId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Ventana vigente + estado */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">Periodo actual: <span className="text-foreground">{window.label}</span></span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${stateClass}`}>{stateLabel}</span>
                </div>

                {/* Progress bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground">{fmtVal(currentValue)}</span>
                    <span className="text-muted-foreground">/ {fmtVal(Number(t.target_value))}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${progress >= 100 ? 'bg-emerald-500' : progress >= 60 ? 'bg-brand-500' : 'bg-amber-500'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 text-right">{progress.toFixed(0)}%</p>
                </div>

                <div className="flex justify-between items-center text-xs text-muted-foreground">
                  <span>Vigencia: {formatDate(t.period_start)} → {formatDate(t.period_end)}</span>
                  <button
                    onClick={() => setHistoryOpen(historyOpen === t.id ? null : t.id)}
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <History className="w-3.5 h-3.5" /> Historial
                  </button>
                </div>

                {/* Historial de periodos */}
                {historyOpen === t.id && (
                  <div className="mt-3 border-t border-border pt-3 space-y-1.5 max-h-64 overflow-y-auto">
                    {history.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-2">Sin periodos.</p>
                    ) : history.slice().reverse().map((h, i) => {
                      const icon = h.status === 'met' ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                        : h.status === 'missed' ? <X className="w-3.5 h-3.5 text-red-400" />
                        : h.status === 'current' ? <Clock className="w-3.5 h-3.5 text-brand-400" />
                        : <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      const cls = h.status === 'current' ? 'text-foreground'
                        : h.status === 'pending' ? 'text-muted-foreground' : 'text-muted-foreground'
                      return (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5">{icon}<span className={cls}>{h.window.label}</span></span>
                          <span className={cls}>
                            {h.status === 'pending' ? '—' : fmtVal(h.value)} / {fmtVal(h.goal)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm() }}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Objetivo' : 'Nuevo Objetivo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-muted border-border" placeholder="Ej: Ventas mensuales" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Alcance *</Label>
                <Select value={scopeType} onValueChange={setScopeType}>
                  <SelectTrigger className="bg-muted border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="company">Empresa</SelectItem>
                    <SelectItem value="role">Rol</SelectItem>
                    <SelectItem value="user">Usuario</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {scopeType === 'role' && (
                <div className="space-y-2">
                  <Label>Rol</Label>
                  <Select value={scopeRoleKey} onValueChange={setScopeRoleKey}>
                    <SelectTrigger className="bg-muted border-border">
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="setter">Setter</SelectItem>
                      <SelectItem value="closer">Closer</SelectItem>
                      <SelectItem value="affiliate">Afiliado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {scopeType === 'user' && (
                <div className="space-y-2">
                  <Label>Usuario</Label>
                  <Select value={scopeUserId} onValueChange={setScopeUserId}>
                    <SelectTrigger className="bg-muted border-border">
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Metrica *</Label>
                <Select value={metricKey} onValueChange={setMetricKey}>
                  <SelectTrigger className="bg-muted border-border">
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {METRIC_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Periodo *</Label>
                <Select value={periodType} onValueChange={setPeriodType}>
                  <SelectTrigger className="bg-muted border-border">
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {PERIOD_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Fecha inicio *</Label>
                <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="bg-muted border-border" />
              </div>
              <div className="space-y-2">
                <Label>Fecha fin *</Label>
                <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="bg-muted border-border" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Valor objetivo *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                className="bg-muted border-border"
                placeholder="100"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm() }} disabled={submitting}>Cancelar</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{editingId ? 'Guardando...' : 'Creando...'}</>
                  : (editingId ? 'Guardar Cambios' : 'Crear Objetivo')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
