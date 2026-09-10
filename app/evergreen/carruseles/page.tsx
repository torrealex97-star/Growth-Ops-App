"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CreateProjectDialog } from "@/components/carruseles/CreateProjectDialog"
import { CasoExitoDialog } from "@/components/carruseles/CasoExitoDialog"
import { BrandDialog } from "@/components/carruseles/BrandDialog"
import { SlideRenderer } from "@/components/carruseles/SlideRenderer"
import {
  Plus,
  Palette,
  LayoutGrid,
  FileImage,
  Copy,
  Trash2,
  Loader2,
  Sparkles,
  Bookmark,
  Trophy,
} from "lucide-react"
import { toast } from "sonner"
import { ASPECT_LABELS, type CarruselProject, type CarruselTemplate } from "@/lib/carruseles/types"
import { CASO_TITLE_PREFIX } from "@/lib/carruseles/caso-exito"

export default function CarruselesDashboard() {
  const router = useRouter()
  const [projects, setProjects] = useState<CarruselProject[]>([])
  const [templates, setTemplates] = useState<CarruselTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [casoOpen, setCasoOpen] = useState(false)
  const [brandOpen, setBrandOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const [pRes, tRes] = await Promise.all([
        fetch("/api/evergreen/carruseles"),
        fetch("/api/evergreen/carruseles/templates"),
      ])
      if (pRes.ok) setProjects((await pRes.json()).projects || [])
      if (tRes.ok) setTemplates((await tRes.json()).templates || [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const duplicate = async (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const res = await fetch(`/api/evergreen/carruseles/${id}/duplicate`, { method: "POST" })
    if (res.ok) {
      toast.success("Proyecto duplicado")
      load()
    }
  }

  const remove = async (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm("¿Eliminar este proyecto? No se puede deshacer.")) return
    const res = await fetch(`/api/evergreen/carruseles/${id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Proyecto eliminado")
      setProjects((p) => p.filter((x) => x.id !== id))
    }
  }

  const useTemplate = async (id: string) => {
    const res = await fetch(`/api/evergreen/carruseles/templates/${id}/use`, { method: "POST" })
    if (res.ok) {
      const project = await res.json()
      router.push(`/evergreen/carruseles/${project.id}`)
    }
  }

  const deleteTemplate = async (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const res = await fetch(`/api/evergreen/carruseles/templates/${id}`, { method: "DELETE" })
    if (res.ok) setTemplates((t) => t.filter((x) => x.id !== id))
  }

  // Los casos de éxito se agrupan por el prefijo del título que pone el generador.
  const casos = projects.filter((p) => p.title.toUpperCase().startsWith(CASO_TITLE_PREFIX))
  const others = projects.filter((p) => !p.title.toUpperCase().startsWith(CASO_TITLE_PREFIX))

  const projectCard = (p: CarruselProject) => (
    <Link
      key={p.id}
      href={`/evergreen/carruseles/${p.id}`}
      className="group rounded-xl border border-border bg-card overflow-hidden hover:border-brand-400/50 transition-colors"
    >
      <div className="aspect-[4/5] bg-background/40 relative overflow-hidden">
        {p.slides[0] ? (
          <SlideRenderer html={p.slides[0].html} aspectRatio={p.aspectRatio} style={{ width: "100%", height: "100%" }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            {p.kind === "flyer" ? <FileImage className="h-8 w-8 opacity-40" /> : <LayoutGrid className="h-8 w-8 opacity-40" />}
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={(e) => duplicate(p.id, e)} className="h-7 w-7 rounded-md bg-card/90 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground" title="Duplicar">
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button onClick={(e) => remove(p.id, e)} className="h-7 w-7 rounded-md bg-card/90 border border-border flex items-center justify-center text-muted-foreground hover:text-destructive" title="Eliminar">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="p-3">
        <p className="text-sm font-medium text-foreground truncate">{p.title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {p.kind === "flyer" ? "Flyer" : "Carrusel"} · {ASPECT_LABELS[p.aspectRatio]} · {p.slides.length} {p.slides.length === 1 ? "slide" : "slides"}
        </p>
      </div>
    </Link>
  )

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-brand-400" />
            Carruseles &amp; Flyers
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Diseña carruseles de Instagram y flyers con IA. Chatea, previsualiza y exporta en PNG.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setBrandOpen(true)} className="gap-1.5">
            <Palette className="h-4 w-4" /> Marca
          </Button>
          <Button variant="outline" onClick={() => setCasoOpen(true)} className="gap-1.5 border-brand-500/40 text-brand-300 hover:text-brand-200">
            <Trophy className="h-4 w-4" /> Caso de éxito
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="bg-brand-600 hover:bg-brand-500 text-white gap-1.5">
            <Plus className="h-4 w-4" /> Nuevo
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Casos de éxito */}
          <div className="mb-10">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Trophy className="h-4 w-4 text-brand-400" /> Casos de éxito
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Sube la foto del alumno y pega la explicación: se monta el carrusel entero solo.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setCasoOpen(true)} className="gap-1.5 border-brand-500/40 text-brand-300 hover:text-brand-200">
                <Plus className="h-3.5 w-3.5" /> Nuevo caso
              </Button>
            </div>
            {casos.length === 0 ? (
              <button
                onClick={() => setCasoOpen(true)}
                className="w-full border border-dashed border-border rounded-xl py-10 text-center hover:border-brand-400/50 transition-colors"
              >
                <div className="w-12 h-12 rounded-2xl bg-brand-600/10 border border-brand-500/20 flex items-center justify-center mx-auto mb-3">
                  <Trophy className="h-6 w-6 text-brand-400" />
                </div>
                <p className="text-sm font-medium text-foreground">Crea tu primer caso de éxito</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Foto + explicación → carrusel con punto A, punto B, cifra, vehículo y CTA.
                </p>
              </button>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {casos.map(projectCard)}
              </div>
            )}
          </div>

          {/* Proyectos */}
          {others.length > 0 && (
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-3">
              <LayoutGrid className="h-4 w-4 text-brand-400" /> Otros proyectos
            </h2>
          )}
          {projects.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-brand-600/10 border border-brand-500/20 flex items-center justify-center mx-auto mb-4">
                <LayoutGrid className="h-7 w-7 text-brand-400" />
              </div>
              <p className="font-medium text-foreground">Todavía no tienes proyectos</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">Crea tu primer carrusel o flyer con IA.</p>
              <Button onClick={() => setCreateOpen(true)} className="bg-brand-600 hover:bg-brand-500 text-white gap-1.5">
                <Plus className="h-4 w-4" /> Crear proyecto
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {others.map(projectCard)}
            </div>
          )}

          {/* Plantillas */}
          {templates.length > 0 && (
            <div className="mt-10">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-3">
                <Bookmark className="h-4 w-4 text-brand-400" /> Plantillas
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => useTemplate(t.id)}
                    className="group text-left rounded-xl border border-border bg-card overflow-hidden hover:border-brand-400/50 transition-colors"
                  >
                    <div className="aspect-[4/5] bg-background/40 relative overflow-hidden">
                      {t.slides[0] ? (
                        <SlideRenderer html={t.slides[0].html} aspectRatio={t.aspectRatio} style={{ width: "100%", height: "100%" }} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <Bookmark className="h-8 w-8 opacity-40" />
                        </div>
                      )}
                      <button onClick={(e) => deleteTemplate(t.id, e)} className="absolute top-2 right-2 h-7 w-7 rounded-md bg-card/90 border border-border flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity" title="Eliminar plantilla">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-medium text-foreground truncate">{t.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Usar plantilla · {t.slides.length} slides</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
      <CasoExitoDialog open={casoOpen} onOpenChange={setCasoOpen} />
      <BrandDialog open={brandOpen} onOpenChange={setBrandOpen} />
    </div>
  )
}
