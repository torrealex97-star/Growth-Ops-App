"use client"

import { useForm, Controller } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Sparkles } from 'lucide-react'
import type { KpiFormTemplate } from '@/lib/types/database'

interface KPIFormProps {
  templates: KpiFormTemplate[]
  defaultValues?: Record<string, unknown>
  onSubmit: (data: Record<string, unknown>) => Promise<void>
  readOnly?: boolean
  loading?: boolean
  // Campos que se rellenan solos desde la app (agendas/ventas): se muestran de
  // solo lectura con su valor y siempre se guardan.
  autoFields?: Set<string>
  autoValues?: Record<string, number>
}

export function KPIForm({ templates, defaultValues = {}, onSubmit, readOnly = false, loading = false, autoFields, autoValues = {} }: KPIFormProps) {
  const { register, handleSubmit, control, formState: { isSubmitting } } = useForm({
    defaultValues,
  })

  const isLoading = loading || isSubmitting
  const isAuto = (key: string) => !!autoFields?.has(key)
  // Los valores automáticos se fuerzan al guardar, pase lo que pase en el form.
  const submit = (data: Record<string, unknown>) => onSubmit({ ...data, ...autoValues })

  const activeTemplates = templates
    .filter(t => t.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5">
      {activeTemplates.map((field) => (
        <div key={field.field_key} className="space-y-2">
          <Label htmlFor={field.field_key} className="flex items-center gap-2">
            {field.field_label}
            {field.is_required && !isAuto(field.field_key) && <span className="text-red-400 ml-1">*</span>}
            {isAuto(field.field_key) && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-500/20 text-brand-300 border border-brand-500/30">
                <Sparkles className="w-2.5 h-2.5" /> Automático
              </span>
            )}
          </Label>

          {field.help_text && (
            <p className="text-xs text-muted-foreground">{field.help_text}</p>
          )}

          {isAuto(field.field_key) ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2">
              <span className="text-sm text-foreground font-medium">{autoValues[field.field_key] ?? 0}</span>
              <span className="text-[11px] text-muted-foreground">calculado desde la app</span>
            </div>
          ) : (
          <>
          {field.field_type === 'number' && (
            <Input
              id={field.field_key}
              type="number"
              step="any"
              placeholder={field.placeholder ?? undefined}
              {...register(field.field_key, { required: field.is_required })}
              className="bg-muted border-border"
              disabled={readOnly || isLoading}
            />
          )}

          {field.field_type === 'text' && (
            <Input
              id={field.field_key}
              type="text"
              placeholder={field.placeholder ?? undefined}
              {...register(field.field_key, { required: field.is_required })}
              className="bg-muted border-border"
              disabled={readOnly || isLoading}
            />
          )}

          {field.field_type === 'textarea' && (
            <Textarea
              id={field.field_key}
              placeholder={field.placeholder ?? undefined}
              {...register(field.field_key, { required: field.is_required })}
              className="bg-muted border-border min-h-[80px]"
              disabled={readOnly || isLoading}
            />
          )}

          {field.field_type === 'date' && (
            <Input
              id={field.field_key}
              type="date"
              {...register(field.field_key, { required: field.is_required })}
              className="bg-muted border-border"
              disabled={readOnly || isLoading}
            />
          )}

          {field.field_type === 'boolean' && (
            <Controller
              name={field.field_key}
              control={control}
              render={({ field: controllerField }) => (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => !readOnly && controllerField.onChange(!controllerField.value)}
                    className={`w-10 h-6 rounded-full transition-colors ${
                      controllerField.value ? 'bg-brand-600' : 'bg-muted'
                    } ${readOnly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                    disabled={readOnly}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full mx-1 transition-transform ${
                      controllerField.value ? 'translate-x-4' : 'translate-x-0'
                    }`} />
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {controllerField.value ? 'Si' : 'No'}
                  </span>
                </div>
              )}
            />
          )}

          {field.field_type === 'select' && (
            <Controller
              name={field.field_key}
              control={control}
              rules={{ required: field.is_required }}
              render={({ field: controllerField }) => (
                <Select
                  value={String(controllerField.value ?? '')}
                  onValueChange={controllerField.onChange}
                  disabled={readOnly || isLoading}
                >
                  <SelectTrigger className="bg-muted border-border">
                    <SelectValue placeholder={field.placeholder ?? 'Seleccionar...'} />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {Array.isArray(field.select_options) && (field.select_options as string[]).map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}
          </>
          )}
        </div>
      ))}

      {!readOnly && (
        <div className="pt-2">
          <Button type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Guardando...
              </>
            ) : (
              'Guardar Informe KPI'
            )}
          </Button>
        </div>
      )}
    </form>
  )
}
