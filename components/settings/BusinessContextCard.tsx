'use client'

import { useCallback, useEffect, useState } from 'react'
import { ImagePlus, Loader2, Save, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useTenant } from '@/lib/tenant-context'

// Contexto de negocio y assets de marca. Vivía dentro de Configuración → Integraciones como un
// grupo más del catálogo, pero no es una integración: no hay credencial, ni conexión que probar, ni
// nada que sincronizar. Son datos de marca de la propia empresa, así que su sitio es Datos de
// empresa, junto al resto de la identidad que se mapea en contratos y emails.
//
// La PERSISTENCIA no cambia: sigue siendo integration_settings vía el endpoint de integraciones
// (IG_BUSINESS_CONTEXT y IG_BRAND_ASSETS siguen en el catálogo). Mover la pantalla no debe
// obligar a migrar datos ya guardados ni a tocar quien los lee (los carruseles/flyers de IA).
type BrandAsset = { url: string; name: string }
type StateEntry = { secret: boolean; value?: string }

export function BusinessContextCard() {
  const tenant = useTenant()
  const [context, setContext] = useState('')
  const [assets, setAssets] = useState<BrandAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [readable, setReadable] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones`)
    if (!r.ok) {
      // Solo admin/director pueden leer esta configuración. No es un error que haya que gritar:
      // simplemente esta parte de la pantalla no aplica, y decirlo es mejor que pintar vacío.
      setReadable(false)
      setLoading(false)
      return
    }
    const j = (await r.json()) as { state: Record<string, StateEntry> }
    setContext(j.state?.IG_BUSINESS_CONTEXT?.value ?? '')
    const raw = j.state?.IG_BRAND_ASSETS?.value
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setAssets(parsed)
      } catch {
        // Valor corrupto en base de datos: mejor lista vacía que romper la pantalla entera.
      }
    }
    setLoading(false)
  }, [tenant])

  useEffect(() => {
    void load()
  }, [load])

  const put = async (updates: Record<string, string>): Promise<boolean> => {
    const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      toast.error(j.error || 'No se pudo guardar')
      return false
    }
    return true
  }

  const saveContext = async () => {
    setSaving(true)
    const ok = await put({ IG_BUSINESS_CONTEXT: context })
    setSaving(false)
    if (ok) toast.success('Contexto de negocio guardado')
  }

  // Se guarda inmediatamente en vez de esperar al botón: el usuario acaba de subir o borrar un
  // archivo y espera que ese cambio ya esté hecho. Si el guardado falla se revierte el estado
  // local, para no dejar en pantalla un asset que en realidad no está guardado.
  const saveAssets = async (next: BrandAsset[]) => {
    const previous = assets
    setAssets(next)
    const ok = await put({ IG_BRAND_ASSETS: JSON.stringify(next) })
    if (!ok) setAssets(previous)
    return ok
  }

  const uploadAsset = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('purpose', 'brand-asset')
      const res = await fetch(`/api/${tenant}/evergreen/carruseles/upload`, { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Error al subir')
      if (await saveAssets([...assets, { url: j.url, name: j.name || file.name }])) {
        toast.success('Asset de marca añadido')
      }
    } catch (e) {
      toast.error('No se pudo subir el asset: ' + (e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  if (loading) return <div className="h-48 bg-card rounded-lg animate-pulse" />
  if (!readable) return null

  return (
    <div className="rounded-lg border border-border bg-card/50 p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
          <Sparkles className="w-4.5 h-4.5 text-violet-400" />
        </div>
        <div>
          <h2 className="font-semibold text-foreground">Voz, público y assets de marca</h2>
          <p className="text-sm text-muted-foreground">
            Lo usa la IA al generar guiones, carruseles y flyers para que suenen y se vean como tu marca.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="business-context">Voz de marca, público y funnel</Label>
        <Textarea
          id="business-context"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          className="bg-muted border-border min-h-[120px]"
          placeholder="Modelo de negocio, avatares a los que vendes y cómo es tu funnel."
        />
      </div>

      <div className="space-y-2 rounded-md border border-dashed border-border p-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Assets de marca (logos, fotos)</Label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            Añadir
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void uploadAsset(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Sube solo recursos sobre los que tengas permiso de uso. Se guardan al instante, sin pulsar Guardar.
        </p>
        {assets.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {assets.map((a, idx) => (
              <div key={`${a.url}-${idx}`} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt={a.name} className="h-12 w-12 rounded object-cover border border-border" />
                <button
                  type="button"
                  aria-label={`Quitar ${a.name}`}
                  onClick={() => void saveAssets(assets.filter((_, i) => i !== idx))}
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={saveContext} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Guardar contexto
        </Button>
      </div>
    </div>
  )
}
