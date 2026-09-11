'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, X } from 'lucide-react'
import type { ContractTemplate } from '@/lib/types/database'
import type { ContractTerms, CommissionTier } from '@/lib/contracts/terms'
import { ROLE_LABELS, type AppRole } from '@/lib/auth/permissions'

// Roles seleccionables para el contrato (independiente del rol real del usuario).
export const CONTRACT_ROLES: AppRole[] = [
  'setter',
  'closer',
  'affiliate',
  'manager',
  'cold_caller',
  'triager',
  'csm',
  'editor',
  'marketing',
]

// Editor de condiciones de un contrato de equipo (rol + fijo + tramos + plantilla + título).
// Compartido por Contratos→Equipo y por el diálogo de invitar usuario, para que ambos usen
// exactamente la misma UI y no diverjan.
export function ContractTermsEditor({
  roleKey,
  onRoleChange,
  terms,
  onTermsChange,
  templateId,
  onTemplateChange,
  templates,
  title,
  onTitleChange,
}: {
  roleKey: AppRole | ''
  onRoleChange: (r: AppRole) => void
  terms: ContractTerms | null
  onTermsChange: (t: ContractTerms) => void
  templateId: string
  onTemplateChange: (id: string) => void
  templates: ContractTemplate[]
  title: string
  onTitleChange: (t: string) => void
}) {
  const setTier = (i: number, patch: Partial<CommissionTier>) => {
    if (!terms) return
    onTermsChange({ ...terms, commissions: terms.commissions.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) })
  }
  const addTier = () => {
    if (!terms) return
    onTermsChange({
      ...terms,
      commissions: [
        ...terms.commissions,
        { participant_type: terms.role_key ?? 'closer', label: null, min_cash: 0, max_cash: null, percent: 0 },
      ],
    })
  }
  const removeTier = (i: number) => {
    if (!terms) return
    onTermsChange({ ...terms, commissions: terms.commissions.filter((_, idx) => idx !== i) })
  }

  return (
    <>
      <div className="space-y-2">
        <Label>Rol en el contrato</Label>
        <Select value={roleKey} onValueChange={(v) => onRoleChange(v as AppRole)}>
          <SelectTrigger className="bg-muted border-border">
            <SelectValue placeholder="Seleccionar rol…" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            {CONTRACT_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Define qué condiciones de comisión se cargan. Puedes cambiarlo aunque no coincida con su rol actual.
        </p>
      </div>

      {terms && (
        <>
          <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Condiciones — confirma o edita
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Retribución fija (€/mes)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={terms.fixed_salary ?? ''}
                onChange={(e) =>
                  onTermsChange({ ...terms, fixed_salary: e.target.value ? parseFloat(e.target.value) : null })
                }
                className="bg-muted border-border"
                placeholder="750"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Comisiones por tramo (cash collected)</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-muted-foreground hover:text-foreground"
                  onClick={addTier}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Tramo
                </Button>
              </div>
              {terms.commissions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Sin tramos (rol sin reglas de comisión). Puedes añadir uno.
                </p>
              )}
              {terms.commissions.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={t.min_cash}
                    onChange={(e) => setTier(i, { min_cash: parseFloat(e.target.value) || 0 })}
                    className="bg-muted border-border h-8 text-xs"
                    placeholder="desde €"
                  />
                  <span className="text-muted-foreground text-xs">–</span>
                  <Input
                    type="number"
                    value={t.max_cash ?? ''}
                    onChange={(e) => setTier(i, { max_cash: e.target.value ? parseFloat(e.target.value) : null })}
                    className="bg-muted border-border h-8 text-xs"
                    placeholder="∞"
                  />
                  <Input
                    type="number"
                    step="0.1"
                    value={t.percent}
                    onChange={(e) => setTier(i, { percent: parseFloat(e.target.value) || 0 })}
                    className="bg-muted border-border h-8 text-xs w-20"
                    placeholder="%"
                  />
                  <span className="text-muted-foreground text-xs">%</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-400"
                    onClick={() => removeTier(i)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            {terms.role_key === 'affiliate' && (
              <div className="space-y-1.5">
                <Label className="text-xs">Comisión de afiliado (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={terms.affiliate_percent ?? ''}
                  onChange={(e) =>
                    onTermsChange({ ...terms, affiliate_percent: e.target.value ? parseFloat(e.target.value) : null })
                  }
                  className="bg-muted border-border"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Notas adicionales (opcional)</Label>
              <Textarea
                value={terms.extra_notes ?? ''}
                onChange={(e) => onTermsChange({ ...terms, extra_notes: e.target.value || null })}
                className="bg-muted border-border min-h-[60px] text-xs"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Plantilla</Label>
            <Select value={templateId} onValueChange={onTemplateChange}>
              <SelectTrigger className="bg-muted border-border">
                <SelectValue placeholder="Seleccionar plantilla…" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templates.length === 0 && (
              <p className="text-xs text-amber-400">No hay plantillas. Crea una en Contratos → Plantillas.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Título del contrato</Label>
            <Input value={title} onChange={(e) => onTitleChange(e.target.value)} className="bg-muted border-border" />
          </div>
        </>
      )}
    </>
  )
}
