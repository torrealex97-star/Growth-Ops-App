'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, CheckCircle2, Info, Loader2, Save } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'

type Stage = { key: string; family: string; familyLabel: string; label: string; names: string[] }
type Available = { name: string; events: number; lastSeen: string }
type Payload = {
  canManage: boolean
  stages: Stage[]
  available: Available[]
  sample: { rows: number; limit: number; days: number; truncated: boolean }
}

const dateOnly = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-ES', { dateStyle: 'medium' })
}

export default function FunnelEventMapPage() {
  const tenant = useTenant()
  const [data, setData] = useState<Payload | null>(null)
  const [map, setMap] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/funnels/event-map`)
      const j = await r.json()
      if (!r.ok) {
        setError(j.error || 'No se pudo leer el mapeo')
        setData(null)
        return
      }
      const payload = j as Payload
      setData(payload)
      setMap(Object.fromEntries(payload.stages.map((s) => [s.key, s.names])))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de conexión')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [tenant])

  useEffect(() => {
    void load()
  }, [load])

  // Un mismo nombre de evento en dos etapas contaría la misma cosa dos veces en el funnel, así que
  // se avisa antes de guardar en vez de dejar que el funnel salga raro y nadie sepa por qué.
  const duplicados = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const names of Object.values(map)) for (const n of names) cuenta.set(n, (cuenta.get(n) ?? 0) + 1)
    return [...cuenta.entries()].filter(([, c]) => c > 1).map(([n]) => n)
  }, [map])

  function toggle(stageKey: string, name: string) {
    setSaved(false)
    setMap((prev) => {
      const current = prev[stageKey] ?? []
      return {
        ...prev,
        [stageKey]: current.includes(name) ? current.filter((n) => n !== name) : [...current, name],
      }
    })
  }

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/funnels/event-map`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map }),
      })
      const j = await r.json()
      if (!r.ok) {
        setError(j.error || 'No se pudo guardar')
        return
      }
      setSaved(true)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/${tenant}/funnels`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a Funnels
        </Link>
        <h1 className="text-foreground text-2xl font-bold">Eventos de las etapas de landing y VSL</h1>
        <p className="text-muted-foreground text-sm">
          El tracking guarda el nombre de cada evento como texto libre, así que nadie puede saber desde fuera cuál de
          tus nombres significa «visita a la landing». Elige aquí cuáles son y esas etapas dejarán de salir como «fuente
          sin configurar». Mientras no lo hagas seguirán en blanco: preferimos eso a inventarnos un número.
        </p>
      </div>

      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando eventos…
        </div>
      ) : error && !data ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : !data ? null : data.available.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
          No ha llegado ningún evento de tracking en los últimos {data.sample.days} días, así que no hay nada que mapear
          todavía. Cuando el script de la landing o del VSL empiece a enviar eventos, aparecerán aquí solos.
        </div>
      ) : (
        <>
          <p className="text-muted-foreground flex items-start gap-2 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            Nombres vistos en los últimos {data.sample.days} días
            {data.sample.truncated
              ? `, sobre una muestra de las ${data.sample.limit.toLocaleString('es-ES')} más recientes: si usas un nombre muy poco frecuente puede no aparecer en la lista`
              : ` (${data.sample.rows.toLocaleString('es-ES')} eventos)`}
            .
          </p>

          {duplicados.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {duplicados.join(', ')} está en más de una etapa. Se contará en todas ellas, así que el funnel dirá que
                la misma gente pasó dos veces. Déjalo solo donde corresponda.
              </span>
            </div>
          )}

          <div className="space-y-4">
            {data.stages.map((stage) => (
              <section key={stage.key} className="border-border bg-card rounded-xl border p-4">
                <header className="mb-3">
                  <h2 className="text-foreground text-sm font-semibold">
                    {stage.familyLabel} · {stage.label}
                  </h2>
                  <p className="text-muted-foreground text-xs">
                    {(map[stage.key] ?? []).length === 0
                      ? 'Sin mapear: esta etapa sale como «fuente sin configurar».'
                      : `${(map[stage.key] ?? []).length} evento(s) elegidos.`}
                  </p>
                </header>
                <div className="flex flex-wrap gap-2">
                  {data.available.map((ev) => {
                    const active = (map[stage.key] ?? []).includes(ev.name)
                    return (
                      <button
                        key={ev.name}
                        type="button"
                        onClick={() => toggle(stage.key, ev.name)}
                        disabled={!data.canManage}
                        aria-pressed={active}
                        className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-50 ${
                          active
                            ? 'border-primary/60 bg-primary/10 text-foreground'
                            : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <span className="block font-medium">{ev.name}</span>
                        <span className="opacity-70">
                          {ev.events.toLocaleString('es-ES')} eventos · hasta {dateOnly(ev.lastSeen)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>

          {error ? (
            <p className="flex items-start gap-2 text-sm text-red-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          ) : null}
          {saved ? (
            <p className="flex items-start gap-2 text-sm text-emerald-400">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              Mapeo guardado. Vuelve a Funnels y esas etapas ya cuentan eventos reales.
            </p>
          ) : null}

          {data.canManage ? (
            <button
              onClick={() => void save()}
              disabled={saving}
              className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar mapeo
            </button>
          ) : (
            <p className="text-muted-foreground text-xs">Solo admin o dirección pueden cambiar el mapeo.</p>
          )}
        </>
      )}
    </div>
  )
}
