'use client'

import { useRef, useState } from 'react'
import { ImagePlus, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ReferenceImage } from '@/lib/carruseles/types'
import { useTenant } from '@/lib/tenant-context'

interface Props {
  projectId: string
  images: ReferenceImage[]
  onChange: () => void
}

export function ReferenceImages({ projectId, images, onChange }: Props) {
  const tenant = useTenant()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('projectId', projectId)
      fd.append('purpose', 'reference')
      const res = await fetch(`/api/${tenant}/evergreen/carruseles/upload`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Error')
      onChange()
    } catch (e) {
      toast.error('No se pudo subir la imagen: ' + (e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const remove = async (imageId: string) => {
    await fetch(`/api/${tenant}/evergreen/carruseles/${projectId}/references?imageId=${imageId}`, { method: 'DELETE' })
    onChange()
  }

  return (
    <div className="px-4 py-2.5 border-b border-border">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Referencias visuales
        </span>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
          Añadir
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) upload(f)
            e.target.value = ''
          }}
        />
      </div>
      {images.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {images.map((img) => (
            <div key={img.id} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.name} className="h-11 w-11 rounded object-cover border border-border" />
              <button
                onClick={() => remove(img.id)}
                className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
