"use client"

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Plug, Loader2, Save, CheckCircle2, XCircle, KeyRound, ShieldAlert, ImagePlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/lib/tenant-context'

type Field = { key: string; label: string; type: 'text' | 'password' | 'textarea' | 'boolean'; secret: boolean; placeholder?: string; help?: string; hidden?: boolean }
type Group = { id: string; title: string; description: string; test?: boolean; fields: Field[] }
type StateEntry = { source: 'db' | 'env' | 'none'; secret: boolean; preview: string; value?: string }
type BrandAsset = { url: string; name: string }

export default function IntegracionesPage() {
  const tenant = useTenant()
  const [groups, setGroups] = useState<Group[]>([])
  const [state, setState] = useState<Record<string, StateEntry>>({})
  const [encReady, setEncReady] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [brandAssets, setBrandAssets] = useState<BrandAsset[]>([])
  const [assetUploading, setAssetUploading] = useState(false)

  async function load() {
    setLoading(true)
    const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones`)
    if (!r.ok) { toast.error('No autorizado o error cargando'); setLoading(false); return }
    const j = await r.json()
    setGroups(j.groups); setState(j.state); setEncReady(j.encReady)
    // precargar los no-secretos en los drafts para poder editarlos
    const d: Record<string, string> = {}
    for (const [k, v] of Object.entries(j.state as Record<string, StateEntry>)) {
      if (!v.secret && v.value != null) d[k] = v.value
    }
    setDrafts(d)
    const rawAssets = (j.state as Record<string, StateEntry>)['IG_BRAND_ASSETS']?.value
    if (rawAssets) {
      try {
        const parsed = JSON.parse(rawAssets)
        if (Array.isArray(parsed)) setBrandAssets(parsed)
      } catch { /* ignore */ }
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function saveBrandAssets(next: BrandAsset[]) {
    setBrandAssets(next)
    const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { IG_BRAND_ASSETS: JSON.stringify(next) } }),
    })
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast.error(j.error || 'No se pudo guardar el asset') }
  }

  async function uploadBrandAsset(file: File) {
    setAssetUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('purpose', 'brand-asset')
      const res = await fetch(`/api/${tenant}/evergreen/carruseles/upload`, { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Error al subir')
      await saveBrandAssets([...brandAssets, { url: j.url, name: j.name || file.name }])
      toast.success('Asset de marca añadido')
    } catch (e) {
      toast.error('No se pudo subir el asset: ' + (e as Error).message)
    } finally {
      setAssetUploading(false)
    }
  }

  async function removeBrandAsset(idx: number) {
    await saveBrandAssets(brandAssets.filter((_, i) => i !== idx))
  }

  async function saveGroup(g: Group) {
    setSavingId(g.id)
    const updates: Record<string, string> = {}
    for (const f of g.fields) if (drafts[f.key] !== undefined) updates[f.key] = drafts[f.key]
    const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })
    const j = await r.json()
    setSavingId(null)
    if (!r.ok) { toast.error(j.error || 'Error al guardar'); return }
    toast.success(`${g.title}: guardado`)
    // limpiar drafts de secretos (para que vuelvan a mostrarse enmascarados)
    setDrafts((prev) => {
      const next = { ...prev }
      for (const f of g.fields) if (f.secret) delete next[f.key]
      return next
    })
    load()
  }

  async function testGroup(g: Group) {
    setTestingId(g.id)
    const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test', group: g.id }),
    })
    const j = await r.json()
    setTestingId(null)
    if (j.ok) toast.success(`${g.title}: ${j.message || 'conexión OK'}`)
    else toast.error(`${g.title}: ${j.message || 'falló'}`)
  }

  if (loading) {
    return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Plug className="h-6 w-6" />
        <div>
          <h1 className="text-xl font-semibold">Integraciones</h1>
          <p className="text-sm text-muted-foreground">Configura aquí las APIs, tokens y cuentas. Se guardan cifrados y solo se usan en el servidor.</p>
        </div>
      </div>

      {!encReady && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Falta la variable <code>CONFIG_ENC_KEY</code> en el entorno. Sin ella no se pueden guardar los campos secretos (tokens/keys). Añádela en Vercel y vuelve a intentarlo.</span>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.id} className="rounded-lg border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-medium">{g.title}</h2>
              <p className="text-sm text-muted-foreground">{g.description}</p>
            </div>
            {g.test && (
              <Button variant="outline" size="sm" onClick={() => testGroup(g)} disabled={testingId === g.id}>
                {testingId === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Probar conexión'}
              </Button>
            )}
          </div>

          <div className="space-y-4">
            {g.fields.filter((f) => !f.hidden).map((f) => {
              const st = state[f.key]
              const badge = st?.source === 'db'
                ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" /> guardado</span>
                : st?.source === 'env'
                ? <span className="inline-flex items-center gap-1 text-xs text-blue-600"><KeyRound className="h-3 w-3" /> en entorno</span>
                : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><XCircle className="h-3 w-3" /> sin configurar</span>
              return (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={f.key} className="text-sm">{f.label}</Label>
                    {badge}
                  </div>
                  {f.type === 'textarea' ? (
                    <Textarea id={f.key} rows={5}
                      value={drafts[f.key] ?? ''}
                      placeholder={f.placeholder}
                      onChange={(e) => setDrafts({ ...drafts, [f.key]: e.target.value })} />
                  ) : (
                    <Input id={f.key}
                      type={f.secret ? 'password' : 'text'}
                      value={drafts[f.key] ?? ''}
                      placeholder={f.secret && st?.source !== 'none' ? `Guardado (${st?.preview}). Escribe para cambiar.` : f.placeholder}
                      onChange={(e) => setDrafts({ ...drafts, [f.key]: e.target.value })} />
                  )}
                  {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
                </div>
              )
            })}
          </div>

          {g.id === 'negocio' && (
            <div className="mt-5 space-y-2 rounded-md border border-dashed border-border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Assets de marca (logos, fotos)</Label>
                <label className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer">
                  {assetUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                  Añadir
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    disabled={assetUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) uploadBrandAsset(f)
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                Se usan en los carruseles/flyers generados por IA (logo, fotos de producto o equipo). Se guardan en el mismo bucket que las referencias visuales.
              </p>
              {brandAssets.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {brandAssets.map((a, idx) => (
                    <div key={`${a.url}-${idx}`} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt={a.name} className="h-12 w-12 rounded object-cover border border-border" />
                      <button
                        onClick={() => removeBrandAsset(idx)}
                        className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={() => saveGroup(g)} disabled={savingId === g.id}>
              {savingId === g.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Guardar {g.title}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
