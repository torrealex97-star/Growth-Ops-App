'use client'
import { useTenant } from '@/lib/tenant-context'

// Cola global de guiones (transcribir + generar) que vive en el layout de /evergreen,
// no en la página de Competencia. Así sigue procesando aunque cambies de sección.
// Persiste en localStorage y reanuda al recargar / reabrir el navegador.
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  Loader2, CheckCircle2, AlertCircle, RotateCcw, ChevronDown, ChevronUp, X, Copy,
} from 'lucide-react'

export type ScriptDraft = { title: string; hook: string; script: string; caption: string; notes: string; cta_used?: string }
type JobStatus = 'queued' | 'transcribing' | 'scripting' | 'done' | 'error'
export type ScriptJob = {
  cmId: string
  label: string
  permalink: string | null
  transcript: string
  save: boolean
  /** Prueba social: '' sin testimonio, 'auto' la IA elige, o el id de un caso. */
  testimonio?: string
  status: JobStatus
  error?: string
  draft?: ScriptDraft
  ideaId?: string | null
}
export type NewJob = Pick<ScriptJob, 'cmId' | 'label' | 'permalink' | 'transcript' | 'save'>

type Ctx = {
  jobs: ScriptJob[]
  /** Encola items nuevos (ignora los que ya estén en cola / hechos). Devuelve cuántos añadió. */
  enqueue: (items: NewJob[]) => number
}
const QueueCtx = createContext<Ctx | null>(null)
export const useScriptQueue = () => {
  const c = useContext(QueueCtx)
  if (!c) throw new Error('useScriptQueue debe usarse dentro de <ScriptQueueProvider>')
  return c
}

const CONCURRENCY = 2
const LS_KEY = 'iaw_script_jobs'

export function ScriptQueueProvider({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const router = useRouter()
  const [jobs, setJobs] = useState<ScriptJob[]>([])
  const [trayOpen, setTrayOpen] = useState(true)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const jobsRef = useRef<ScriptJob[]>([])
  const runningRef = useRef(0)

  const setJobsSynced = (updater: (prev: ScriptJob[]) => ScriptJob[]) => {
    const next = updater(jobsRef.current)
    jobsRef.current = next
    setJobs(next)
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)) } catch { /* noop */ }
  }
  const patchJob = (cmId: string, patch: Partial<ScriptJob>) =>
    setJobsSynced((prev) => prev.map((j) => (j.cmId === cmId ? { ...j, ...patch } : j)))

  const notifySystem = (title: string, body: string) => {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        new Notification(title, { body, icon: '/favicon.ico' })
      }
    } catch { /* noop */ }
  }

  const runJob = async (job: ScriptJob) => {
    try {
      let transcript = job.transcript
      if (!transcript) {
        const t = await fetch(`/api/${tenant}/evergreen/instagram/transcribe`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ competitorMediaId: job.cmId }),
        })
        const tj = await t.json()
        if (!t.ok || !tj.transcript) throw new Error(tj.error || 'No se pudo transcribir')
        transcript = tj.transcript as string
        patchJob(job.cmId, { transcript })
      }
      patchJob(job.cmId, { status: 'scripting' })
      const res = await fetch(`/api/${tenant}/evergreen/instagram/script`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitorMediaId: job.cmId, transcript, saveAsIdea: job.save, testimonio: job.testimonio || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      patchJob(job.cmId, { status: 'done', draft: json.draft, ideaId: json.ideaId ?? null })
      if (job.save && json.ideaId) {
        toast.success(`Guión de ${job.label} añadido a Ideas`, {
          action: { label: 'Ver', onClick: () => router.push(`/${tenant}/content`) },
        })
        notifySystem('Guión listo', `${job.label} añadido a Contenido como idea`)
      } else {
        toast.success(`Guión de ${job.label} listo`, {
          action: { label: 'Abrir', onClick: () => setReviewId(job.cmId) },
        })
        notifySystem('Guión listo', `${job.label} — pulsa para revisarlo`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      patchJob(job.cmId, { status: 'error', error: msg })
      toast.error(`Error con ${job.label}`, { description: msg })
    }
  }

  const pump = () => {
    while (runningRef.current < CONCURRENCY) {
      const next = jobsRef.current.find((j) => j.status === 'queued')
      if (!next) break
      runningRef.current++
      patchJob(next.cmId, { status: 'transcribing' })
      runJob(next).finally(() => {
        runningRef.current--
        pump()
        const active = jobsRef.current.some((j) => j.status === 'queued' || j.status === 'transcribing' || j.status === 'scripting')
        if (!active) {
          const done = jobsRef.current.filter((j) => j.status === 'done').length
          const err = jobsRef.current.filter((j) => j.status === 'error').length
          if (done + err > 0) toast.success(`Tanda terminada · ${done} listos${err ? ` · ${err} con error` : ''}`)
        }
      })
    }
  }

  // Reanuda lo que hubiera pendiente al montar (recarga / reapertura del navegador).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as ScriptJob[]
      // Lo que se quedó a medias vuelve a la cola.
      const resumed = parsed.map((j) => (j.status === 'transcribing' || j.status === 'scripting' ? { ...j, status: 'queued' as JobStatus } : j))
      jobsRef.current = resumed
      setJobs(resumed)
      if (resumed.some((j) => j.status === 'queued')) setTimeout(() => pump(), 400)
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const enqueue = (items: NewJob[]): number => {
    const active = new Set(jobsRef.current.filter((j) => j.status !== 'error').map((j) => j.cmId))
    const toAdd: ScriptJob[] = []
    for (const it of items) {
      if (active.has(it.cmId)) continue
      toAdd.push({ ...it, status: 'queued' })
    }
    if (toAdd.length === 0) return 0
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
    setJobsSynced((prev) => [...prev, ...toAdd])
    setTrayOpen(true)
    pump()
    return toAdd.length
  }

  const retryJob = (cmId: string) => { patchJob(cmId, { status: 'queued', error: undefined }); pump() }
  const clearFinished = () => setJobsSynced((prev) => prev.filter((j) => j.status !== 'done' && j.status !== 'error'))

  // Guarda como idea un borrador ya generado (jobs en modo "revisar").
  const saveDraftAsIdea = async (job: ScriptJob) => {
    if (!job.draft) return
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const d = job.draft
    const notes = `GUION IA (inspirado en ${job.permalink || 'un reel top'})${d.cta_used ? ` · CTA: ${d.cta_used}` : ''}:\n\nHOOK: ${d.hook}\n\nCAPTION: ${d.caption}\n\nNOTAS: ${d.notes}`
    const { data, error } = await supabase.from('content_items').insert({
      title: d.title, content_type: 'reel', status: 'idea', notes,
      script: `HOOK: ${d.hook}\n\n${d.script}\n\nCAPTION: ${d.caption}`,
      reference_reel_url: job.permalink || null, reference_transcript: job.transcript || null,
      created_by: user?.id,
    }).select('id').single()
    if (error) { toast.error('No se pudo añadir a Ideas', { description: error.message }); return }
    patchJob(job.cmId, { save: true, ideaId: data?.id ?? null })
    toast.success('Añadido a Ideas', { action: { label: 'Ver', onClick: () => router.push(`/${tenant}/content`) } })
    setReviewId(null)
  }

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'transcribing' || j.status === 'scripting').length
  const done = jobs.filter((j) => j.status === 'done').length
  const review = reviewId ? jobs.find((j) => j.cmId === reviewId) || null : null

  return (
    <QueueCtx.Provider value={{ jobs, enqueue }}>
      {children}

      {/* Bandeja de progreso global (visible en toda la app mientras haya cola) */}
      {jobs.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[60] w-80 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/80">
            <div className="flex items-center gap-2 text-sm text-foreground font-medium">
              {active > 0 ? <Loader2 className="w-4 h-4 animate-spin text-pink-400" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              {active > 0 ? `Procesando ${done}/${jobs.length}` : `${done}/${jobs.length} listos`}
            </div>
            <div className="flex items-center gap-1">
              {active === 0 && <button onClick={clearFinished} className="text-xs text-muted-foreground hover:text-foreground px-1">Limpiar</button>}
              <button onClick={() => setTrayOpen((o) => !o)} className="text-muted-foreground hover:text-foreground">{trayOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}</button>
            </div>
          </div>
          {trayOpen && (
            <div className="max-h-72 overflow-y-auto divide-y divide-border/60">
              {jobs.map((j) => (
                <div key={j.cmId} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className="shrink-0">
                    {j.status === 'done' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    {j.status === 'error' && <AlertCircle className="w-4 h-4 text-red-400" />}
                    {(j.status === 'transcribing' || j.status === 'scripting') && <Loader2 className="w-4 h-4 animate-spin text-pink-400" />}
                    {j.status === 'queued' && <div className="w-4 h-4 rounded-full border border-border" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate">{j.label}</p>
                    <p className="text-muted-foreground truncate">
                      {j.status === 'queued' && 'En cola'}
                      {j.status === 'transcribing' && 'Transcribiendo…'}
                      {j.status === 'scripting' && 'Generando guión…'}
                      {j.status === 'done' && (j.save && j.ideaId ? 'Añadido a Ideas' : 'Listo para revisar')}
                      {j.status === 'error' && (j.error || 'Error')}
                    </p>
                  </div>
                  {j.status === 'done' && (
                    j.save && j.ideaId
                      ? <button onClick={() => router.push(`/${tenant}/content`)} className="shrink-0 text-pink-300 hover:text-pink-200">Ver</button>
                      : <button onClick={() => setReviewId(j.cmId)} className="shrink-0 text-pink-300 hover:text-pink-200">Abrir</button>
                  )}
                  {j.status === 'error' && (
                    <button onClick={() => retryJob(j.cmId)} className="shrink-0 text-muted-foreground hover:text-foreground" title="Reintentar"><RotateCcw className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal de revisión para borradores no guardados automáticamente */}
      {review?.draft && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4" onClick={() => setReviewId(null)}>
          <div className="bg-card border border-border rounded-xl max-w-2xl w-full max-h-[88vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-foreground">Guión de {review.label}</h3>
              <button onClick={() => setReviewId(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3 text-sm">
              <p className="text-foreground font-semibold text-base">{review.draft.title}</p>
              {review.draft.cta_used && <span className="inline-block text-xs bg-pink-950/50 text-pink-300 px-2 py-0.5 rounded-full">CTA: {review.draft.cta_used}</span>}
              <div><span className="text-muted-foreground">Hook:</span> <span className="text-pink-300">{review.draft.hook}</span></div>
              <div><p className="text-muted-foreground mb-1">Guión:</p><p className="text-foreground whitespace-pre-wrap bg-background/50 rounded-lg p-3">{review.draft.script}</p></div>
              <div><span className="text-muted-foreground">Caption:</span> <span className="text-foreground">{review.draft.caption}</span></div>
              <div className="flex flex-wrap gap-2 pt-2">
                <button onClick={() => saveDraftAsIdea(review)} className="px-3 py-2 rounded-lg text-sm bg-pink-600 text-foreground hover:bg-pink-500">Añadir a Contenido como IDEA</button>
                <button onClick={() => { navigator.clipboard.writeText(`${review.draft!.hook}\n\n${review.draft!.script}\n\n${review.draft!.caption}`); toast.success('Copiado') }} className="px-3 py-2 rounded-lg text-sm bg-muted text-foreground hover:bg-muted flex items-center gap-1"><Copy className="w-4 h-4" /> Copiar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </QueueCtx.Provider>
  )
}
