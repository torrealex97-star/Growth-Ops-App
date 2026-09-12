'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import { DIAL_CODES, splitPhone, toE164 } from '@/lib/phone'

const contactSchema = z.object({
  first_name: z.string().min(1, 'El nombre es obligatorio'),
  last_name: z.string().optional().or(z.literal('')),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  phone_prefix: z.string().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  country: z.string().optional().or(z.literal('')),
  company_name: z.string().optional().or(z.literal('')),
  instagram: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
})

export type ContactFormData = z.infer<typeof contactSchema>

interface ContactFormProps {
  defaultValues?: Partial<ContactFormData>
  onSubmit: (data: ContactFormData) => Promise<void>
  onCancel?: () => void
  submitLabel?: string
  loading?: boolean
}

export function ContactForm({
  defaultValues,
  onSubmit,
  onCancel,
  submitLabel = 'Guardar',
  loading = false,
}: ContactFormProps) {
  // Si viene un teléfono ya guardado (ej. edición), lo partimos en prefijo + número.
  const initialSplit = splitPhone(defaultValues?.phone)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      ...(defaultValues ?? {}),
      phone: defaultValues?.phone ? initialSplit.national : (defaultValues?.phone ?? ''),
      phone_prefix: defaultValues?.phone_prefix || initialSplit.prefix,
    },
  })

  const isLoading = loading || isSubmitting

  // Combina prefijo + número en E.164 antes de entregar los datos al parent (que ya
  // no necesita saber nada del prefijo: recibe `phone` normalizado).
  const submit = (data: ContactFormData) => {
    const { phone_prefix, ...rest } = data
    const phone = data.phone?.trim() ? toE164(phone_prefix || '+34', data.phone) : ''
    return onSubmit({ ...rest, phone })
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="first_name">Nombre *</Label>
          <Input id="first_name" {...register('first_name')} placeholder="Carlos" className="bg-muted border-border" />
          {errors.first_name && <p className="text-xs text-red-400">{errors.first_name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="last_name">Apellidos</Label>
          <Input id="last_name" {...register('last_name')} placeholder="García" className="bg-muted border-border" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          {...register('email')}
          placeholder="carlos@empresa.com"
          className="bg-muted border-border"
        />
        {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="phone">Teléfono</Label>
          <div className="flex gap-2">
            <select
              id="phone_prefix"
              {...register('phone_prefix')}
              className="w-[7.5rem] shrink-0 rounded-md bg-muted border border-border px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {DIAL_CODES.map((d) => (
                <option key={`${d.iso}-${d.code}`} value={d.code}>
                  {d.label}
                </option>
              ))}
            </select>
            <Input
              id="phone"
              {...register('phone')}
              placeholder="600 000 000"
              className="bg-muted border-border"
              inputMode="tel"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="country">País</Label>
          <Input id="country" {...register('country')} placeholder="España" className="bg-muted border-border" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="company_name">Empresa</Label>
          <Input
            id="company_name"
            {...register('company_name')}
            placeholder="Empresa S.L."
            className="bg-muted border-border"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="instagram">Instagram</Label>
          <Input
            id="instagram"
            {...register('instagram')}
            placeholder="@usuario o enlace"
            className="bg-muted border-border"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notas</Label>
        <Textarea
          id="notes"
          {...register('notes')}
          placeholder="Información adicional..."
          className="bg-muted border-border min-h-[80px]"
        />
      </div>

      <div className="flex gap-3 justify-end pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Guardando...
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>
    </form>
  )
}
