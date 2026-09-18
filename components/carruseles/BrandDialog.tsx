'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { BrandConfig } from '@/lib/carruseles/types'
import { DEFAULT_BRAND } from '@/lib/carruseles/types'
import { useTenant } from '@/lib/tenant-context'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
}

const COLOR_FIELDS: { key: keyof BrandConfig['colors']; label: string }[] = [
  { key: 'primary', label: 'Primario' },
  { key: 'secondary', label: 'Secundario' },
  { key: 'accent', label: 'Acento' },
  { key: 'background', label: 'Fondo' },
  { key: 'surface', label: 'Superficie' },
]

export function BrandDialog({ open, onOpenChange }: Props) {
  const tenant = useTenant()
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`/api/${tenant}/evergreen/carruseles/brand`)
      .then((r) => r.json())
      .then((b) =>
        setBrand({
          ...DEFAULT_BRAND,
          ...b,
          colors: { ...DEFAULT_BRAND.colors, ...b.colors },
          fonts: { ...DEFAULT_BRAND.fonts, ...b.fonts },
        })
      )
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, tenant])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/carruseles/brand`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(brand),
      })
      if (!res.ok) throw new Error('Error al guardar')
      toast.success('Marca guardada')
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configuración de marca</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre / marca</label>
              <Input
                value={brand.name}
                onChange={(e) => setBrand({ ...brand, name: e.target.value })}
                placeholder="Tu marca"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Colores</label>
              <div className="grid grid-cols-5 gap-2 mt-1">
                {COLOR_FIELDS.map((c) => (
                  <div key={c.key} className="flex flex-col items-center gap-1">
                    <input
                      type="color"
                      value={brand.colors[c.key]}
                      onChange={(e) => setBrand({ ...brand, colors: { ...brand.colors, [c.key]: e.target.value } })}
                      className="h-9 w-full rounded border border-border bg-transparent cursor-pointer"
                    />
                    <span className="text-[10px] text-muted-foreground">{c.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Fuente titulares</label>
                <Input
                  value={brand.fonts.heading}
                  onChange={(e) => setBrand({ ...brand, fonts: { ...brand.fonts, heading: e.target.value } })}
                  placeholder="Inter"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Fuente cuerpo</label>
                <Input
                  value={brand.fonts.body}
                  onChange={(e) => setBrand({ ...brand, fonts: { ...brand.fonts, body: e.target.value } })}
                  placeholder="Inter"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-2">
              Usa nombres de Google Fonts (ej: Playfair Display, Montserrat).
            </p>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Palabras clave de estilo</label>
              <Input
                value={brand.styleKeywords.join(', ')}
                onChange={(e) =>
                  setBrand({
                    ...brand,
                    styleKeywords: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="minimalista, editorial, tonos cálidos"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving} className="bg-brand-600 hover:bg-brand-500 text-white">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
