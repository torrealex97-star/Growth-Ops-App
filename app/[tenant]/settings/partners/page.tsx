"use client"

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Plus, Percent, Loader2, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import { formatPercent } from '@/lib/utils'
import { toast } from 'sonner'
import type { Partner } from '@/lib/types/database'

type SimpleUser = {
  id: string
  full_name: string
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [users, setUsers] = useState<SimpleUser[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form
  const [name, setName] = useState('')
  const [userId, setUserId] = useState<string>('none')
  const [profitPercent, setProfitPercent] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [notes, setNotes] = useState('')

  const fetchPartners = async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('partners')
      .select('*')
      .order('profit_percent', { ascending: false })

    if (error) {
      toast.error('Error al cargar socios')
    } else {
      setPartners(data ?? [])
    }
    setLoading(false)
  }

  const fetchUsers = async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('is_active', true)
      .order('full_name')

    if (!error) {
      setUsers((data as SimpleUser[]) ?? [])
    }
  }

  useEffect(() => {
    fetchPartners()
    fetchUsers()
  }, [])

  const userNameById = useMemo(() => {
    const map = new Map<string, string>()
    users.forEach((u) => map.set(u.id, u.full_name))
    return map
  }, [users])

  const totalPercent = useMemo(
    () => partners.reduce((a, p) => a + Number(p.profit_percent ?? 0), 0),
    [partners]
  )

  const resetForm = () => {
    setName('')
    setUserId('none')
    setProfitPercent('')
    setIsActive(true)
    setNotes('')
    setEditingId(null)
  }

  const openCreate = () => {
    resetForm()
    setDialogOpen(true)
  }

  const openEdit = (partner: Partner) => {
    setEditingId(partner.id)
    setName(partner.name)
    setUserId(partner.user_id ?? 'none')
    setProfitPercent(String(partner.profit_percent))
    setIsActive(partner.is_active)
    setNotes(partner.notes ?? '')
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!name || !profitPercent) {
      toast.error('Completa nombre y porcentaje de beneficio')
      return
    }

    const percentValue = parseFloat(profitPercent)
    if (isNaN(percentValue) || percentValue < 0 || percentValue > 100) {
      toast.error('El porcentaje debe estar entre 0 y 100')
      return
    }

    setSubmitting(true)
    const supabase = createClient()

    const payload = {
      name,
      user_id: userId === 'none' ? null : userId,
      profit_percent: percentValue,
      is_active: isActive,
      notes: notes || null,
    }

    const { error } = editingId
      ? await supabase.from('partners').update(payload).eq('id', editingId)
      : await supabase.from('partners').insert(payload)

    setSubmitting(false)
    if (error) {
      toast.error(editingId ? 'Error al actualizar el socio' : 'Error al crear el socio', {
        description: error.message,
      })
      return
    }

    toast.success(editingId ? 'Socio actualizado' : 'Socio creado')
    setDialogOpen(false)
    resetForm()
    fetchPartners()
  }

  const handleDelete = async (partner: Partner) => {
    if (!confirm(`¿Eliminar al socio "${partner.name}"?`)) return

    const supabase = createClient()
    const { error } = await supabase.from('partners').delete().eq('id', partner.id)

    if (error) {
      toast.error('Error al eliminar el socio', { description: error.message })
      return
    }
    toast.success('Socio eliminado')
    fetchPartners()
  }

  const toggleActive = async (partner: Partner) => {
    const supabase = createClient()
    const { error } = await supabase
      .from('partners')
      .update({ is_active: !partner.is_active })
      .eq('id', partner.id)

    if (error) {
      toast.error('Error al actualizar el socio')
      return
    }
    fetchPartners()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
            <Percent className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Socios</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Gestiona los socios y el porcentaje de reparto del resultado neto
            </p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />
          Añadir socio
        </Button>
      </div>

      {!loading && (
        <div
          className={`rounded-lg border p-4 text-sm flex items-center gap-2 ${
            Math.abs(totalPercent - 100) < 0.01
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
          }`}
        >
          {Math.abs(totalPercent - 100) >= 0.01 && <AlertTriangle className="w-4 h-4 shrink-0" />}
          {Math.abs(totalPercent - 100) < 0.01
            ? `Los porcentajes suman ${totalPercent.toFixed(2)}%. Correcto.`
            : `Los porcentajes suman ${totalPercent.toFixed(2)}% (deberían sumar 100%)`}
        </div>
      )}

      {loading ? (
        <div className="h-48 bg-card rounded-lg animate-pulse" />
      ) : partners.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Percent className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No hay socios configurados</h3>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Añadir socio
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Nombre</TableHead>
                <TableHead className="text-muted-foreground">Usuario vinculado</TableHead>
                <TableHead className="text-muted-foreground">% Beneficio</TableHead>
                <TableHead className="text-muted-foreground">Estado</TableHead>
                <TableHead className="text-muted-foreground">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.map((partner) => (
                <TableRow key={partner.id} className="border-border">
                  <TableCell className="text-foreground font-medium">{partner.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {partner.user_id ? (userNameById.get(partner.user_id) ?? 'Usuario desconocido') : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-foreground font-medium">
                    {formatPercent(partner.profit_percent)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={partner.is_active ? 'success' : 'secondary'}
                      className="cursor-pointer"
                      onClick={() => toggleActive(partner)}
                    >
                      {partner.is_active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-muted-foreground hover:text-foreground"
                        onClick={() => openEdit(partner)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-muted-foreground hover:text-red-400"
                        onClick={() => handleDelete(partner)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
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
            <DialogTitle>{editingId ? 'Editar socio' : 'Añadir socio'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-muted border-border"
                placeholder="Ej: Adrián Martínez"
              />
            </div>

            <div className="space-y-2">
              <Label>Usuario vinculado</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="none">Sin vincular</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>% Beneficio *</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={profitPercent}
                onChange={(e) => setProfitPercent(e.target.value)}
                className="bg-muted border-border"
                placeholder="55.00"
              />
            </div>

            <div className="space-y-2">
              <Label>Notas</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="bg-muted border-border"
                placeholder="Opcional"
              />
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <Checkbox
                id="partner-active"
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked === true)}
              />
              <Label htmlFor="partner-active" className="cursor-pointer">Socio activo</Label>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
                Cancelar
              </Button>
              <Button onClick={handleSubmit} disabled={submitting || !name || !profitPercent}>
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : editingId ? (
                  'Guardar cambios'
                ) : (
                  'Crear socio'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
