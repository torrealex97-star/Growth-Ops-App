"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Award, Copy, Loader2, Pencil, PlayCircle, Trash2, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { testimonioPitch, youtubeId, type Testimonio } from "@/lib/testimonios-shared"
import {
  TestimonioForm,
  SaveButton,
  valuesFrom,
  validateValues,
  type TestimonioFormValues,
} from "@/components/testimonios/TestimonioForm"

export default function TestimonioDetallePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [t, setT] = useState<Testimonio | null>(null)
  const [canWrite, setCanWrite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState<TestimonioFormValues | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/evergreen/testimonios/${id}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Error")
      setT(json.testimonio)
      setCanWrite(!!json.canWrite)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const startEdit = () => {
    if (!t) return
    setValues(valuesFrom(t))
    setEditing(true)
  }

  const save = async () => {
    if (!values) return
    const problem = validateValues(values)
    if (problem) return toast.error(problem)
    setSaving(true)
    try {
      const res = await fetch(`/api/evergreen/testimonios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Error al guardar")
      setT(json.testimonio)
      setEditing(false)
      toast.success("Testimonio actualizado")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!t) return
    if (!confirm(`¿Eliminar el testimonio de ${t.name}? No se puede deshacer.`)) return
    const res = await fetch(`/api/evergreen/testimonios/${id}`, { method: "DELETE" })
    if (!res.ok) return toast.error("No se pudo eliminar")
    toast.success("Testimonio eliminado")
    router.push("/evergreen/testimonios")
  }

  if (loading) {
    return (
      <div className="py-20 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!t) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center">
        <p className="text-sm text-muted-foreground">Este testimonio no existe.</p>
        <Link href="/evergreen/testimonios" className="text-sm text-brand-300 hover:underline mt-2 inline-block">
          Volver a Testimonios
        </Link>
      </div>
    )
  }

  const vid = youtubeId(t.youtubeUrl)

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <Link
          href="/evergreen/testimonios"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" /> Testimonios
        </Link>
        {canWrite && !editing && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={startEdit} className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={remove}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Eliminar
            </Button>
          </div>
        )}
      </div>

      {editing && values ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Editar testimonio</h2>
          <TestimonioForm values={values} onChange={setValues} disabled={saving} />
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancelar
            </Button>
            <SaveButton onClick={save} saving={saving} />
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-4 mb-6 flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="text-2xl font-bold text-foreground">{t.name}</h1>
                {t.kind === "cliente" && (
                  <span className="px-2 py-0.5 rounded-md border border-border text-[10px] font-medium text-muted-foreground">
                    Cliente de la agencia, no alumno
                  </span>
                )}
                {!t.hasRevenue && (
                  <span className="px-2 py-0.5 rounded-md border border-border text-[10px] font-medium text-muted-foreground">
                    Sin cifras · testimonio de proceso
                  </span>
                )}
                {!t.active && (
                  <span className="px-2 py-0.5 rounded-md border border-border text-[10px] font-medium text-muted-foreground">
                    Desactivado
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {[t.avatar, t.sector].filter(Boolean).join(" · ") || "Sin avatar ni sector"}
              </p>
              {t.hook && <p className="text-lg font-semibold text-brand-300 mt-2.5 leading-snug">{t.hook}</p>}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(testimonioPitch(t))
                toast.success("Testimonio copiado")
              }}
              className="gap-1.5"
            >
              <Copy className="h-3.5 w-3.5" /> Copiar para llamada
            </Button>
          </div>

          {!t.consent && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 mb-5">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-500/90">
                Consentimiento de imagen y nombre sin verificar. Confírmalo antes de usar este
                testimonio en marketing, y márcalo desde Editar.
              </p>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3.5 pt-3">
                Foto
              </p>
              {t.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.photoUrl} alt={t.name} className="w-full object-contain bg-background/40 mt-2" />
              ) : (
                <div className="aspect-video flex flex-col items-center justify-center text-muted-foreground gap-2">
                  <Award className="h-7 w-7 opacity-40" />
                  <span className="text-xs">Sin foto</span>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3.5 pt-3">
                Vídeo del testimonio
              </p>
              {vid ? (
                <>
                  <div className="aspect-video mt-2">
                    <iframe
                      src={`https://www.youtube.com/embed/${vid}`}
                      title={`Testimonio de ${t.name}`}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                      allowFullScreen
                      className="w-full h-full"
                    />
                  </div>
                  <div className="p-3 flex items-center gap-2">
                    <a
                      href={t.youtubeUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand-300 hover:underline flex items-center gap-1"
                    >
                      <PlayCircle className="h-3.5 w-3.5" /> Abrir en YouTube
                    </a>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(t.youtubeUrl!)
                        toast.success("Enlace copiado")
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ml-auto"
                    >
                      <Copy className="h-3 w-3" /> Copiar enlace
                    </button>
                  </div>
                </>
              ) : (
                <div className="aspect-video flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <PlayCircle className="h-7 w-7 opacity-40" />
                  <span className="text-xs">Todavía sin enlace de vídeo</span>
                  {canWrite && (
                    <Button variant="outline" size="sm" onClick={startEdit} className="mt-1 gap-1.5">
                      <Pencil className="h-3 w-3" /> Añadir enlace
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-5">
            <h2 className="text-sm font-semibold text-foreground">Su historia</h2>
            {t.cifra && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-400 mb-1">
                  Cifra ancla
                </p>
                <p className="text-sm text-brand-300 font-medium">{t.cifra}</p>
              </div>
            )}
            {[
              { label: "Punto A — de dónde venía", value: t.puntoA },
              { label: "Punto B — dónde está ahora", value: t.puntoB },
              { label: "Vehículo — qué usó", value: t.vehiculo },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  {label}
                </p>
                <p className="text-sm text-foreground/90 leading-relaxed">
                  {value || <span className="text-muted-foreground">Sin rellenar</span>}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
