"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Bookmark, Loader2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChatPanel } from "@/components/carruseles/ChatPanel"
import { CarouselPreview } from "@/components/carruseles/CarouselPreview"
import { SlideFilmstrip } from "@/components/carruseles/SlideFilmstrip"
import { AspectRatioSelector } from "@/components/carruseles/AspectRatioSelector"
import { ExportButton } from "@/components/carruseles/ExportButton"
import { CaptionPanel } from "@/components/carruseles/CaptionPanel"
import { toast } from "sonner"
import type { CarruselProject, AspectRatio } from "@/lib/carruseles/types"
import { useTenant } from '@/lib/tenant-context'

export default function CarruselEditorPage({ params }: { params: { id: string } }) {
  const tenant = useTenant()
  const { id } = params
  const router = useRouter()
  const [project, setProject] = useState<CarruselProject | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [activeSlide, setActiveSlide] = useState(0)
  const [chatOpen, setChatOpen] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/${tenant}/evergreen/carruseles/${id}`)
      if (res.status === 404) return setNotFound(true)
      if (res.ok) {
        const data: CarruselProject = await res.json()
        setProject((prev) => {
          if (prev && data.slides.length > prev.slides.length) setActiveSlide(data.slides.length - 1)
          else setActiveSlide((idx) => (data.slides.length === 0 ? 0 : Math.min(idx, data.slides.length - 1)))
          return data
        })
        setTitleDraft((t) => t || data.title)
      }
    } catch {
      /* ignore */
    }
  }, [id])

  useEffect(() => {
    fetchProject()
  }, [fetchProject])

  const patchProject = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/${tenant}/evergreen/carruseles/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (res.ok) setProject(await res.json())
  }

  const handleDeleteSlide = async (slideId: string) => {
    if (!confirm("¿Eliminar esta slide?")) return
    const res = await fetch(`/api/${tenant}/evergreen/carruseles/${id}/slides/${slideId}`, { method: "DELETE" })
    if (res.ok) fetchProject()
  }

  const handleUndoSlide = async (slideId: string) => {
    const res = await fetch(`/api/${tenant}/evergreen/carruseles/${id}/slides/${slideId}/undo`, { method: "POST" })
    if (res.ok) fetchProject()
    else toast.info("No hay versión anterior")
  }

  const handleReorder = async (slideIds: string[]) => {
    // optimista
    setProject((p) => (p ? { ...p, slides: slideIds.map((sid) => p.slides.find((s) => s.id === sid)!).filter(Boolean) } : p))
    await fetch(`/api/${tenant}/evergreen/carruseles/${id}/slides`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slideIds }),
    })
    fetchProject()
  }

  const saveTemplate = async () => {
    const res = await fetch(`/api/${tenant}/evergreen/carruseles/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: id }),
    })
    if (res.ok) toast.success("Guardado como plantilla")
  }

  if (notFound) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center gap-3">
        <p className="text-lg font-semibold">Proyecto no encontrado</p>
        <Link href={`/${tenant}/instagram/carruseles`} className="text-sm text-brand-400 underline">
          Volver
        </Link>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)] min-h-[560px] -m-4 lg:-m-6">
      {/* Barra superior */}
      <div className="h-12 border-b border-border bg-card flex items-center px-3 gap-2 shrink-0">
        <Link href={`/${tenant}/instagram/carruseles`} className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => titleDraft.trim() && titleDraft !== project.title && patchProject({ title: titleDraft.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="bg-transparent text-sm font-semibold text-foreground focus:outline-none focus:bg-muted rounded px-2 py-1 min-w-0 flex-1 max-w-xs"
        />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded">
          {project.kind === "flyer" ? "Flyer" : "Carrusel"}
        </span>
        <div className="flex-1" />
        <AspectRatioSelector value={project.aspectRatio} kind={project.kind} onChange={(r: AspectRatio) => patchProject({ aspectRatio: r })} />
        <Button variant="ghost" size="sm" onClick={saveTemplate} className="text-muted-foreground" title="Guardar como plantilla">
          <Bookmark className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setChatOpen((v) => !v)} className="text-muted-foreground gap-1" title="Mostrar/ocultar chat">
          <MessageSquare className="h-3.5 w-3.5" />
        </Button>
        <ExportButton title={project.title} slides={project.slides} aspectRatio={project.aspectRatio} />
      </div>

      {/* Área principal */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {chatOpen && (
          <div className="w-80 border-r border-border shrink-0 flex flex-col bg-card">
            <ChatPanel
              projectId={id}
              referenceImages={project.referenceImages}
              onStreamStart={() => setIsGenerating(true)}
              onRefresh={fetchProject}
              onStreamEnd={() => setIsGenerating(false)}
              chatInputRef={chatInputRef}
            />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <CarouselPreview
            slides={project.slides}
            aspectRatio={project.aspectRatio}
            activeIndex={activeSlide}
            onActiveChange={setActiveSlide}
          />
          <CaptionPanel caption={project.caption} hashtags={project.hashtags} />
        </div>
      </div>

      {/* Filmstrip */}
      <SlideFilmstrip
        slides={project.slides}
        aspectRatio={project.aspectRatio}
        activeIndex={activeSlide}
        onActiveChange={setActiveSlide}
        onDeleteSlide={handleDeleteSlide}
        onUndoSlide={handleUndoSlide}
        onAddSlideRequest={() => {
          setChatOpen(true)
          setTimeout(() => chatInputRef.current?.focus(), 100)
        }}
        onReorder={handleReorder}
        isGenerating={isGenerating}
      />
    </div>
  )
}
