"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { X, Download } from 'lucide-react'
import { PERIOD_LABELS, type PeriodPreset } from '@/lib/filters/period'

export type PeriodFilterMember = { id: string; full_name: string }

type Props = {
  preset: PeriodPreset
  onPresetChange: (p: PeriodPreset) => void
  customFrom: string
  customTo: string
  onCustomFromChange: (v: string) => void
  onCustomToChange: (v: string) => void
  // Filtro por ROL (opcional). Si se pasa, aparece un selector de rol y la lista de personas
  // (members) debería venir ya acotada a ese rol por el padre.
  roles?: { key: string; label: string }[]
  role?: string
  onRoleChange?: (v: string) => void
  roleLabel?: string
  allRolesLabel?: string
  // Filtro por persona/equipo (opcional)
  members?: PeriodFilterMember[]
  member?: string
  onMemberChange?: (v: string) => void
  memberLabel?: string
  allMembersLabel?: string
  // Acciones (opcionales)
  onExport?: () => void
  onClear?: () => void
  hasActiveFilters?: boolean
  className?: string
}

// Barra de filtros unificada: Día/Semana/Mes/Trimestre/Año/Personalizado + persona/equipo + export.
export function PeriodFilterBar({
  preset, onPresetChange,
  customFrom, customTo, onCustomFromChange, onCustomToChange,
  roles, role, onRoleChange, roleLabel = 'Rol', allRolesLabel = 'Todos los roles',
  members, member, onMemberChange,
  memberLabel = 'Persona', allMembersLabel = 'Toda la empresa',
  onExport, onClear, hasActiveFilters, className = '',
}: Props) {
  return (
    <div className={`rounded-lg border border-border bg-card/50 p-4 space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Filtros</span>
        <div className="flex items-center gap-2">
          {onClear && hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={onClear}>
              <X className="w-3.5 h-3.5 mr-1" />
              Limpiar filtros
            </Button>
          )}
          {onExport && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onExport}>
              <Download className="w-3.5 h-3.5 mr-1" />
              Exportar CSV
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Periodo</Label>
          <Select value={preset} onValueChange={(v) => onPresetChange(v as PeriodPreset)}>
            <SelectTrigger className="bg-muted border-border h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((p) => (
                <SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {preset === 'day' && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Día</Label>
            <Input type="date" value={customFrom} onChange={(e) => onCustomFromChange(e.target.value)} className="bg-muted border-border h-9" />
          </div>
        )}

        {preset === 'custom' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Desde</Label>
              <Input type="date" value={customFrom} onChange={(e) => onCustomFromChange(e.target.value)} className="bg-muted border-border h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Hasta</Label>
              <Input type="date" value={customTo} onChange={(e) => onCustomToChange(e.target.value)} className="bg-muted border-border h-9" />
            </div>
          </>
        )}

        {roles && onRoleChange && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{roleLabel}</Label>
            <Select value={role ?? 'all'} onValueChange={onRoleChange}>
              <SelectTrigger className="bg-muted border-border h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">{allRolesLabel}</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {members && onMemberChange && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{memberLabel}</Label>
            <Select value={member ?? 'all'} onValueChange={onMemberChange}>
              <SelectTrigger className="bg-muted border-border h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">{allMembersLabel}</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  )
}
