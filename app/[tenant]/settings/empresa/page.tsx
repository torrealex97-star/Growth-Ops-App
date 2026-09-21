'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Building2, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useTenantId } from '@/lib/tenant-context'
import { BusinessContextCard } from '@/components/settings/BusinessContextCard'
import { GrowthContextForm } from '@/components/settings/GrowthContextForm'

type Company = {
  name: string
  legal_name: string
  cif: string
  address: string
  postal_code: string
  city: string
  country: string
  representative: string
  email: string
  phone: string
  email_signature: string
}

const EMPTY: Company = {
  name: '',
  legal_name: '',
  cif: '',
  address: '',
  postal_code: '',
  city: '',
  country: 'España',
  representative: '',
  email: '',
  phone: '',
  email_signature: '',
}

export default function EmpresaSettingsPage() {
  const tenantId = useTenantId()
  const [c, setC] = useState<Company>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const sb = createClient()
    sb.from('company_profile')
      .select('*')
      .eq('id', 1)
      .eq('tenant_id', tenantId)
      .maybeSingle()
      .then(({ data }) => {
        if (data)
          setC({ ...EMPTY, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v ?? ''])) } as Company)
        setLoading(false)
      })
  }, [tenantId])

  const set = (k: keyof Company) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setC((prev) => ({ ...prev, [k]: e.target.value }))

  const save = async () => {
    if (!c.name.trim()) {
      toast.error('El nombre de la empresa es obligatorio')
      return
    }
    setSaving(true)
    const sb = createClient()
    const { error } = await sb
      .from('company_profile')
      .upsert({ id: 1, tenant_id: tenantId, ...c }, { onConflict: 'tenant_id' })
    setSaving(false)
    if (error) {
      toast.error('Error al guardar', { description: error.message })
      return
    }
    toast.success('Datos de empresa guardados', { description: 'Se usarán en los próximos contratos y emails.' })
  }

  const field = (k: keyof Company, label: string, placeholder = '') => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={c[k]} onChange={set(k)} className="bg-muted border-border" placeholder={placeholder} />
    </div>
  )

  if (loading) return <div className="h-64 bg-card rounded-lg animate-pulse" />

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center">
          <Building2 className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Datos de empresa</h1>
          <p className="text-muted-foreground text-sm">
            Se mapean automáticamente en los contratos ({'{{empresa}}'}, {'{{cif}}'}, {'{{empresa_direccion}}'},{' '}
            {'{{representante}}'}), en los emails y en los contenidos que genera la IA.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/50 p-6 space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          {field('name', 'Nombre comercial *', 'GrowthOps')}
          {field('legal_name', 'Razón social', 'GrowthOps S.L.')}
          {field('cif', 'CIF / NIF', 'B-12345678')}
          {field('representative', 'Representante (firma)', 'Nombre del administrador')}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {field('address', 'Dirección', 'Calle y número')}
          {field('postal_code', 'Código postal', '28001')}
          {field('city', 'Ciudad', 'Madrid')}
          {field('country', 'País', 'España')}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {field('email', 'Email de contacto', 'hola@growthops.com')}
          {field('phone', 'Teléfono', '+34 600 000 000')}
        </div>
        <div className="space-y-1.5">
          <Label>Firma del email (opcional)</Label>
          <Textarea
            value={c.email_signature}
            onChange={set('email_signature')}
            className="bg-muted border-border min-h-[80px]"
            placeholder={'Un saludo,\nEl equipo de GrowthOps'}
          />
          <p className="text-xs text-muted-foreground">Aparece al final del email de envío del contrato.</p>
        </div>
        <div className="flex justify-end pt-2">
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Guardando…
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Guardar
              </>
            )}
          </Button>
        </div>
      </div>

      <GrowthContextForm />

      {/* El contexto de negocio y los assets de marca estaban en Integraciones, donde no pintaban
          nada: no son una integración. Aquí quedan junto al resto de la identidad de la empresa. */}
      <BusinessContextCard />
    </div>
  )
}
