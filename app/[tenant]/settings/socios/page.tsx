'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Handshake, Plus, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTenantId } from '@/lib/tenant-context'

type Partner = {
  id: string
  name: string
  profit_percent: number
  notes: string | null
  is_active: boolean
}

const cls =
  'w-full bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500'

export default function SociosSettingsPage() {
  const tenantId = useTenantId()
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)

  const [nName, setNName] = useState('')
  const [nPercent, setNPercent] = useState('')
  const [nNotes, setNNotes] = useState('')
  const [adding, setAdding] = useState(false)

  const load = async () => {
    const sb = createClient()
    const { data, error } = await sb
      .from('partners')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('profit_percent', { ascending: false })
    if (error && /relation .* does not exist|partners/.test(error.message)) setTableMissing(true)
    setPartners((data as Partner[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const totalPercent = partners.filter((p) => p.is_active).reduce((sum, p) => sum + Number(p.profit_percent), 0)

  const addPartner = async () => {
    const name = nName.trim()
    const percent = parseFloat(nPercent)
    if (!name) {
      toast.error('Ponle nombre al socio')
      return
    }
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      toast.error('Indica un % de beneficio válido (0-100)')
      return
    }
    setAdding(true)
    const sb = createClient()
    const { data, error } = await sb
      .from('partners')
      .insert({
        name,
        profit_percent: percent,
        notes: nNotes.trim() || null,
        is_active: true,
        tenant_id: tenantId,
      })
      .select()
      .single()
    setAdding(false)
    if (error) {
      toast.error('No se pudo añadir el socio', { description: error.message })
      return
    }
    setPartners((prev) => [...prev, data as Partner].sort((a, b) => Number(b.profit_percent) - Number(a.profit_percent)))
    setNName('')
    setNPercent('')
    setNNotes('')
    toast.success('Socio añadido')
  }

  const toggleActive = async (p: Partner) => {
    const sb = createClient()
    const { error } = await sb
      .from('partners')
      .update({ is_active: !p.is_active })
      .eq('id', p.id)
      .eq('tenant_id', tenantId)
    if (error) {
      toast.error('No se pudo actualizar', { description: error.message })
      return
    }
    setPartners((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_active: !x.is_active } : x)))
  }

  const deletePartner = async (id: string) => {
    if (!window.confirm('¿Eliminar este socio?')) return
    const sb = createClient()
    const { error } = await sb.from('partners').delete().eq('id', id).eq('tenant_id', tenantId)
    if (error) {
      toast.error('No se pudo eliminar', { description: error.message })
      return
    }
    setPartners((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
          <Handshake className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Socios y reparto de beneficios</h1>
          <p className="text-muted-foreground text-sm">
            Gestiona los socios de esta cuenta y su % de participación en los beneficios.
          </p>
        </div>
      </div>

      {tableMissing && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          Falta aplicar la migración de socios en Supabase para activar esta sección.
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Socios</h2>
          {partners.length > 0 && (
            <span className={`text-xs ${totalPercent > 100 ? 'text-red-400' : 'text-muted-foreground'}`}>
              Total activo: {totalPercent.toFixed(2)}%{totalPercent > 100 ? ' — supera el 100%' : ''}
            </span>
          )}
        </div>

        {loading ? (
          <div className="h-20 bg-muted/50 rounded-lg animate-pulse" />
        ) : partners.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay socios. Añade el primero abajo.</p>
        ) : (
          <div className="space-y-2">
            {partners.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${p.is_active ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
                    {p.name}
                  </p>
                  {p.notes && <p className="text-xs text-muted-foreground truncate">{p.notes}</p>}
                </div>
                <span className="text-sm text-amber-300 font-semibold whitespace-nowrap">
                  {Number(p.profit_percent).toFixed(2)}%
                </span>
                <button
                  onClick={() => toggleActive(p)}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border"
                >
                  {p.is_active ? 'Desactivar' : 'Activar'}
                </button>
                <button onClick={() => deletePartner(p.id)} className="text-muted-foreground hover:text-red-400 p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-border pt-4 grid grid-cols-1 sm:grid-cols-[1fr,120px] gap-2 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Nombre del socio</label>
            <input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="Nombre" className={cls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">% de beneficio</label>
            <input
              value={nPercent}
              onChange={(e) => setNPercent(e.target.value)}
              type="number"
              min={0}
              max={100}
              step="0.01"
              placeholder="30"
              className={cls}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs text-muted-foreground">Notas (opcional)</label>
            <input value={nNotes} onChange={(e) => setNNotes(e.target.value)} placeholder="Notas…" className={cls} />
          </div>
          <Button onClick={addPartner} disabled={adding} className="bg-brand-600 hover:bg-brand-500 sm:col-span-2">
            {adding ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Plus className="w-4 h-4 mr-1" /> Añadir socio
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
