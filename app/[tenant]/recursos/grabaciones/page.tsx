'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, FileAudio, Loader2, RotateCcw, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useTenant, useTenantId } from '@/lib/tenant-context'
import { CATEGORY_LABELS, categorizeByMime, type RecordingCategory } from '@/lib/recordings/categorize'
import { openSignedStorageFile } from '@/lib/storage/signed-url'

const BUCKET = 'grabaciones'

type Item = {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number
  category: RecordingCategory
  status: 'pendiente' | 'aprobada' | 'rechazada'
  storage_path: string
  created_at: string
}

// Estado de cada archivo DENTRO de la tanda actual. Se guarda el File para poder reintentar sin
// pedirle al usuario que lo vuelva a seleccionar: en una subida de 40 archivos, que falle uno y
// haya que empezar de cero es lo que hace que la gente deje de usar la pantalla.
type Upload = {
  file: File
  estado: 'espera' | 'subiendo' | 'hecho' | 'duplicado' | 'error'
  progreso: number
  error?: string
}

const MB = 1024 * 1024
const fmtSize = (b: number) => (b >= MB ? `${(b / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

// SHA-256 del contenido, en el navegador. Es la identidad real del archivo: el nombre no sirve
// (dos personas suben "llamada.mp3") y el tamaño tampoco.
async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const STATUS_STYLE: Record<Item['status'], string> = {
  pendiente: 'text-amber-400',
  aprobada: 'text-emerald-400',
  rechazada: 'text-muted-foreground line-through',
}

export default function GrabacionesPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/${tenant}/evergreen/grabaciones`)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) toast.error(j.error || 'No se pudo cargar el banco')
    else setItems(j.items ?? [])
    setLoading(false)
  }, [tenant])

  useEffect(() => {
    void load()
  }, [load])

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return
    const nuevos: Upload[] = []
    for (const file of Array.from(files)) {
      if (!categorizeByMime(file.type)) {
        // Se rechaza aquí y se dice por qué, en vez de subirlo y que el servidor lo tire después.
        nuevos.push({ file, estado: 'error', progreso: 0, error: `Tipo no admitido (${file.type || 'desconocido'})` })
        continue
      }
      nuevos.push({ file, estado: 'espera', progreso: 0 })
    }
    setUploads((prev) => [...prev, ...nuevos])
  }

  const subirUno = async (up: Upload, index: number): Promise<void> => {
    const marcar = (patch: Partial<Upload>) =>
      setUploads((prev) => prev.map((u, i) => (i === index ? { ...u, ...patch } : u)))

    marcar({ estado: 'subiendo', progreso: 10, error: undefined })
    try {
      const hash = await sha256Hex(up.file)
      marcar({ progreso: 35 })

      // La ruta empieza por tenant_id: es lo que hace cumplir el aislamiento en Storage. El hash en
      // el nombre evita que dos archivos distintos con el mismo nombre se pisen.
      const safeName = up.file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
      const path = `${tenantId}/${hash.slice(0, 12)}-${safeName}`

      const sb = createClient()
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, up.file, {
        contentType: up.file.type,
        upsert: true, // reintentar el mismo archivo no debe fallar por "ya existe"
      })
      if (upErr) throw new Error(upErr.message)
      marcar({ progreso: 75 })

      const r = await fetch(`/api/${tenant}/evergreen/grabaciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath: path,
          fileName: up.file.name,
          mimeType: up.file.type,
          sizeBytes: up.file.size,
          sha256: hash,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'No se pudo registrar')
      marcar({ estado: j.duplicado ? 'duplicado' : 'hecho', progreso: 100 })
    } catch (e) {
      marcar({ estado: 'error', progreso: 0, error: e instanceof Error ? e.message : 'Error al subir' })
    }
  }

  // En serie, no en paralelo: subir 40 archivos a la vez saturaría la conexión y haría que
  // fallaran varios a la vez sin saber cuál. Uno detrás de otro es más lento y mucho más legible.
  const subirPendientes = async () => {
    setWorking(true)
    for (let i = 0; i < uploads.length; i++) {
      const u = uploads[i]
      if (u.estado === 'espera' || u.estado === 'error') await subirUno(u, i)
    }
    setWorking(false)
    await load()
  }

  const revisar = async (id: string, status: 'aprobada' | 'rechazada') => {
    const r = await fetch(`/api/${tenant}/evergreen/grabaciones`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      toast.error(j.error || 'No se pudo actualizar')
      return
    }
    toast.success(status === 'aprobada' ? 'Grabación aprobada' : 'Grabación rechazada')
    await load()
  }

  const pendientesDeSubir = uploads.filter((u) => u.estado === 'espera' || u.estado === 'error').length
  const conError = uploads.filter((u) => u.estado === 'error').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Banco de grabaciones</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Audios, vídeos y transcripciones de llamadas. Se guardan en un bucket privado y no se usan hasta que alguien
          las aprueba: es material con voz de clientes reales.
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-border bg-card/40 p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500">
            <Upload className="h-4 w-4" /> Elegir archivos
            <input
              type="file"
              multiple
              className="hidden"
              accept="audio/*,video/*,text/plain,text/vtt,application/pdf"
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          {pendientesDeSubir > 0 && (
            <button
              onClick={subirPendientes}
              disabled={working}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Subir {pendientesDeSubir} {pendientesDeSubir === 1 ? 'archivo' : 'archivos'}
              {conError > 0 ? ` (${conError} con error)` : ''}
            </button>
          )}
          {uploads.length > 0 && !working && (
            <button onClick={() => setUploads([])} className="text-sm text-muted-foreground hover:text-foreground">
              Limpiar la lista
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          La categoría se decide por el tipo del archivo, no con IA. Los repetidos se detectan por el contenido (hash),
          así que puedes reintentar una subida interrumpida sin duplicar nada.
        </p>

        {uploads.length > 0 && (
          <ul className="space-y-1.5">
            {uploads.map((u, i) => (
              <li key={`${u.file.name}-${i}`} className="flex items-center gap-3 text-sm">
                <span className="w-5 shrink-0">
                  {u.estado === 'subiendo' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {u.estado === 'hecho' && <Check className="h-4 w-4 text-emerald-400" />}
                  {u.estado === 'duplicado' && <Check className="h-4 w-4 text-muted-foreground" />}
                  {u.estado === 'error' && <AlertTriangle className="h-4 w-4 text-red-400" />}
                  {u.estado === 'espera' && <FileAudio className="h-4 w-4 text-muted-foreground" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{u.file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(u.file.size)}</span>
                <span className="w-40 shrink-0 text-xs">
                  {u.estado === 'subiendo' && (
                    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <span className="block h-full bg-brand-500 transition-all" style={{ width: `${u.progreso}%` }} />
                    </span>
                  )}
                  {u.estado === 'duplicado' && <span className="text-muted-foreground">Ya estaba en el banco</span>}
                  {u.estado === 'hecho' && <span className="text-emerald-400">Subida</span>}
                  {u.estado === 'error' && <span className="text-red-400">{u.error}</span>}
                </span>
                {u.estado === 'error' && !working && (
                  <button
                    onClick={() => void subirUno(u, i)}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                    title="Reintentar solo este archivo"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg bg-card" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay ninguna grabación en el banco.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Archivo</th>
                <th className="p-3">Categoría</th>
                <th className="p-3 text-right">Tamaño</th>
                <th className="p-3">Estado</th>
                <th className="p-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-border">
                  <td className="p-3">
                    <button
                      onClick={() => void openSignedStorageFile(BUCKET, it.storage_path, (m) => toast.error(m))}
                      className="truncate text-left text-foreground hover:underline"
                      title="Abrir con un enlace firmado de vida corta"
                    >
                      {it.file_name}
                    </button>
                  </td>
                  <td className="p-3 text-muted-foreground">{CATEGORY_LABELS[it.category]}</td>
                  <td className="p-3 text-right font-mono text-muted-foreground">{fmtSize(it.size_bytes)}</td>
                  <td className={`p-3 ${STATUS_STYLE[it.status]}`}>{it.status}</td>
                  <td className="p-3 text-right">
                    {it.status === 'pendiente' ? (
                      <span className="inline-flex gap-2">
                        <button
                          onClick={() => void revisar(it.id, 'aprobada')}
                          className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"
                        >
                          <Check className="h-3.5 w-3.5" /> Aprobar
                        </button>
                        <button
                          onClick={() => void revisar(it.id, 'rechazada')}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400"
                        >
                          <X className="h-3.5 w-3.5" /> Rechazar
                        </button>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Revisada</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
