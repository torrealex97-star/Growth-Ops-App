'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, Plus, Loader2, Activity, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/lib/tenant-context'

type Site = {
  id: string
  slug: string
  name: string
  public_key: string
  allowed_origins: string[]
  allow_localhost: boolean
  tracking_enabled: boolean
  events24h: number
  errors24h: number
  lastEventAt: string | null
  created_at: string
}

// Sección PIXEL DE TRACKING del brief de Data Health (§10): estado con datos REALES (eventos
// últimas 24h, errores, último evento recibido), snippet/configuración para instalar el pixel,
// y alta/toggle de sites. Nada de un "Connected" que no comprueba nada.
export function TrackingSitesPanel() {
  const tenant = useTenant()
  const [sites, setSites] = useState<Site[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [newOrigins, setNewOrigins] = useState('')
  const [newLocalhost, setNewLocalhost] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/tracking/sites`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error cargando sitios')
      setSites(json.sites)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando sitios')
    }
  }, [tenant])

  useEffect(() => {
    void load()
  }, [load])

  const snippetFor = (site: Site) =>
    `<script defer src="${typeof window !== 'undefined' ? window.location.origin : ''}/tracker.js" data-site="${site.public_key}"></script>`

  const copySnippet = async (site: Site) => {
    try {
      await navigator.clipboard.writeText(snippetFor(site))
      setCopied(site.id)
      setTimeout(() => setCopied(null), 2000)
      toast.success('Snippet copiado')
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  const toggle = async (site: Site) => {
    const res = await fetch(`/api/${tenant}/evergreen/tracking/sites`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: site.id, tracking_enabled: !site.tracking_enabled }),
    })
    if (res.ok) {
      toast.success(site.tracking_enabled ? 'Tracking pausado' : 'Tracking activado')
      void load()
    } else {
      const json = await res.json().catch(() => ({}))
      toast.error(json.error || 'No se pudo cambiar el estado')
    }
  }

  const create = async () => {
    setCreating(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/tracking/sites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          slug: newSlug,
          allowed_origins: newOrigins.split(/[\s,]+/).filter(Boolean),
          allow_localhost: newLocalhost,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo crear')
      toast.success('Sitio creado (tracking apagado; actívalo al instalar el snippet)')
      setNewName('')
      setNewSlug('')
      setNewOrigins('')
      setNewLocalhost(false)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo crear')
    } finally {
      setCreating(false)
    }
  }

  const fmtTime = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
          new Date(iso)
        )
      : '—'

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-foreground font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-brand-400" />
            Pixel de tracking (first-party)
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Eventos de tus webs y landings: páginas vistas, CTAs, formularios, leads y ventas.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {sites === null && !error && (
        <div className="flex justify-center py-6 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      )}

      {sites !== null && sites.length === 0 && (
        <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
          Todavía no hay sitios configurados. Crea uno para obtener tu snippet.
        </div>
      )}

      {sites !== null && sites.length > 0 && (
        <div className="space-y-3">
          {sites.map((site) => (
            <div key={site.id} className="border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {site.name}{' '}
                    <span className="text-muted-foreground font-normal">· /{site.slug}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span>
                      Eventos 24h: <strong className="text-foreground">{site.events24h}</strong>
                    </span>
                    <span>
                      Errores: <strong className={site.errors24h > 0 ? 'text-red-400' : 'text-foreground'}>{site.errors24h}</strong>
                    </span>
                    <span>Último evento: {fmtTime(site.lastEventAt)}</span>
                    {site.allow_localhost && <span className="text-amber-400">· localhost permitido</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void toggle(site)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      site.tracking_enabled
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : 'bg-muted text-muted-foreground border-border'
                    }`}
                  >
                    {site.tracking_enabled ? <Check className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                    {site.tracking_enabled ? 'Activo' : 'Pausado'}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Pega esto antes de &lt;/head&gt; en la web
                  {site.allowed_origins.length > 0 ? ` (orígenes: ${site.allowed_origins.join(', ')})` : ' (sin orígenes autorizados: el pixel rechazará eventos hasta que añadas el dominio)'}
                  :
                </p>
                <div className="flex items-stretch gap-2">
                  <code className="flex-1 text-[11px] bg-muted/60 border border-border rounded-md px-3 py-2 overflow-x-auto whitespace-nowrap text-muted-foreground">
                    {snippetFor(site)}
                  </code>
                  <button
                    onClick={() => void copySnippet(site)}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  >
                    {copied === site.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    Copiar
                  </button>
                </div>
                {site.allowed_origins.length === 0 && (
                  <p className="text-xs text-amber-400/90">
                    Falta el dominio: añádelo a orígenes autorizados o el navegador recibirá 403.
                  </p>
                )}
                {site.tracking_enabled && site.events24h === 0 && (
                  <p className="text-xs text-amber-400/90">
                    Activo pero sin eventos en 24h: revisa que el snippet esté instalado y el dominio autorizado.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Alta de site */}
      <details className="border border-border rounded-lg">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm text-muted-foreground hover:text-foreground flex items-center gap-2">
          <Plus className="w-4 h-4" /> Añadir sitio
        </summary>
        <div className="px-4 pb-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Nombre (ej. Landing VSL)</span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full bg-muted/40 border border-border rounded-md px-3 py-2 text-sm text-foreground"
                placeholder="Landing principal"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Slug (data-site corto)</span>
              <input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                className="w-full bg-muted/40 border border-border rounded-md px-3 py-2 text-sm text-foreground"
                placeholder="landing-principal"
              />
            </label>
          </div>
          <label className="space-y-1 block">
            <span className="text-xs text-muted-foreground">Orígenes autorizados (uno por línea o separados por coma)</span>
            <textarea
              value={newOrigins}
              onChange={(e) => setNewOrigins(e.target.value)}
              rows={2}
              className="w-full bg-muted/40 border border-border rounded-md px-3 py-2 text-sm text-foreground font-mono text-xs"
              placeholder={'https://womendigitalclosers.com'}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={newLocalhost} onChange={(e) => setNewLocalhost(e.target.checked)} />
            Permitir localhost (solo desarrollo)
          </label>
          <button
            onClick={() => void create()}
            disabled={creating || !newName.trim() || !newSlug.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            Crear sitio
          </button>
        </div>
      </details>
    </section>
  )
}
