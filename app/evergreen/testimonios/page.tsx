"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Award, Copy, Loader2, Search, PlayCircle, Check, X, Pencil, AlertTriangle, Plus } from "lucide-react"
import { toast } from "sonner"
import { testimonioPitch, youtubeThumb, type Testimonio } from "@/lib/testimonios-shared"
import { NuevoTestimonioDialog } from "@/components/testimonios/NuevoTestimonioDialog"

type Filter = "todos" | "con-cifras" | "proceso" | "sin-video"

const FILTERS: { key: Filter; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "con-cifras", label: "Con cifras" },
  { key: "proceso", label: "De proceso" },
  { key: "sin-video", label: "Sin vídeo" },
]

export default function TestimoniosPage() {
  const [items, setItems] = useState<Testimonio[]>([])
  const [canWrite, setCanWrite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<Filter>("todos")
  const [editing, setEditing] = useState<string | null>(null)
  const [draftUrl, setDraftUrl] = useState("")
  const [saving, setSaving] = useState(false)
  const [nuevoOpen, setNuevoOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/evergreen/testimonios")
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Error")
      const json = await res.json()
      setItems(json.testimonios || [])
      setCanWrite(!!json.canWrite)
    } catch (e) {
      toast.error("No se pudieron cargar los testimonios: " + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((t) => {
      if (filter === "con-cifras" && !t.hasRevenue) return false
      if (filter === "proceso" && t.hasRevenue) return false
      if (filter === "sin-video" && t.youtubeUrl) return false
      if (!needle) return true
      return [t.name, t.avatar, t.sector, t.hook, t.puntoA, t.puntoB, t.vehiculo, t.cifra]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(needle))
    })
  }, [items, q, filter])

  const sinVideo = items.filter((t) => !t.youtubeUrl).length

  const copy = (text: string, msg: string) => {
    navigator.clipboard.writeText(text)
    toast.success(msg)
  }

  const saveUrl = async (id: string) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/evergreen/testimonios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeUrl: draftUrl.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Error al guardar")
      setItems((prev) => prev.map((t) => (t.id === id ? json.testimonio : t)))
      setEditing(null)
      toast.success("Enlace guardado")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Award className="h-6 w-6 text-brand-400" />
            Testimonios
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Casos de éxito con foto, vídeo y la historia de cambio. Para tenerlos a mano en llamada
            y para añadir prueba social a los guiones.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre, sector, cifra…"
              className="pl-8 w-64"
            />
          </div>
          {canWrite && (
            <Button onClick={() => setNuevoOpen(true)} className="bg-brand-600 hover:bg-brand-500 text-white gap-1.5">
              <Plus className="h-4 w-4" /> Nuevo testimonio
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
              filter === f.key
                ? "border-brand-400 bg-brand-600/10 text-brand-300"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
            {f.key === "sin-video" && sinVideo > 0 && (
              <span className="ml-1.5 text-[10px] text-muted-foreground">({sinVideo})</span>
            )}
          </button>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">
          {shown.length} de {items.length}
        </span>
      </div>

      {loading ? (
        <div className="py-20 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map((t) => {
            const thumb = youtubeThumb(t.youtubeUrl) || t.photoUrl
            return (
              <div key={t.id} className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
                <div className="relative aspect-video bg-background/40 overflow-hidden">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt={t.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Award className="h-8 w-8 text-muted-foreground opacity-40" />
                    </div>
                  )}
                  {t.youtubeUrl && (
                    <a
                      href={t.youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity"
                      title="Ver el testimonio en YouTube"
                    >
                      <span className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card/95 text-sm font-medium">
                        <PlayCircle className="h-4 w-4 text-red-500" /> Ver vídeo
                      </span>
                    </a>
                  )}
                  {!t.hasRevenue && (
                    <span className="absolute top-2 left-2 px-2 py-1 rounded-md bg-card/90 border border-border text-[10px] font-medium text-muted-foreground">
                      Sin cifras · proceso
                    </span>
                  )}
                  {t.kind === "cliente" && (
                    <span className="absolute top-2 right-2 px-2 py-1 rounded-md bg-card/90 border border-border text-[10px] font-medium text-muted-foreground">
                      Cliente, no alumno
                    </span>
                  )}
                </div>

                <div className="p-3.5 flex-1 flex flex-col gap-2">
                  <div>
                    <Link
                      href={`/evergreen/testimonios/${t.id}`}
                      className="text-sm font-semibold text-foreground hover:text-brand-300 transition-colors"
                    >
                      {t.name}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      {[t.avatar, t.sector].filter(Boolean).join(" · ")}
                    </p>
                  </div>

                  {t.cifra && (
                    <p className="text-xs text-brand-300 font-medium leading-snug">{t.cifra}</p>
                  )}

                  <div className="text-[11px] text-muted-foreground space-y-1 leading-relaxed">
                    {t.puntoA && (
                      <p>
                        <span className="text-foreground/70 font-medium">Antes:</span> {t.puntoA}
                      </p>
                    )}
                    {t.puntoB && (
                      <p>
                        <span className="text-foreground/70 font-medium">Ahora:</span> {t.puntoB}
                      </p>
                    )}
                  </div>

                  {!t.consent && (
                    <p className="text-[10px] text-amber-500/90 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Consentimiento sin verificar
                    </p>
                  )}

                  <div className="mt-auto pt-2 flex items-center gap-1.5 flex-wrap">
                    <Link
                      href={`/evergreen/testimonios/${t.id}`}
                      className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground"
                    >
                      <Award className="h-3 w-3" /> Ficha
                    </Link>
                    <button
                      onClick={() => copy(testimonioPitch(t), "Testimonio copiado")}
                      className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="h-3 w-3" /> Copiar
                    </button>
                    {t.youtubeUrl ? (
                      <button
                        onClick={() => copy(t.youtubeUrl!, "Enlace copiado")}
                        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground"
                      >
                        <PlayCircle className="h-3 w-3" /> Enlace
                      </button>
                    ) : (
                      <span className="text-[11px] text-amber-500/90">Falta el vídeo</span>
                    )}
                    {canWrite && editing !== t.id && (
                      <button
                        onClick={() => {
                          setEditing(t.id)
                          setDraftUrl(t.youtubeUrl || "")
                        }}
                        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground ml-auto"
                      >
                        <Pencil className="h-3 w-3" /> {t.youtubeUrl ? "Cambiar" : "Añadir vídeo"}
                      </button>
                    )}
                  </div>

                  {editing === t.id && (
                    <div className="flex items-center gap-1.5 pt-1">
                      <Input
                        value={draftUrl}
                        onChange={(e) => setDraftUrl(e.target.value)}
                        placeholder="https://youtu.be/…"
                        className="h-8 text-xs"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveUrl(t.id)
                          if (e.key === "Escape") setEditing(null)
                        }}
                      />
                      <button
                        onClick={() => saveUrl(t.id)}
                        disabled={saving}
                        className="h-8 w-8 rounded-md border border-border flex items-center justify-center text-brand-300 hover:bg-brand-600/10 shrink-0"
                        title="Guardar"
                      >
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="h-8 w-8 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
                        title="Cancelar"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <NuevoTestimonioDialog open={nuevoOpen} onOpenChange={setNuevoOpen} onCreated={load} />

      {!loading && shown.length === 0 && (
        <div className="border border-dashed border-border rounded-xl py-16 text-center">
          <p className="text-sm text-muted-foreground">No hay testimonios que encajen con ese filtro.</p>
        </div>
      )}
    </div>
  )
}
