"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, ImagePlus, Trophy, X } from "lucide-react"
import { toast } from "sonner"

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
}

const MIN_STORY = 80

const PLACEHOLDER = `Pega aquí lo que sea: notas, la transcripción de la llamada o un resumen.

Ejemplo: Miguel era empleado en una fintech, un trabajo metódico que le aburría y sin saber nada de tecnología. Antes de entrar iba divagando entre vídeos de YouTube sin resultados. Entró con el Master Intensivo en octubre de 2024 y escaló al programa completo. Hoy vive de su agencia de IA ennichada en inmobiliaria, con 11 clientes recurrentes. Su servicio estrella son 2.000€ de implementación más 497€/mes, y factura unos 5.000€/mes recurrentes. Lo que más le costó fue perder el miedo a vender.`

export function CasoExitoDialog({ open, onOpenChange }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState("")
  const [story, setStory] = useState("")
  const [photoUrl, setPhotoUrl] = useState("")
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)

  const reset = () => {
    setName("")
    setStory("")
    setPhotoUrl("")
  }

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("purpose", "caso-exito")
      const res = await fetch("/api/evergreen/carruseles/upload", { method: "POST", body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Error al subir")
      setPhotoUrl(data.url)
    } catch (e) {
      toast.error("No se pudo subir la foto: " + (e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const generate = async () => {
    setGenerating(true)
    try {
      const res = await fetch("/api/evergreen/carruseles/caso-exito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), photoUrl, story: story.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Error al generar")
      toast.success(`Carrusel creado con ${data.slides} slides`)
      reset()
      onOpenChange(false)
      router.push(`/evergreen/carruseles/${data.id}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  const ready = !!name.trim() && !!photoUrl && story.trim().length >= MIN_STORY

  return (
    <Dialog open={open} onOpenChange={(o) => (generating ? null : onOpenChange(o))}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-brand-400" />
            Nuevo caso de éxito
          </DialogTitle>
          <DialogDescription>
            Sube la foto y pega la explicación del caso. Se monta solo el carrusel completo con el estilo
            de [tenant]: portada con la foto, punto A, el giro, la cifra, el vehículo y el CTA a la
            clase gratuita.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nombre del alumno</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Miguel"
              disabled={generating}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Foto del caso de éxito</label>
            {photoUrl ? (
              <div className="relative mt-1 rounded-lg overflow-hidden border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="Caso de éxito" className="w-full max-h-44 object-contain bg-background/40" />
                <button
                  onClick={() => setPhotoUrl("")}
                  disabled={generating}
                  className="absolute top-2 right-2 h-7 w-7 rounded-md bg-card/90 border border-border flex items-center justify-center text-muted-foreground hover:text-destructive"
                  title="Quitar foto"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => inputRef.current?.click()}
                disabled={uploading || generating}
                className="mt-1 w-full border border-dashed border-border rounded-lg py-6 flex flex-col items-center gap-1.5 text-muted-foreground hover:border-brand-400/50 hover:text-foreground transition-colors"
              >
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                <span className="text-sm">{uploading ? "Subiendo…" : "Subir foto"}</span>
                <span className="text-[11px]">
                  Sale en la primera slide. Vale horizontal: se encaja sin recortar caras.
                </span>
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) upload(f)
                e.target.value = ""
              }}
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Explicación del caso</label>
              <span className="text-[11px] text-muted-foreground">
                {story.trim().length < MIN_STORY
                  ? `${story.trim().length}/${MIN_STORY} mínimo`
                  : `${story.trim().length} caracteres`}
              </span>
            </div>
            <Textarea
              value={story}
              onChange={(e) => setStory(e.target.value)}
              placeholder={PLACEHOLDER}
              rows={9}
              disabled={generating}
              className="mt-1 text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Cuanto más detalle des del antes, el después y las cifras reales, mejor sale. No se inventan
              cifras: si el caso no tiene facturación todavía, se enfoca como testimonio de proceso.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={generating}>
            Cancelar
          </Button>
          <Button
            onClick={generate}
            disabled={!ready || generating || uploading}
            className="bg-brand-600 hover:bg-brand-500 text-white"
          >
            {generating && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            {generating ? "Montando el carrusel…" : "Generar carrusel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
