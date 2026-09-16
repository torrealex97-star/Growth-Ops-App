'use client'

import { useId, type ReactNode } from 'react'
import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { CalendarPopover, DateRangeCalendarPopover } from '@/components/ui/calendar-popover'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarDays, Check, ChevronDown, X, Download } from 'lucide-react'
import {
  isDateRangeInvalid,
  PERIOD_LABELS,
  PERIOD_PRESETS_BAR,
  toDateInputValue,
  type PeriodPreset,
} from '@/lib/filters/period'

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
  children?: ReactNode
}

// Barra de filtros unificada: Día/Semana/Mes/Trimestre/Año/Personalizado + persona/equipo + export.
export function PeriodFilterBar({
  preset,
  onPresetChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  roles,
  role,
  onRoleChange,
  roleLabel = 'Rol',
  allRolesLabel = 'Todos los roles',
  members,
  member,
  onMemberChange,
  memberLabel = 'Persona',
  allMembersLabel = 'Toda la empresa',
  onExport,
  onClear,
  hasActiveFilters,
  className = '',
  children,
}: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const invalidRange = preset === 'custom' && isDateRangeInvalid(customFrom, customTo)

  const handlePresetChange = (next: PeriodPreset) => {
    if (next === 'day' && !customFrom) onCustomFromChange(toDateInputValue())
    onPresetChange(next)
    if (next !== 'custom' && next !== 'day') setOpen(false)
  }

  return (
    <div className={`dashboard-period-filter rounded-lg border border-border bg-card/50 p-4 space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Filtros</span>
        <div className="flex items-center gap-2">
          {onClear && hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={onClear}
            >
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
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-preset`} className="text-xs text-muted-foreground">
            Periodo
          </Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                id={`${id}-preset`}
                type="button"
                variant="outline"
                className="h-9 min-w-52 justify-between bg-muted text-left font-normal"
                aria-haspopup="dialog"
                aria-expanded={open}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <CalendarDays className="h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" />
                  <span className="truncate">{PERIOD_LABELS[preset]}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(calc(100vw-2rem),34rem)] p-3">
              <div className="mb-2">
                <p className="text-sm font-medium text-foreground">Selecciona un periodo</p>
                <p className="text-xs text-muted-foreground">Las métricas se actualizarán al elegir una opción.</p>
              </div>
              <div className="grid max-h-72 grid-cols-2 gap-1 overflow-y-auto pr-1 sm:grid-cols-3">
                {PERIOD_PRESETS_BAR.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={preset === p}
                    onClick={() => handlePresetChange(p)}
                    className="flex min-h-9 items-center justify-between rounded-md px-2.5 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 aria-pressed:bg-brand-500/15 aria-pressed:text-brand-300"
                  >
                    <span>{PERIOD_LABELS[p]}</span>
                    {preset === p && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                  </button>
                ))}
              </div>
              {(preset === 'day' || preset === 'custom') && (
                <div className="mt-3 border-t border-border pt-3">
                  <Label className="mb-1.5 block text-xs text-muted-foreground">
                    {preset === 'day' ? 'Día concreto' : 'Rango personalizado'}
                  </Label>
                  {preset === 'day' ? (
                    <CalendarPopover
                      value={customFrom || null}
                      onChange={onCustomFromChange}
                      disablePast={false}
                      placeholder="Seleccionar día…"
                      className="h-9"
                    />
                  ) : (
                    <DateRangeCalendarPopover
                      from={customFrom}
                      to={customTo}
                      onFromChange={onCustomFromChange}
                      onToChange={onCustomToChange}
                      className="h-9"
                    />
                  )}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>

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
                  <SelectItem key={r.key} value={r.key}>
                    {r.label}
                  </SelectItem>
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
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {children}
      </div>
      {invalidRange && (
        <p role="alert" className="text-xs text-amber-400">
          La fecha «Desde» debe ser anterior o igual a «Hasta».
        </p>
      )}
    </div>
  )
}
