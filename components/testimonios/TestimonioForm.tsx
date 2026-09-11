"use client"

import { useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ImagePlus, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { youtubeId, type Testimonio } from "@/lib/testimonios-shared"
import { useTenant } from '@/lib/tenant-context'

/** Campos del formulario: lo que se envía a la API al crear o editar. */
export interface TestimonioFormValues {
  name: string
  kind: "alumno" | "cliente"
  avatar: string
  sector: string
  photoUrl: string
  youtubeUrl: string
  hook: string
  puntoA: string
  puntoB: string
  vehiculo: string
  cifra: string
  hasRevenue: boolean
  consent: boolean
}

export function emptyValues(): TestimonioFormValues {
  return {
    name: "", kind: "alumno", avatar: "", sector: "", photoUrl: "", youtubeUrl: "",
    hook: "", puntoA: "", puntoB: "", vehiculo: "", cifra: "", hasRevenue: true, consent: false,
  }
}

export function valuesFrom(t: Testimonio): TestimonioFormValues {
  return {
    name: t.name,
    kind: t.kind,
    avatar: t.avatar || "",
    sector: t.sector || "",
    photoUrl: t.photoUrl || "",
    youtubeUrl: t.youtubeUrl || "",
    hook: t.hook || "",
    puntoA: t.puntoA || "",
    puntoB: t.puntoB || "",
    vehiculo: t.vehiculo || "",
    cifra: t.cifra || "",
    hasRevenue: t.hasRevenue,
    consent: t.consent,
  }
}

interface Props {
  values: TestimonioFormValues
  onChange: (v: TestimonioFormValues) => void
  disabled?: boolean
}

export function TestimonioForm({ values, onChange, disabled }: Props) {
  const tenant = useTenant()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const set = <K extends keyof TestimonioFormValues>(k: K, v: TestimonioFormValues[K]) =>
    onChange({ ...values, [k]: v })

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(`/api/${tenant}/evergreen/testimonios/upload`, { method: "POST", body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Error al subir")
      set("photoUrl", data.url)
    } catch (e) {
      toast.error("No se pudo subir la foto: " + (e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const urlOk = !values.youtubeUrl.trim() || !!youtubeId(values.youtubeUrl.trim())

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
          <Input value={values.name} onChange={(e) => set("name", e.target.value)} placeholder="Miguel" disabled={disabled} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Tipo</label>
          <div className="flex gap-2 mt-1">
            {(["alumno", "cliente"] as const).map((k) => (
              <button
                key={k}
                type="button"
                disabled={disabled}
                onClick={() => set("kind", k)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors flex-1",
                  values.kind === k
                    ? "border-brand-400 bg-brand-600/10 text-brand-300"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {k === "alumno" ? "Alumno" : "Cliente de la agencia"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Avatar que representa</label>
          <Input value={values.avatar} onChange={(e) => set("avatar", e.target.value)} placeholder="Trabajador quemado" disabled={disabled} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Sector / nicho</label>
          <Input value={values.sector} onChange={(e) => set("sector", e.target.value)} placeholder="Inmobiliaria" disabled={disabled} />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Foto</label>
        {values.photoUrl ? (
          <div className="relative mt-1 rounded-lg overflow-hidden border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={values.photoUrl} alt={values.name} className="w-full max-h-48 object-contain bg-background/40" />
            <button
              type="button"
              onClick={() => set("photoUrl", "")}
              disabled={disabled}
              className="absolute top-2 right-2 h-7 w-7 rounded-md bg-card/90 border border-border flex items-center justify-center text-muted-foreground hover:text-destructive"
              title="Quitar foto"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || disabled}
            className="mt-1 w-full border border-dashed border-border rounded-lg py-6 flex flex-col items-center gap-1.5 text-muted-foreground hover:border-brand-400/50 hover:text-foreground transition-colors"
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            <span className="text-sm">{uploading ? "Subiendo…" : "Subir foto"}</span>
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
        <label className="text-xs font-medium text-muted-foreground">Enlace del vídeo (YouTube)</label>
        <Input
          value={values.youtubeUrl}
          onChange={(e) => set("youtubeUrl", e.target.value)}
          placeholder="https://youtu.be/…"
          disabled={disabled}
          className={cn(!urlOk && "border-destructive")}
        />
        {!urlOk && <p className="text-[11px] text-destructive mt-1">Ese enlace no parece un vídeo de YouTube.</p>}
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Frase gancho</label>
        <Input value={values.hook} onChange={(e) => set("hook", e.target.value)} placeholder="11 clientes recurrentes. De empleado a dueño de agencia." disabled={disabled} />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Punto A — de dónde venía y qué le dolía</label>
        <Textarea value={values.puntoA} onChange={(e) => set("puntoA", e.target.value)} rows={3} disabled={disabled} className="mt-1 text-sm" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Punto B — dónde está ahora</label>
        <Textarea value={values.puntoB} onChange={(e) => set("puntoB", e.target.value)} rows={3} disabled={disabled} className="mt-1 text-sm" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Vehículo — qué usó exactamente</label>
        <Textarea value={values.vehiculo} onChange={(e) => set("vehiculo", e.target.value)} rows={2} disabled={disabled} className="mt-1 text-sm" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Cifra ancla</label>
        <Input value={values.cifra} onChange={(e) => set("cifra", e.target.value)} placeholder="23.000€ netos en 30 días" disabled={disabled} />
      </div>

      <div className="space-y-2 pt-1">
        <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={values.hasRevenue} onChange={(e) => set("hasRevenue", e.target.checked)} disabled={disabled} className="mt-0.5" />
          <span>
            <span className="text-foreground font-medium">Tiene resultados económicos.</span> Si lo
            desmarcas, se trata como testimonio de proceso y la IA no le atribuirá cifras al escribir guiones.
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={values.consent} onChange={(e) => set("consent", e.target.checked)} disabled={disabled} className="mt-0.5" />
          <span>
            <span className="text-foreground font-medium">Consentimiento de imagen y nombre verificado</span>{" "}
            para uso en marketing.
          </span>
        </label>
      </div>
    </div>
  )
}

/** Valida lo mínimo antes de enviar. Devuelve el mensaje de error o null. */
export function validateValues(v: TestimonioFormValues): string | null {
  if (!v.name.trim()) return "El nombre es obligatorio"
  if (v.youtubeUrl.trim() && !youtubeId(v.youtubeUrl.trim()))
    return "Ese enlace no parece un vídeo de YouTube válido"
  return null
}

export function SaveButton({
  onClick,
  saving,
  label = "Guardar",
}: {
  onClick: () => void
  saving: boolean
  label?: string
}) {
  return (
    <Button onClick={onClick} disabled={saving} className="bg-brand-600 hover:bg-brand-500 text-white">
      {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
      {label}
    </Button>
  )
}
