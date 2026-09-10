"use client"

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Users, Loader2, Save, Copy, Check, GripVertical, Database } from 'lucide-react'
import { toast } from 'sonner'
import type { AffiliateFormField, AffiliateProgramSettings } from '@/lib/types/database'

const DEFAULT_FIELDS: AffiliateFormField[] = [
  { key: 'full_name', label: 'Nombre completo', enabled: true, required: true, fixed: true },
  { key: 'email', label: 'Email', enabled: true, required: true, fixed: true },
  { key: 'phone', label: 'Teléfono (WhatsApp)', enabled: true, required: true },
  { key: 'instagram', label: 'Instagram / red principal', enabled: true, required: true },
  { key: 'audience_size', label: 'Tamaño de tu audiencia', enabled: true, required: false },
  { key: 'niche', label: 'Nicho / a qué te dedicas', enabled: true, required: false },
  { key: 'source', label: '¿Cómo nos conociste?', enabled: true, required: false },
  { key: 'motivation', label: 'Cuéntanos sobre ti', enabled: false, required: false },
]

type State = Pick<
  AffiliateProgramSettings,
  'default_commission_percent' | 'program_name' | 'intro' | 'success_message' | 'form_fields'
>

export default function AfiliadosSettingsPage() {
  const [s, setS] = useState<State>({
    default_commission_percent: 20,
    program_name: 'Programa de Afiliados',
    intro: '',
    success_message: '',
    form_fields: DEFAULT_FIELDS,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [publicUrl, setPublicUrl] = useState('')
  const [migrating, setMigrating] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPublicUrl(`${window.location.origin}/evergreen/afiliados/registro`)
    }
    const sb = createClient()
    sb.from('affiliate_program_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const row = data as AffiliateProgramSettings
          setS({
            default_commission_percent: Number(row.default_commission_percent ?? 20),
            program_name: row.program_name ?? 'Programa de Afiliados',
            intro: row.intro ?? '',
            success_message: row.success_message ?? '',
            form_fields:
              Array.isArray(row.form_fields) && row.form_fields.length ? row.form_fields : DEFAULT_FIELDS,
          })
        }
        setLoading(false)
      })
  }, [])

  const updateField = (i: number, patch: Partial<AffiliateFormField>) =>
    setS((prev) => ({
      ...prev,
      form_fields: prev.form_fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
    }))

  const save = async () => {
    if (s.default_commission_percent < 0 || s.default_commission_percent > 100) {
      toast.error('La comisión debe estar entre 0 y 100')
      return
    }
    setSaving(true)
    const sb = createClient()
    const { error } = await sb.from('affiliate_program_settings').upsert(
      {
        id: 1,
        default_commission_percent: s.default_commission_percent,
        program_name: s.program_name.trim() || 'Programa de Afiliados',
        intro: s.intro,
        success_message: s.success_message,
        form_fields: s.form_fields,
      },
      { onConflict: 'id' }
    )
    setSaving(false)
    if (error) {
      toast.error('Error al guardar', { description: error.message })
      return
    }
    toast.success('Ajustes del programa guardados')
  }

  const runMigration = async () => {
    setMigrating(true)
    try {
      const res = await fetch('/api/evergreen/admin/migrate-affiliates', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        toast.error('Error en la migración', { description: JSON.stringify(data.report ?? data.error) })
      } else {
        toast.success('Migración aplicada', { description: 'Tablas del programa de afiliados creadas.' })
      }
    } catch (e) {
      toast.error('Error al ejecutar la migración', { description: String(e) })
    }
    setMigrating(false)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      toast.success('Enlace copiado')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  if (loading) return <div className="h-64 bg-card rounded-lg animate-pulse" />

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
          <Users className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Programa de afiliados</h1>
          <p className="text-muted-foreground text-sm">
            Configura el formulario público de alta y la comisión por defecto de los nuevos afiliados.
          </p>
        </div>
      </div>

      {/* Migración de BBDD (crear tablas del programa) */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-amber-300/90">
          <Database className="w-4 h-4 shrink-0" />
          Si es la primera vez, crea las tablas del programa en la base de datos.
        </div>
        <Button variant="outline" size="sm" onClick={runMigration} disabled={migrating}>
          {migrating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
          Aplicar migración
        </Button>
      </div>

      {/* Enlace público */}
      <div className="rounded-lg border border-border bg-card/50 p-6 space-y-3">
        <Label>Enlace público de registro</Label>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={publicUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 bg-muted border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground truncate"
          />
          <Button variant="outline" size="icon" onClick={copyLink} title="Copiar">
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Envía este enlace a tus afiliados. Al enviar el formulario se dan de alta automáticamente y reciben
          un email para crear su contraseña.
        </p>
      </div>

      {/* Comisión + textos */}
      <div className="rounded-lg border border-border bg-card/50 p-6 space-y-4">
        <div className="space-y-1.5">
          <Label>Comisión por defecto (%)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.5"
            value={s.default_commission_percent}
            onChange={(e) => setS((p) => ({ ...p, default_commission_percent: Number(e.target.value) }))}
            className="bg-muted border-border max-w-[140px]"
          />
          <p className="text-xs text-muted-foreground">
            Se aplica a cada afiliado nuevo. Editable individualmente en Configuración → Usuarios.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Título del formulario</Label>
          <Input
            value={s.program_name}
            onChange={(e) => setS((p) => ({ ...p, program_name: e.target.value }))}
            className="bg-muted border-border"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Texto de introducción</Label>
          <Textarea
            value={s.intro}
            onChange={(e) => setS((p) => ({ ...p, intro: e.target.value }))}
            className="bg-muted border-border"
            rows={2}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Mensaje de éxito (tras registrarse)</Label>
          <Textarea
            value={s.success_message}
            onChange={(e) => setS((p) => ({ ...p, success_message: e.target.value }))}
            className="bg-muted border-border"
            rows={2}
          />
        </div>
      </div>

      {/* Campos del formulario */}
      <div className="rounded-lg border border-border bg-card/50 p-6 space-y-3">
        <div>
          <Label>Campos del formulario</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Activa/desactiva campos, márcalos como obligatorios y edita su etiqueta. Nombre y email siempre
            se piden (crean la cuenta).
          </p>
        </div>
        <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {s.form_fields.map((f, i) => (
            <div key={f.key} className="p-3 flex items-center gap-3">
              <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0 space-y-1">
                <Input
                  value={f.label}
                  onChange={(e) => updateField(i, { label: e.target.value })}
                  className="bg-muted border-border h-8 text-sm"
                />
                <p className="text-[10px] text-muted-foreground font-mono">{f.key}</p>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0">
                <Checkbox
                  checked={f.enabled}
                  disabled={f.fixed}
                  onCheckedChange={(c) => updateField(i, { enabled: c === true })}
                />
                Mostrar
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0">
                <Checkbox
                  checked={f.required}
                  disabled={f.fixed || !f.enabled}
                  onCheckedChange={(c) => updateField(i, { required: c === true })}
                />
                Obligatorio
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Guardar cambios
        </Button>
      </div>
    </div>
  )
}
