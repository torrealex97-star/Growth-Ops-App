"use client"

import { useState } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Plus, Edit2, Loader2, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import type { KpiFormTemplate, KpiFieldType } from '@/lib/types/database'
import { useTenantId } from '@/lib/tenant-context'

const FIELD_TYPES: { value: KpiFieldType; label: string }[] = [
  { value: 'number', label: 'Numero' },
  { value: 'text', label: 'Texto' },
  { value: 'textarea', label: 'Texto largo' },
  { value: 'boolean', label: 'Si/No' },
  { value: 'select', label: 'Seleccion' },
  { value: 'date', label: 'Fecha' },
]

interface KPITemplateEditorProps {
  roleKey: string
  templates: KpiFormTemplate[]
  onUpdate: () => void
}

export function KPITemplateEditor({ roleKey, templates, onUpdate }: KPITemplateEditorProps) {
  const tenantId = useTenantId()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<KpiFormTemplate | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [fieldKey, setFieldKey] = useState('')
  const [fieldLabel, setFieldLabel] = useState('')
  const [fieldType, setFieldType] = useState<KpiFieldType>('number')
  const [placeholder, setPlaceholder] = useState('')
  const [helpText, setHelpText] = useState('')
  const [isRequired, setIsRequired] = useState(false)
  const [sortOrder, setSortOrder] = useState(templates.length + 1)

  const openNew = () => {
    setEditingTemplate(null)
    setFieldKey('')
    setFieldLabel('')
    setFieldType('number')
    setPlaceholder('')
    setHelpText('')
    setIsRequired(false)
    setSortOrder(templates.length + 1)
    setDialogOpen(true)
  }

  const openEdit = (t: KpiFormTemplate) => {
    setEditingTemplate(t)
    setFieldKey(t.field_key)
    setFieldLabel(t.field_label)
    setFieldType(t.field_type)
    setPlaceholder(t.placeholder ?? '')
    setHelpText(t.help_text ?? '')
    setIsRequired(t.is_required)
    setSortOrder(t.sort_order)
    setDialogOpen(true)
  }

  const handleToggleActive = async (t: KpiFormTemplate) => {
    const supabase = createClient()
    const { error } = await supabase
      .from('kpi_form_templates')
      .update({ is_active: !t.is_active })
      .eq('id', t.id)
      .eq('tenant_id', tenantId)

    if (error) {
      toast.error('Error al actualizar el campo')
      return
    }
    toast.success(`Campo ${t.is_active ? 'desactivado' : 'activado'}`)
    onUpdate()
  }

  const handleSubmit = async () => {
    if (!fieldKey || !fieldLabel) {
      toast.error('La clave y la etiqueta son obligatorias')
      return
    }

    setSubmitting(true)
    const supabase = createClient()

    const payload = {
      role_key: roleKey,
      field_key: fieldKey,
      field_label: fieldLabel,
      field_type: fieldType,
      placeholder: placeholder || null,
      help_text: helpText || null,
      is_required: isRequired,
      is_active: true,
      sort_order: sortOrder,
      select_options: null,
      default_value: null,
    }

    if (editingTemplate) {
      const { error } = await supabase
        .from('kpi_form_templates')
        .update(payload)
        .eq('id', editingTemplate.id)
        .eq('tenant_id', tenantId)

      if (error) {
        toast.error('Error al actualizar el campo')
        setSubmitting(false)
        return
      }
      toast.success('Campo actualizado')
    } else {
      const { error } = await supabase.from('kpi_form_templates').insert({ ...payload, tenant_id: tenantId })

      if (error) {
        toast.error('Error al crear el campo', { description: error.message })
        setSubmitting(false)
        return
      }
      toast.success('Campo creado')
    }

    setSubmitting(false)
    setDialogOpen(false)
    onUpdate()
  }

  const sorted = [...templates].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{templates.length} campos configurados</p>
        <Button size="sm" onClick={openNew}>
          <Plus className="w-4 h-4 mr-2" />
          Anadir Campo
        </Button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-8">No hay campos configurados para este rol</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((t) => (
            <div
              key={t.id}
              className={`flex items-center gap-3 p-3 rounded-lg border ${
                t.is_active ? 'bg-muted border-border' : 'bg-card border-border opacity-60'
              }`}
            >
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs w-6 shrink-0">
                #{t.sort_order}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{t.field_label}</p>
                <p className="text-xs text-muted-foreground">{t.field_key}</p>
              </div>
              <Badge variant="secondary" className="text-xs shrink-0">
                {FIELD_TYPES.find(f => f.value === t.field_type)?.label || t.field_type}
              </Badge>
              {t.is_required && (
                <Badge variant="outline" className="text-xs shrink-0 border-red-500/30 text-red-400">
                  Obligatorio
                </Badge>
              )}
              <div className="flex gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => handleToggleActive(t)}
                  title={t.is_active ? 'Desactivar' : 'Activar'}
                >
                  {t.is_active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => openEdit(t)}
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'Editar Campo' : 'Nuevo Campo KPI'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Clave del campo *</Label>
                <Input
                  value={fieldKey}
                  onChange={(e) => setFieldKey(e.target.value.toLowerCase().replace(/\s/g, '_'))}
                  className="bg-muted border-border"
                  placeholder="calls_made"
                  disabled={!!editingTemplate}
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select value={fieldType} onValueChange={(v) => setFieldType(v as KpiFieldType)}>
                  <SelectTrigger className="bg-muted border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {FIELD_TYPES.map(f => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Etiqueta *</Label>
              <Input
                value={fieldLabel}
                onChange={(e) => setFieldLabel(e.target.value)}
                className="bg-muted border-border"
                placeholder="Llamadas realizadas"
              />
            </div>

            <div className="space-y-2">
              <Label>Placeholder</Label>
              <Input
                value={placeholder}
                onChange={(e) => setPlaceholder(e.target.value)}
                className="bg-muted border-border"
                placeholder="Ej: 50"
              />
            </div>

            <div className="space-y-2">
              <Label>Texto de ayuda</Label>
              <Input
                value={helpText}
                onChange={(e) => setHelpText(e.target.value)}
                className="bg-muted border-border"
                placeholder="Descripcion del campo..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Orden</Label>
                <Input
                  type="number"
                  min="1"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(parseInt(e.target.value))}
                  className="bg-muted border-border"
                />
              </div>
              <div className="space-y-2">
                <Label>Obligatorio</Label>
                <button
                  type="button"
                  onClick={() => setIsRequired(!isRequired)}
                  className={`w-full h-10 rounded-md border text-sm transition-colors ${
                    isRequired
                      ? 'bg-brand-600/20 border-brand-500/30 text-brand-400'
                      : 'bg-muted border-border text-muted-foreground'
                  }`}
                >
                  {isRequired ? 'Si' : 'No'}
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Cancelar</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : 'Guardar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
