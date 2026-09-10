"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Loader2, LayoutGrid, FileImage } from "lucide-react"
import { toast } from "sonner"
import type { AspectRatio, ProjectKind } from "@/lib/carruseles/types"
import { ASPECT_LABELS } from "@/lib/carruseles/types"

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
}

const RATIOS_BY_KIND: Record<ProjectKind, AspectRatio[]> = {
  carousel: ["4:5", "1:1", "9:16"],
  flyer: ["A4", "3:4", "1:1", "9:16"],
}

export function CreateProjectDialog({ open, onOpenChange }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [kind, setKind] = useState<ProjectKind>("carousel")
  const [ratio, setRatio] = useState<AspectRatio>("4:5")
  const [creating, setCreating] = useState(false)

  const pickKind = (k: ProjectKind) => {
    setKind(k)
    setRatio(RATIOS_BY_KIND[k][0])
  }

  const create = async () => {
    setCreating(true)
    try {
      const res = await fetch("/api/evergreen/carruseles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || (kind === "flyer" ? "Nuevo flyer" : "Nuevo carrusel"), kind, aspectRatio: ratio }),
      })
      if (!res.ok) throw new Error("Error al crear")
      const project = await res.json()
      router.push(`/evergreen/carruseles/${project.id}`)
    } catch (e) {
      toast.error((e as Error).message)
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo proyecto</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {([
              { k: "carousel" as const, label: "Carrusel", desc: "Varias slides", Icon: LayoutGrid },
              { k: "flyer" as const, label: "Flyer", desc: "Pieza única", Icon: FileImage },
            ]).map(({ k, label, desc, Icon }) => (
              <button
                key={k}
                onClick={() => pickKind(k)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                  kind === k ? "border-brand-400 bg-brand-600/10" : "border-border hover:border-muted-foreground/40"
                )}
              >
                <Icon className={cn("h-5 w-5", kind === k ? "text-brand-400" : "text-muted-foreground")} />
                <span className="text-sm font-medium">{label}</span>
                <span className="text-[11px] text-muted-foreground">{desc}</span>
              </button>
            ))}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Título</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "flyer" ? "Nuevo flyer" : "Nuevo carrusel"} />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Formato</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {RATIOS_BY_KIND[kind].map((r) => (
                <button
                  key={r}
                  onClick={() => setRatio(r)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                    ratio === r ? "border-brand-400 bg-brand-600/10 text-brand-300" : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {ASPECT_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={create} disabled={creating} className="bg-brand-600 hover:bg-brand-500 text-white">
            {creating && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
