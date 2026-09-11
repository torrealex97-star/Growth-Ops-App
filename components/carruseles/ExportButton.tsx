"use client"

import { useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { exportProject } from "@/lib/carruseles/export-client"
import type { AspectRatio, Slide } from "@/lib/carruseles/types"
import { useTenant } from "@/lib/tenant-context"

interface ExportButtonProps {
  title: string
  slides: Slide[]
  aspectRatio: AspectRatio
}

export function ExportButton({ title, slides, aspectRatio }: ExportButtonProps) {
  const tenant = useTenant()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ c: number; t: number } | null>(null)

  const handleExport = async () => {
    if (busy || slides.length === 0) return
    setBusy(true)
    setProgress({ c: 0, t: slides.length })
    try {
      await exportProject(title, slides, aspectRatio, tenant, (c, t) => setProgress({ c, t }))
      toast.success(slides.length === 1 ? "PNG descargado" : "ZIP descargado")
    } catch (e) {
      toast.error("Error al exportar: " + (e as Error).message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <Button
      size="sm"
      onClick={handleExport}
      disabled={busy || slides.length === 0}
      className="bg-brand-600 hover:bg-brand-500 text-white gap-1.5"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {busy && progress ? `${progress.c}/${progress.t}` : slides.length === 1 ? "Descargar PNG" : "Descargar ZIP"}
    </Button>
  )
}
