"use client"

import { useState } from "react"
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
import { Award } from "lucide-react"
import { toast } from "sonner"
import {
  TestimonioForm,
  SaveButton,
  emptyValues,
  validateValues,
  type TestimonioFormValues,
} from "./TestimonioForm"

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Se llama tras crear, para refrescar el listado. */
  onCreated?: () => void
}

export function NuevoTestimonioDialog({ open, onOpenChange, onCreated }: Props) {
  const router = useRouter()
  const [values, setValues] = useState<TestimonioFormValues>(emptyValues())
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const problem = validateValues(values)
    if (problem) return toast.error(problem)
    setSaving(true)
    try {
      const res = await fetch("/api/evergreen/testimonios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Error al crear")
      toast.success(`${data.testimonio.name} añadido`)
      setValues(emptyValues())
      onOpenChange(false)
      onCreated?.()
      router.push(`/evergreen/testimonios/${data.testimonio.id}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (saving ? null : onOpenChange(o))}>
      <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-brand-400" />
            Nuevo testimonio
          </DialogTitle>
          <DialogDescription>
            Solo el nombre es obligatorio: puedes guardarlo ahora y completar la historia, la foto y
            el vídeo después.
          </DialogDescription>
        </DialogHeader>

        <TestimonioForm values={values} onChange={setValues} disabled={saving} />

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <SaveButton onClick={save} saving={saving} label="Crear testimonio" />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
