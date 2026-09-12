'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Gift, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTenantId } from '@/lib/tenant-context'

type ProductExtra = {
  id: string
  name: string
  description: string | null
  is_active: boolean
}

export function ProductExtrasManager() {
  const tenantId = useTenantId()
  const [extras, setExtras] = useState<ProductExtra[]>([])
  const [available, setAvailable] = useState<boolean | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchExtras = async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('product_extras')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) {
      setAvailable(false)
      return
    }
    setAvailable(true)
    setExtras((data as ProductExtra[]) ?? [])
  }

  useEffect(() => {
    fetchExtras()
  }, [])

  const addExtra = async () => {
    if (!name.trim()) {
      toast.error('Pon un nombre al extra')
      return
    }
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.from('product_extras').insert({
      name: name.trim(),
      description: description.trim() || null,
      is_active: true,
      tenant_id: tenantId,
    })
    setSaving(false)
    if (error) {
      toast.error('No se pudo crear', { description: error.message })
      return
    }
    setName('')
    setDescription('')
    toast.success('Extra creado')
    fetchExtras()
  }

  const toggleActive = async (e: ProductExtra) => {
    const supabase = createClient()
    await supabase.from('product_extras').update({ is_active: !e.is_active }).eq('id', e.id).eq('tenant_id', tenantId)
    fetchExtras()
  }

  const removeExtra = async (e: ProductExtra) => {
    const supabase = createClient()
    const { error } = await supabase.from('product_extras').delete().eq('id', e.id).eq('tenant_id', tenantId)
    if (error) {
      toast.error('No se pudo borrar', { description: error.message })
      return
    }
    fetchExtras()
  }

  if (available === false) return null

  return (
    <div className="rounded-xl border border-border bg-card/50 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Gift className="w-5 h-5 text-brand-400" />
        <h3 className="text-sm font-semibold text-foreground">Extras / bonus</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Extras que se pueden incluir en una venta (llamada 1-1, Honey, +1 mes de formación…). Aparecen en la venta y en
        el export de alumnos.
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre (ej. Llamada 1-1)"
          className="bg-muted border-border"
        />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descripción (opcional)"
          className="bg-muted border-border"
        />
        <Button onClick={addExtra} disabled={saving} className="shrink-0">
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Plus className="w-4 h-4 mr-1" />
              Añadir
            </>
          )}
        </Button>
      </div>

      {extras.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no hay extras.</p>
      ) : (
        <ul className="divide-y divide-border">
          {extras.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-2">
              <div>
                <span className={e.is_active ? 'text-foreground' : 'text-muted-foreground line-through'}>{e.name}</span>
                {e.description && <span className="text-xs text-muted-foreground ml-2">{e.description}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => toggleActive(e)}>
                  {e.is_active ? 'Desactivar' : 'Activar'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeExtra(e)}
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
