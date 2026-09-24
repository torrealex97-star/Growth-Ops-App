'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarPlus, Loader2, Tag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/lib/tenant-context'
import type { Annotation } from '@/app/api/[tenant]/evergreen/anotaciones/route'

// Inspector de anotaciones: lista, crea y borra las notas que TrendChart pinta como líneas verticales.
// Vive fuera del propio gráfico a propósito — varios gráficos de la misma pantalla pueden compartir
// el mismo rango de fechas y por tanto las mismas anotaciones, y forzar el CRUD dentro de cada uno
// las duplicaría.

const cls =
  'w-full bg-muted border border-border rounded-lg p-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500'

type Props = {
  /** Rango cuyas anotaciones se listan (YYYY-MM-DD). */
  desde: string
  hasta: string
  /** El propio user id, para saber si puede borrar sin depender de un segundo campo de rol. */
  userId?: string | null
  puedeGestionarTodas?: boolean
  className?: string
}

export function AnotacionesInspector({ desde, hasta, userId, puedeGestionarTodas, className }: Props) {
  const tenant = useTenant()
  const [items, setItems] = useState<Annotation[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ date: hasta, title: '', description: '', category: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/anotaciones?desde=${desde}&hasta=${hasta}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'No se pudieron leer las anotaciones')
      setItems(j.annotations || [])
    } catch (e) {
      toast.error('No se pudieron cargar las anotaciones', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoading(false)
    }
  }, [tenant, desde, hasta])

  useEffect(() => {
    void load()
  }, [load])

  async function crear() {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/anotaciones`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'No se pudo guardar la anotación')
      setForm({ date: hasta, title: '', description: '', category: '' })
      setOpen(false)
      await load()
    } catch (e) {
      toast.error('No se pudo guardar', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  async function borrar(id: string) {
    if (!confirm('¿Borrar esta anotación?')) return
    try {
      const r = await fetch(`/api/${tenant}/evergreen/anotaciones/${id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'No se pudo borrar')
      setItems((its) => its.filter((a) => a.id !== id))
    } catch (e) {
      toast.error('No se pudo borrar', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className={`rounded-lg border border-border bg-card p-4 ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-brand-400" />
          <h3 className="text-sm font-semibold text-foreground">Anotaciones</h3>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300"
        >
          <CalendarPlus className="h-3.5 w-3.5" /> Nueva
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-b border-border pb-3">
          <input
            type="date"
            className={cls}
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
          <input
            className={cls}
            placeholder="Título (ej. Arranca campaña Black Friday)"
            maxLength={200}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <input
            className={cls}
            placeholder="Categoría (opcional: marketing, producto, operación…)"
            maxLength={60}
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          />
          <textarea
            className={cls}
            placeholder="Descripción (opcional)"
            rows={2}
            maxLength={2000}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <button
            type="button"
            onClick={() => void crear()}
            disabled={saving || !form.title.trim() || !form.date}
            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar
          </button>
        </div>
      )}

      <div className="mt-3 max-h-64 space-y-2 overflow-auto">
        {loading ? (
          <p className="text-xs text-muted-foreground">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin anotaciones en este rango.</p>
        ) : (
          items.map((a) => {
            const puedeBorrar = puedeGestionarTodas || a.created_by === userId
            return (
              <div key={a.id} className="flex items-start justify-between gap-2 rounded-lg bg-muted/60 p-2">
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">
                    {a.date}
                    {a.category ? ` · ${a.category}` : ''}
                  </p>
                  <p className="truncate text-sm text-foreground">{a.title}</p>
                  {a.description && <p className="mt-0.5 text-xs text-muted-foreground">{a.description}</p>}
                </div>
                {puedeBorrar && (
                  <button
                    type="button"
                    onClick={() => void borrar(a.id)}
                    className="shrink-0 text-muted-foreground hover:text-red-400"
                    aria-label="Borrar anotación"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
