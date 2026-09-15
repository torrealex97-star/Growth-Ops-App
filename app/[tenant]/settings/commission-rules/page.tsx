'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus, Percent, Loader2, Pencil, Trash2 } from 'lucide-react'
import { formatDate, formatPercent } from '@/lib/utils'
import { toast } from 'sonner'
import type { CommissionRule, ParticipantType } from '@/lib/types/database'
import { useSesion, useTenantId } from '@/lib/tenant-context'

const PARTICIPANT_LABELS: Record<ParticipantType, string> = {
  setter: 'Setter',
  closer: 'Closer',
  affiliate: 'Afiliado',
}

const PARTICIPANT_COLORS: Record<ParticipantType, string> = {
  setter: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  closer: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  affiliate: 'bg-zinc-500/20 text-muted-foreground border-border/30',
}

type SimpleUser = {
  id: string
  full_name: string
  roles: { key: string } | { key: string }[] | null
}

type SimpleTramo = {
  id: string
  name: string
  emoji: string | null
}

const formatMoney = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default function CommissionRulesPage() {
  const tenantId = useTenantId()
  // Sesión ya resuelta por el layout: evita repetir auth.getUser() + from('users') aquí.
  const sesion = useSesion()
  const [rules, setRules] = useState<CommissionRule[]>([])
  const [users, setUsers] = useState<SimpleUser[]>([])
  const [tramos, setTramos] = useState<SimpleTramo[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [currentUserRole, setCurrentUserRole] = useState<string>('')

  // Edicion / borrado
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [ruleToDelete, setRuleToDelete] = useState<CommissionRule | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Form
  const [participantType, setParticipantType] = useState<ParticipantType>('closer')
  const [userId, setUserId] = useState<string>('all')
  const [minCash, setMinCash] = useState('0')
  const [maxCash, setMaxCash] = useState('')
  const [percent, setPercent] = useState('')
  const [label, setLabel] = useState('')
  const [tramoId, setTramoId] = useState<string>('none')
  const [activeFrom, setActiveFrom] = useState(new Date().toISOString().split('T')[0])
  const [activeTo, setActiveTo] = useState('')

  const isEditing = editingRuleId !== null
  const canManageRules = ['admin', 'director'].includes(currentUserRole)

  const fetchRules = async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('commission_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('participant_type')
      .order('min_cash', { ascending: true })

    if (error) {
      toast.error('Error al cargar reglas')
    } else {
      setRules(data ?? [])
    }
    setLoading(false)
  }

  const fetchUsers = async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, roles(key)')
      .eq('is_active', true)
      .order('full_name')

    if (!error) {
      setUsers((data as unknown as SimpleUser[]) ?? [])
    }
  }

  const fetchTramos = async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('sales_tramos')
      .select('id, name, emoji')
      .eq('is_active', true)
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })

    if (!error) {
      setTramos((data as unknown as SimpleTramo[]) ?? [])
    }
  }

  useEffect(() => {
    fetchRules()
    fetchUsers()
    fetchTramos()
    // El rol propio ya viene en la sesión: antes eran dos consultas en serie (`auth.getUser()` +
    // `from('users')`) para releer lo que el layout acababa de traer.
    setCurrentUserRole(sesion?.rol ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion])

  const getRoleKey = (u: SimpleUser): string | null => {
    if (!u.roles) return null
    if (Array.isArray(u.roles)) return u.roles[0]?.key ?? null
    return u.roles.key ?? null
  }

  const usersForType = useMemo(() => users.filter((u) => getRoleKey(u) === participantType), [users, participantType])

  const userNameById = useMemo(() => {
    const map = new Map<string, string>()
    users.forEach((u) => map.set(u.id, u.full_name))
    return map
  }, [users])

  const tramoNameById = useMemo(() => {
    const map = new Map<string, string>()
    tramos.forEach((t) => map.set(t.id, `${t.emoji ? `${t.emoji} ` : ''}${t.name}`))
    return map
  }, [tramos])

  // Al cambiar el tipo manualmente (no al precargar edicion), resetea el rep seleccionado si ya no aplica
  const skipUserResetRef = useRef(false)
  useEffect(() => {
    if (skipUserResetRef.current) {
      skipUserResetRef.current = false
      return
    }
    setUserId('all')
  }, [participantType])

  const resetForm = () => {
    setEditingRuleId(null)
    setParticipantType('closer')
    setUserId('all')
    setMinCash('0')
    setMaxCash('')
    setPercent('')
    setLabel('')
    setTramoId('none')
    setActiveFrom(new Date().toISOString().split('T')[0])
    setActiveTo('')
  }

  const openCreateDialog = () => {
    resetForm()
    setDialogOpen(true)
  }

  const openEditDialog = (rule: CommissionRule) => {
    skipUserResetRef.current = true
    setEditingRuleId(rule.id)
    setParticipantType(rule.participant_type)
    setUserId(rule.user_id ?? 'all')
    setMinCash(String(rule.min_cash ?? 0))
    setMaxCash(rule.max_cash !== null ? String(rule.max_cash) : '')
    setPercent(String(rule.percent ?? ''))
    setLabel(rule.label ?? '')
    setTramoId(rule.tramo_id ?? 'none')
    setActiveFrom(rule.active_from ? rule.active_from.split('T')[0] : new Date().toISOString().split('T')[0])
    setActiveTo(rule.active_to ? rule.active_to.split('T')[0] : '')
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!percent || !activeFrom) {
      toast.error('Completa todos los campos obligatorios')
      return
    }

    const min = minCash ? parseFloat(minCash) : 0
    const max = maxCash ? parseFloat(maxCash) : null

    if (max !== null && max <= min) {
      toast.error('El "Hasta" del tramo debe ser mayor que el "Desde"')
      return
    }

    setSubmitting(true)
    const supabase = createClient()

    const payload = {
      participant_type: participantType,
      user_id: userId === 'all' ? null : userId,
      percent: parseFloat(percent),
      min_cash: min,
      max_cash: max,
      label: label || null,
      tramo_id: tramoId === 'none' ? null : tramoId,
      active_from: activeFrom,
      active_to: activeTo || null,
    }

    const { error } = isEditing
      ? await supabase.from('commission_rules').update(payload).eq('id', editingRuleId).eq('tenant_id', tenantId)
      : await supabase.from('commission_rules').insert({ ...payload, is_active: true, tenant_id: tenantId })

    setSubmitting(false)
    if (error) {
      toast.error(isEditing ? 'Error al actualizar la regla' : 'Error al crear la regla', {
        description: error.message,
      })
      return
    }

    toast.success(isEditing ? 'Regla actualizada' : 'Regla creada')
    setDialogOpen(false)
    resetForm()
    fetchRules()
  }

  const handleDeleteRule = async () => {
    if (!ruleToDelete) return
    setDeleting(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('commission_rules')
      .delete()
      .eq('id', ruleToDelete.id)
      .eq('tenant_id', tenantId)

    setDeleting(false)
    if (error) {
      toast.error('Error al eliminar la regla', { description: error.message })
      return
    }

    toast.success('Regla eliminada')
    setRuleToDelete(null)
    fetchRules()
  }

  const toggleActive = async (rule: CommissionRule) => {
    const supabase = createClient()
    const { error } = await supabase
      .from('commission_rules')
      .update({ is_active: !rule.is_active })
      .eq('id', rule.id)
      .eq('tenant_id', tenantId)

    if (error) {
      toast.error('Error al actualizar la regla')
      return
    }
    fetchRules()
  }

  const sortedRules = useMemo(() => {
    return [...rules].sort((a, b) => {
      if (a.participant_type !== b.participant_type) {
        return a.participant_type.localeCompare(b.participant_type)
      }
      return a.min_cash - b.min_cash
    })
  }, [rules])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reglas de Comision</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configura porcentajes por tipo de participante, tramos de cash collected y reps concretos. Deja &quot;Activa
            hasta&quot; vacio para que la regla sea indefinida (de siempre).
          </p>
        </div>
        {canManageRules && (
          <Button onClick={openCreateDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Anadir Regla
          </Button>
        )}
      </div>

      {loading ? (
        <div className="h-48 bg-card rounded-lg animate-pulse" />
      ) : sortedRules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Percent className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No hay reglas configuradas</h3>
          {canManageRules && (
            <Button onClick={openCreateDialog}>
              <Plus className="w-4 h-4 mr-2" />
              Anadir Regla
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Tipo</TableHead>
                <TableHead className="text-muted-foreground">Rep</TableHead>
                <TableHead className="text-muted-foreground">Tramo cash collected</TableHead>
                <TableHead className="text-muted-foreground">Tramo gamificacion</TableHead>
                <TableHead className="text-muted-foreground">Etiqueta</TableHead>
                <TableHead className="text-muted-foreground">Porcentaje</TableHead>
                <TableHead className="text-muted-foreground">Vigencia</TableHead>
                <TableHead className="text-muted-foreground">Estado</TableHead>
                <TableHead className="text-muted-foreground">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRules.map((rule) => (
                <TableRow key={rule.id} className="border-border">
                  <TableCell>
                    <Badge className={`border text-xs ${PARTICIPANT_COLORS[rule.participant_type]}`}>
                      {PARTICIPANT_LABELS[rule.participant_type]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-foreground text-sm">
                    {rule.user_id ? (
                      (userNameById.get(rule.user_id) ?? 'Rep desconocido')
                    ) : (
                      <span className="text-muted-foreground">Todos</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {rule.max_cash !== null
                      ? `${formatMoney(rule.min_cash)}€ – ${formatMoney(rule.max_cash)}€`
                      : `${formatMoney(rule.min_cash)}€+`}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {rule.tramo_id ? (
                      <Badge variant="secondary" className="text-xs">
                        {tramoNameById.get(rule.tramo_id) ?? 'Tramo eliminado'}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {rule.label ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-foreground font-medium">{formatPercent(rule.percent)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(rule.active_from)} → {rule.active_to ? formatDate(rule.active_to) : 'sin caducidad'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={rule.is_active ? 'success' : 'secondary'}>
                      {rule.is_active ? 'Activa' : 'Inactiva'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canManageRules ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-muted-foreground hover:text-foreground text-xs"
                          onClick={() => toggleActive(rule)}
                        >
                          {rule.is_active ? 'Desactivar' : 'Activar'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => openEditDialog(rule)}
                          title="Editar regla"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-400/80 hover:text-red-300"
                          onClick={() => setRuleToDelete(rule)}
                          title="Eliminar regla"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) resetForm()
        }}
      >
        <DialogContent className="bg-card border-border text-foreground max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Editar Regla de Comision' : 'Anadir Regla de Comision'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Tipo de participante *</Label>
              <Select value={participantType} onValueChange={(v) => setParticipantType(v as ParticipantType)}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="setter">Setter</SelectItem>
                  <SelectItem value="closer">Closer</SelectItem>
                  <SelectItem value="affiliate">Afiliado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Rep concreto</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="all">Todos</SelectItem>
                  {usersForType.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                &quot;Todos&quot; aplica a cualquier {PARTICIPANT_LABELS[participantType].toLowerCase()} sin regla
                especifica propia.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Tramo de cash collected</Label>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={minCash}
                  onChange={(e) => setMinCash(e.target.value)}
                  className="bg-muted border-border"
                  placeholder="Desde (€)"
                />
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={maxCash}
                  onChange={(e) => setMaxCash(e.target.value)}
                  className="bg-muted border-border"
                  placeholder="Hasta (€) — vacio = sin limite"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                El % se aplica cuando el cash collected acumulado del rep esta dentro de este tramo.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Tramo de gamificacion</Label>
              <Select value={tramoId} onValueChange={setTramoId}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="none">Sin tramo (regla general)</SelectItem>
                  {tramos.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.emoji ? `${t.emoji} ` : ''}
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Si el rep esta en este tramo (nivel), este % gana sobre el modelo por cash collected.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Porcentaje (%) *</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                className="bg-muted border-border"
                placeholder="10.00"
              />
            </div>

            <div className="space-y-2">
              <Label>Etiqueta</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="bg-muted border-border"
                placeholder="Ej: Tramo 0-10k"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Activa desde *</Label>
                <Input
                  type="date"
                  value={activeFrom}
                  onChange={(e) => setActiveFrom(e.target.value)}
                  className="bg-muted border-border"
                />
              </div>
              <div className="space-y-2">
                <Label>Activa hasta</Label>
                <Input
                  type="date"
                  value={activeTo}
                  onChange={(e) => setActiveTo(e.target.value)}
                  className="bg-muted border-border"
                  placeholder="Vacio = indefinida / de siempre"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Vacio en &quot;Activa hasta&quot; significa que la regla es <strong>indefinida (de siempre)</strong>, sin
              fecha de caducidad.
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
                Cancelar
              </Button>
              <Button onClick={handleSubmit} disabled={submitting || !percent || !activeFrom}>
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {isEditing ? 'Guardando...' : 'Creando...'}
                  </>
                ) : isEditing ? (
                  'Guardar Cambios'
                ) : (
                  'Crear Regla'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={ruleToDelete !== null} onOpenChange={(open) => !open && setRuleToDelete(null)}>
        <AlertDialogContent className="bg-card border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar regla de comision</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Esta accion no se puede deshacer. Se eliminara la regla
              {ruleToDelete?.label ? ` "${ruleToDelete.label}"` : ''} para{' '}
              {ruleToDelete ? PARTICIPANT_LABELS[ruleToDelete.participant_type] : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRule}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Eliminando...
                </>
              ) : (
                'Eliminar'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
