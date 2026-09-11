'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FileText, Plus, Edit2, Loader2, Trash2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { ContractTemplate } from '@/lib/types/database'
import { useTenant, useTenantId } from '@/lib/tenant-context'

// Variables disponibles para insertar en el cuerpo (clic para insertar).
const VARS: { v: string; help: string }[] = [
  { v: 'empresa', help: 'Razón social' },
  { v: 'cif', help: 'CIF/NIF' },
  { v: 'empresa_direccion', help: 'Dirección empresa' },
  { v: 'representante', help: 'Representante' },
  { v: 'nombre', help: 'Nombre firmante' },
  { v: 'email', help: 'Email firmante' },
  { v: 'producto', help: 'Producto / programa' },
  { v: 'duracion', help: 'Duración de acceso' },
  { v: 'importe', help: 'Importe total' },
  { v: 'forma_pago', help: 'Forma de pago' },
  { v: 'plan', help: 'Plan de pago' },
  { v: 'rol', help: 'Rol/puesto (equipo)' },
  { v: 'fecha', help: 'Fecha' },
  { v: 'dni', help: 'DNI (lo pone el firmante)' },
  { v: 'direccion', help: 'Dirección (firmante)' },
  { v: 'ciudad', help: 'Ciudad (firmante)' },
  { v: 'telefono', help: 'Teléfono (firmante)' },
]

const KINDS: { value: 'equipo' | 'alumno' | 'tomador' | 'colaborador' | 'colaborador'; label: string }[] = [
  { value: 'alumno', label: 'Alumno' },
  { value: 'tomador', label: 'Tomador (pagador)' },
  { value: 'equipo', label: 'Equipo' },
  { value: 'colaborador', label: 'Colaborador' },
]

// Métodos de pago que pueden tener una plantilla propia (solo alumno/tomador).
const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: '', label: 'Por defecto (cualquier método)' },
  { value: 'reserva', label: 'Reserva' },
  { value: 'sequra', label: 'Financiación Sequra' },
  { value: 'autofinanciado', label: 'Autofinanciado (a pulmón)' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'stripe', label: 'Tarjeta (Stripe)' },
  { value: 'full_pay', label: 'Pago único (full pay)' },
  { value: 'custom', label: 'Plan personalizado' },
]

const methodLabel = (m: string | null) => PAYMENT_METHODS.find((p) => p.value === (m ?? ''))?.label ?? m
const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? k

export default function PlantillasPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [templates, setTemplates] = useState<ContractTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<ContractTemplate | null>(null)
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'equipo' | 'alumno' | 'tomador' | 'colaborador'>('alumno')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [welcome, setWelcome] = useState('')
  const [roleKey, setRoleKey] = useState('')
  const [body, setBody] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const load = async () => {
    const sb = createClient()
    const { data } = await sb
      .from('contract_templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
    setTemplates((data ?? []) as ContractTemplate[])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const openNew = () => {
    setEditing(null)
    setName('')
    setKind('alumno')
    setPaymentMethod('')
    setWelcome('')
    setRoleKey('')
    setBody('')
    setDialog(true)
  }
  const openEdit = (t: ContractTemplate) => {
    setEditing(t)
    setName(t.name)
    setKind((t.kind as 'equipo' | 'alumno' | 'tomador' | 'colaborador') ?? 'alumno')
    setPaymentMethod(t.payment_method ?? '')
    setWelcome(t.welcome_message ?? '')
    setRoleKey(t.role_key ?? '')
    setBody(t.body)
    setDialog(true)
  }

  const insertVar = (v: string) => {
    const ta = bodyRef.current
    const token = `{{${v}}}`
    if (!ta) {
      setBody((b) => b + token)
      return
    }
    const start = ta.selectionStart ?? body.length
    const end = ta.selectionEnd ?? body.length
    const next = body.slice(0, start) + token + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + token.length
    })
  }

  const generateWithAI = async () => {
    if (!body.trim()) {
      toast.error('Pega primero el texto del contrato')
      return
    }
    setAiLoading(true)
    const res = await fetch(`/api/${tenant}/evergreen/contracts/templates/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: body }),
    })
    const d = await res.json()
    setAiLoading(false)
    if (!res.ok) {
      toast.error('No se pudo generar', { description: d.error })
      return
    }
    setBody(d.body)
    toast.success('Variables insertadas', { description: 'Revisa el resultado antes de guardar.' })
  }

  const save = async () => {
    if (!name.trim() || !body.trim()) {
      toast.error('Nombre y cuerpo son obligatorios')
      return
    }
    setSaving(true)
    const sb = createClient()
    const isStudentLike = kind === 'alumno' || kind === 'tomador'
    const payload = {
      name: name.trim(),
      kind,
      role_key: roleKey || null,
      payment_method: isStudentLike ? paymentMethod || null : null,
      welcome_message: isStudentLike ? welcome.trim() || null : null,
      body,
    }
    const { error } = editing
      ? await sb.from('contract_templates').update(payload).eq('id', editing.id).eq('tenant_id', tenantId)
      : await sb.from('contract_templates').insert({ ...payload, tenant_id: tenantId })
    setSaving(false)
    if (error) {
      toast.error('Error al guardar', { description: error.message })
      return
    }
    toast.success('Plantilla guardada')
    setDialog(false)
    load()
  }

  const remove = async (t: ContractTemplate) => {
    if (!confirm(`¿Eliminar la plantilla "${t.name}"?`)) return
    const sb = createClient()
    const { error } = await sb.from('contract_templates').delete().eq('id', t.id).eq('tenant_id', tenantId)
    if (error) {
      toast.error('No se pudo eliminar', { description: error.message })
      return
    }
    toast.success('Plantilla eliminada')
    load()
  }

  const isStudentLike = kind === 'alumno' || kind === 'tomador'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Plantillas de contrato</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Crea plantillas por tipo (alumno / tomador / equipo) y asócialas a un método de pago: al generar la venta se
            enviará la plantilla del método seleccionado.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="w-4 h-4 mr-2" />
          Nueva plantilla
        </Button>
      </div>

      {loading ? (
        <div className="h-48 bg-card rounded-lg animate-pulse" />
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No hay plantillas</h3>
          <p className="text-muted-foreground text-sm">Crea una plantilla de contrato.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-lg border border-border bg-card/50 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-foreground font-medium">{t.name}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge className="border text-xs bg-brand-700/30 text-brand-300 border-brand-600/40">
                      {kindLabel(t.kind)}
                    </Badge>
                    {(t.kind === 'alumno' || t.kind === 'tomador') && (
                      <Badge className="border text-xs bg-muted/40 text-foreground border-border">
                        {methodLabel(t.payment_method)}
                      </Badge>
                    )}
                    {t.role_key && (
                      <Badge className="border text-xs bg-muted/40 text-foreground border-border">{t.role_key}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(t)}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-400"
                    onClick={() => remove(t)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{t.body}</p>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="bg-card border-border text-foreground max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar plantilla' : 'Nueva plantilla'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-muted border-border"
                  placeholder="Contrato alumno — Sequra"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo de plantilla</Label>
                <Select
                  value={kind}
                  onValueChange={(v) => setKind(v as 'equipo' | 'alumno' | 'tomador' | 'colaborador')}
                >
                  <SelectTrigger className="bg-muted border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {KINDS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isStudentLike && (
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Método de pago asociado</Label>
                  <Select
                    value={paymentMethod || '__default'}
                    onValueChange={(v) => setPaymentMethod(v === '__default' ? '' : v)}
                  >
                    <SelectTrigger className="bg-muted border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m.value || '__default'} value={m.value || '__default'}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Se usará esta plantilla cuando la venta tenga ese método. &ldquo;Por defecto&rdquo; cubre los
                    métodos sin plantilla propia.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Mensaje de bienvenida (email)</Label>
                  <Textarea
                    value={welcome}
                    onChange={(e) => setWelcome(e.target.value)}
                    className="bg-muted border-border min-h-[70px] text-sm"
                    placeholder="¡Bienvenido Winner! Revisa y acepta las condiciones…"
                  />
                </div>
              </div>
            )}

            {(kind === 'equipo' || kind === 'colaborador') && (
              <div className="space-y-2">
                <Label>Rol sugerido (opcional)</Label>
                <Input
                  value={roleKey}
                  onChange={(e) => setRoleKey(e.target.value)}
                  className="bg-muted border-border"
                  placeholder="setter / closer / affiliate"
                />
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Cuerpo del contrato</Label>
                <Button type="button" variant="outline" size="sm" onClick={generateWithAI} disabled={aiLoading}>
                  {aiLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Generando…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                      Insertar variables con IA
                    </>
                  )}
                </Button>
              </div>
              <Textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="bg-muted border-border min-h-[280px] font-mono text-xs"
                placeholder="Pega aquí el texto del contrato… luego pulsa 'Insertar variables con IA' o inserta variables con los botones de abajo."
              />
              <div className="flex flex-wrap gap-1.5">
                {VARS.map(({ v, help }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVar(v)}
                    title={help}
                    className="text-[11px] font-mono px-2 py-1 rounded border border-border bg-muted text-foreground hover:border-border hover:text-foreground transition-colors"
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Las condiciones económicas y las firmas se añaden automáticamente al final del contrato.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setDialog(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  'Guardar'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
