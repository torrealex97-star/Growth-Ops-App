"use client"

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Plug, Loader2, Save, CheckCircle2, XCircle, KeyRound, ShieldAlert, ImagePlus, X, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/lib/tenant-context'

type Field = { key: string; label: string; type: 'text' | 'password' | 'textarea' | 'boolean'; secret: boolean; placeholder?: string; help?: string; hidden?: boolean }
type Group = { id: string; title: string; description: string; test?: boolean; required?: string[]; fields: Field[] }
type StateEntry = { source: 'db' | 'env' | 'none'; secret: boolean; preview: string; value?: string }
type BrandAsset = { url: string; name: string }
type StripeReview = {
  summary: { total: number; matched: number; probable: number; mismatch: number; missing: number }
  rows: Array<{ paymentId: string; createdAt: string; amount: number; currency: string; providerStatus: string; email: string | null; customer: string | null; internalAmount: number | null; reconciliation: 'matched' | 'probable' | 'mismatch' | 'missing' }>
}

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
  const [stripeReview, setStripeReview] = useState<StripeReview | null>(null)
  const [reviewingStripe, setReviewingStripe] = useState(false)

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

  async function reviewStripe() {
    setReviewingStripe(true)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones/stripe-reconciliation`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j.error || 'No se pudo revisar Stripe'); return }
      setStripeReview(j)
      toast.success('Pagos de Stripe cotejados con los cobros internos')
    } catch (error) {
      toast.error('No se pudo revisar Stripe', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setReviewingStripe(false)
    }
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
              <div className="flex items-center gap-2">
                <h2 className="font-medium">{g.title}</h2>
                {g.required?.length ? (
                  g.required.every((key) => state[key]?.source !== 'none')
                    ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600">Operativa</span>
                    : <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">Incompleta</span>
                ) : null}
              </div>
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
                  ) : f.type === 'boolean' ? (
                    <label htmlFor={f.key} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer">
                      <Checkbox id={f.key}
                        checked={(drafts[f.key] ?? st?.value ?? '0') === '1'}
                        onCheckedChange={(checked) => setDrafts({ ...drafts, [f.key]: checked ? '1' : '0' })} />
                      {((drafts[f.key] ?? st?.value ?? '0') === '1') ? 'Activado' : 'Desactivado'}
                    </label>
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

          {g.id === 'stripe' && (
            <div className="mt-5 space-y-3 rounded-md border border-dashed p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Revisión y cotejo de pagos</p>
                  <p className="text-xs text-muted-foreground">Compara los últimos 100 PaymentIntents con los cobros Stripe de esta subcuenta.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={reviewStripe} disabled={reviewingStripe || state.STRIPE_SECRET_KEY?.source === 'none'}>
                  {reviewingStripe ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Revisar pagos
                </Button>
              </div>
              {stripeReview && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {[
                      ['Revisados', stripeReview.summary.total], ['Cotejados', stripeReview.summary.matched],
                      ['Probables', stripeReview.summary.probable], ['Diferencias', stripeReview.summary.mismatch],
                      ['Sin registrar', stripeReview.summary.missing],
                    ].map(([label, value]) => <div key={String(label)} className="rounded border p-2"><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold">{value}</p></div>)}
                  </div>
                  <div className="max-h-72 overflow-auto rounded border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card text-left"><tr><th className="p-2">Fecha</th><th className="p-2">Cliente</th><th className="p-2">Stripe</th><th className="p-2">App</th><th className="p-2">Cotejo</th></tr></thead>
                      <tbody>{stripeReview.rows.map((row) => (
                        <tr key={row.paymentId} className="border-t">
                          <td className="p-2 whitespace-nowrap">{new Date(row.createdAt).toLocaleDateString('es-ES')}</td>
                          <td className="p-2">{row.customer || row.email || 'Sin identificar'}</td>
                          <td className="p-2 whitespace-nowrap">{row.amount.toLocaleString('es-ES', { style: 'currency', currency: row.currency })}</td>
                          <td className="p-2 whitespace-nowrap">{row.internalAmount == null ? '—' : row.internalAmount.toLocaleString('es-ES', { style: 'currency', currency: row.currency })}</td>
                          <td className="p-2"><span className={row.reconciliation === 'matched' ? 'text-emerald-600' : row.reconciliation === 'probable' ? 'text-blue-600' : 'text-amber-600'}>{row.reconciliation === 'matched' ? 'Cotejado' : row.reconciliation === 'probable' ? 'Coincidencia probable' : row.reconciliation === 'mismatch' ? 'Diferencia' : 'Falta en app'}</span></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

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
