'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Plug,
  Loader2,
  Save,
  CheckCircle2,
  XCircle,
  KeyRound,
  ShieldAlert,
  ImagePlus,
  X,
  RefreshCw,
  Megaphone,
  Camera,
  CalendarDays,
  Video,
  Mail,
  CreditCard,
  Users,
  Sparkles,
  Play,
  Landmark,
  Workflow,
  Radar,
  Building2,
  ExternalLink,
  Trash2,
  ShoppingBag,
  Gem,
  GraduationCap,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/lib/tenant-context'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { CATEGORY_LABELS, type IntegrationCategory } from '@/lib/integrations-catalog'

type Field = {
  key: string
  label: string
  type: 'text' | 'password' | 'textarea' | 'boolean'
  secret: boolean
  placeholder?: string
  help?: string
  hidden?: boolean
}
type Group = {
  id: string
  title: string
  description: string
  category: IntegrationCategory
  test?: boolean
  required?: string[]
  fields: Field[]
}

// Orden de las categorías tal y como se muestran en el panel.
const CATEGORY_ORDER: IntegrationCategory[] = [
  'marketing',
  'ventas',
  'pagos',
  'comunicacion',
  'ia',
  'seguridad',
  'negocio',
]
type StateEntry = { source: 'db' | 'env' | 'none'; secret: boolean; preview: string; value?: string }
type BrandAsset = { url: string; name: string }
type StripeReview = {
  summary: { total: number; matched: number; probable: number; mismatch: number; missing: number }
  rows: Array<{
    paymentId: string
    createdAt: string
    amount: number
    currency: string
    providerStatus: string
    email: string | null
    customer: string | null
    internalAmount: number | null
    reconciliation: 'matched' | 'probable' | 'mismatch' | 'missing'
  }>
}

const GROUP_META: Record<string, { icon: typeof Plug; tone: string; steps: string[]; docs?: string }> = {
  meta: {
    icon: Megaphone,
    tone: 'from-blue-500/25 to-indigo-500/5',
    steps: [
      'Crea o abre una app en Meta for Developers.',
      'Genera un token con ads_read y acceso a la cuenta publicitaria.',
      'Pega el token, guarda y usa “Probar conexión”.',
    ],
    docs: 'https://developers.facebook.com/docs/marketing-apis/get-started/',
  },
  instagram: {
    icon: Camera,
    tone: 'from-fuchsia-500/25 to-orange-500/5',
    steps: [
      'Conecta una cuenta profesional de Instagram a una página de Facebook.',
      'Obtén el identificador de usuario de Instagram Graph API.',
      'Guarda, verifica y después carga el histórico si lo necesitas.',
    ],
    docs: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/get-started/',
  },
  calendly: {
    icon: CalendarDays,
    tone: 'from-blue-500/25 to-cyan-500/5',
    steps: [
      'Abre Integraciones y aplicaciones en Calendly.',
      'Crea un Personal Access Token para esta cuenta.',
      'Pégalo aquí; nunca se muestra de nuevo después de guardarlo.',
    ],
    docs: 'https://developer.calendly.com/how-to-authenticate-with-personal-access-tokens/',
  },
  fathom: {
    icon: Video,
    tone: 'from-violet-500/25 to-blue-500/5',
    steps: [
      'Abre Settings → API Access en Fathom.',
      'Crea una API key con acceso a las reuniones de la cuenta.',
      'Guarda y prueba la conexión antes de cargar llamadas.',
    ],
    docs: 'https://developers.fathom.ai/quickstart',
  },
  email: {
    icon: Mail,
    tone: 'from-red-500/20 to-orange-500/5',
    steps: [
      'Crea una API key en el panel de Resend.',
      'Verifica el dominio remitente que usarás.',
      'Añade la clave y el remitente; luego prueba el envío.',
    ],
    docs: 'https://resend.com/docs/dashboard/api-keys/introduction',
  },
  stripe: {
    icon: CreditCard,
    tone: 'from-violet-500/25 to-indigo-500/5',
    steps: [
      'En Stripe abre Developers → API keys.',
      'Crea una clave restringida de solo lectura cuando sea posible.',
      'Guarda, prueba y usa “Revisar pagos” para cotejar los últimos movimientos.',
    ],
    docs: 'https://docs.stripe.com/keys',
  },
  ghl: {
    icon: Users,
    tone: 'from-orange-500/25 to-red-500/5',
    steps: [
      'En la subcuenta de HighLevel abre Settings → Private Integrations.',
      'Crea un token con permisos de lectura para contactos y calendarios.',
      'Copia también el Location ID de la subcuenta y prueba la conexión.',
    ],
    docs: 'https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken/index.html',
  },
  ai: {
    icon: Sparkles,
    tone: 'from-pink-500/20 to-violet-500/5',
    steps: [
      'Crea la clave en el proveedor de IA elegido.',
      'Pega únicamente una clave de servidor.',
      'Guarda y verifica; la clave queda cifrada y nunca llega al navegador.',
    ],
  },
  youtube: {
    icon: Play,
    tone: 'from-red-500/25 to-red-950/5',
    steps: [
      'Crea credenciales OAuth en Google Cloud.',
      'Habilita YouTube Data API v3.',
      'Añade client ID, secret y refresh token y prueba la conexión.',
    ],
    docs: 'https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps',
  },
  sequra: {
    icon: Landmark,
    tone: 'from-emerald-500/20 to-teal-500/5',
    steps: [
      'Solicita las credenciales API de tu comercio a SeQura.',
      'Usa primero el entorno de prueba si está disponible.',
      'Guarda y verifica antes de habilitar cobros.',
    ],
  },
  creatuagente: {
    icon: Workflow,
    tone: 'from-amber-500/20 to-orange-500/5',
    steps: [
      'Obtén el endpoint y secreto del webhook en CreaTuAgente.',
      'Configura el mismo secreto en ambos sistemas.',
      'Guarda y usa la prueba para validar la configuración.',
    ],
  },
  hotmart: {
    icon: ShoppingBag,
    tone: 'from-orange-500/20 to-red-500/5',
    steps: [
      'En Hotmart abre Herramientas → Credenciales y crea una app.',
      'Copia el Client ID y el Client Secret, y guarda el Hottok del webhook.',
      'Guarda y prueba la conexión antes de activar el cotejo de compras.',
    ],
    docs: 'https://developers.hotmart.com/docs/en/start/before-you-begin/',
  },
  whop: {
    icon: Gem,
    tone: 'from-purple-500/20 to-fuchsia-500/5',
    steps: [
      'En Whop abre Developer Settings y genera una API Key.',
      'Copia también el secreto del webhook si vas a recibir eventos.',
      'Guarda y prueba la conexión antes de activar el cotejo de membresías.',
    ],
    docs: 'https://dev.whop.com/introduction',
  },
  skool: {
    icon: GraduationCap,
    tone: 'from-teal-500/20 to-emerald-500/5',
    steps: [
      'Skool no tiene una API pública oficial: usa la clave/secreto que te facilite tu automatización (Zapier/Make) o soporte de Skool.',
      'Guarda aquí la clave y el secreto del webhook para poder cotejar altas/bajas y pagos.',
      'Sin prueba de conexión automática — verifica manualmente el primer evento recibido.',
    ],
  },
  tracking: {
    icon: Radar,
    tone: 'from-cyan-500/20 to-blue-500/5',
    steps: [
      'Genera una clave larga y exclusiva para esta subcuenta.',
      'Configúrala también en el emisor de eventos.',
      'Comprueba la recepción desde Data Health.',
    ],
  },
  negocio: {
    icon: Building2,
    tone: 'from-zinc-500/20 to-slate-500/5',
    steps: [
      'Completa los datos públicos de marca.',
      'Sube logos y recursos con permiso de uso.',
      'Guarda para reutilizarlos en contenidos y comunicaciones.',
    ],
  },
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
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [brandAssets, setBrandAssets] = useState<BrandAsset[]>([])
  const [assetUploading, setAssetUploading] = useState(false)
  const [stripeReview, setStripeReview] = useState<StripeReview | null>(null)
  const [reviewingStripe, setReviewingStripe] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [verification, setVerification] = useState<Record<string, 'ok' | 'error'>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones`)
    if (!r.ok) {
      toast.error('No autorizado o error cargando')
      setLoading(false)
      return
    }
    const j = await r.json()
    setGroups(j.groups)
    setState(j.state)
    setEncReady(j.encReady)
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
      } catch {
        /* ignore */
      }
    }
    setLoading(false)
  }, [tenant])
  useEffect(() => {
    void load()
  }, [load])

  async function saveBrandAssets(next: BrandAsset[]) {
    setBrandAssets(next)
    const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { IG_BRAND_ASSETS: JSON.stringify(next) } }),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      toast.error(j.error || 'No se pudo guardar el asset')
    }
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })
    const j = await r.json()
    setSavingId(null)
    if (!r.ok) {
      toast.error(j.error || 'Error al guardar')
      return
    }
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test', group: g.id }),
    })
    const j = await r.json()
    setTestingId(null)
    setVerification((prev) => ({ ...prev, [g.id]: j.ok ? 'ok' : 'error' }))
    if (j.ok) toast.success(`${g.title}: ${j.message || 'conexión OK'}`)
    else toast.error(`${g.title}: ${j.message || 'falló'}`)
  }

  async function disconnectGroup(g: Group) {
    if (
      !window.confirm(
        `¿Desconectar ${g.title}? Se borrarán sus credenciales, pero se conservarán todos los datos históricos importados.`
      )
    )
      return
    setSavingId(g.id)
    const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear: g.fields.map((field) => field.key) }),
    })
    setSavingId(null)
    if (!r.ok) return toast.error(`No se pudo desconectar ${g.title}`)
    setVerification((prev) => {
      const next = { ...prev }
      delete next[g.id]
      return next
    })
    toast.success(`${g.title} desconectada; el histórico se ha conservado`)
    await load()
  }

  async function syncHistory(g: Group) {
    setSyncingId(g.id)
    try {
      const direct: Record<string, string> = {
        meta: `/api/${tenant}/evergreen/meta/sync`,
        instagram: `/api/${tenant}/evergreen/instagram/sync`,
      }
      const r = await fetch(direct[g.id] || `/api/${tenant}/evergreen/settings/integraciones/history-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: direct[g.id] ? undefined : JSON.stringify({ provider: g.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'La sincronización falló')
      const imported = j.imported ?? j.inserted ?? j.synced ?? j.total ?? 0
      const updated = j.updated ?? j.matched ?? 0
      toast.success(`${g.title}: histórico sincronizado`, {
        description: `${imported} nuevos · ${updated} actualizados`,
      })
    } catch (error) {
      toast.error(`${g.title}: no se pudo sincronizar`, {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSyncingId(null)
    }
  }

  function canSyncHistory(groupId: string) {
    const requiredByProvider: Record<string, string[]> = {
      meta: ['META_ACCESS_TOKEN'],
      instagram: ['IG_USER_ID'],
      calendly: ['CALENDLY_API_TOKEN'],
      ghl: ['GHL_API_TOKEN', 'GHL_LOCATION_ID'],
      fathom: ['FATHOM_API_KEY'],
    }
    return (requiredByProvider[groupId] || []).every((key) => state[key]?.source !== 'none')
  }

  async function reviewStripe() {
    setReviewingStripe(true)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones/stripe-reconciliation`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j.error || 'No se pudo revisar Stripe')
        return
      }
      setStripeReview(j)
      toast.success('Pagos de Stripe cotejados con los cobros internos')
    } catch (error) {
      toast.error('No se pudo revisar Stripe', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setReviewingStripe(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SettingsNav current="integraciones" />
      <div className="flex items-center gap-3">
        <Plug className="h-6 w-6" />
        <div>
          <h1 className="text-xl font-semibold">Integraciones</h1>
          <p className="text-sm text-muted-foreground">
            Conecta tus fuentes de datos. Las claves se guardan cifradas y solo se usan en el servidor.
          </p>
        </div>
      </div>

      {!encReady && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Falta la variable <code>CONFIG_ENC_KEY</code> en el entorno. Sin ella no se pueden guardar los campos
            secretos (tokens/keys). Añádela en Vercel y vuelve a intentarlo.
          </span>
        </div>
      )}

      {CATEGORY_ORDER.filter((cat) => groups.some((g) => g.category === cat)).map((cat) => (
        <div key={cat} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {CATEGORY_LABELS[cat]}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {groups
              .filter((g) => g.category === cat)
              .map((g) => {
                const meta = GROUP_META[g.id] ?? { icon: Plug, tone: 'from-zinc-500/20 to-zinc-950/5', steps: [] }
                const Icon = meta.icon
                const configured = Boolean(
                  g.required?.length && g.required.every((key) => state[key]?.source !== 'none')
                )
                const verified = verification[g.id]
                const status =
                  testingId === g.id
                    ? 'Verificando…'
                    : verified === 'ok'
                      ? 'Conectada'
                      : verified === 'error'
                        ? 'Necesita atención'
                        : configured
                          ? 'Configurada · verificar'
                          : 'Sin conectar'
                const statusClass =
                  verified === 'ok'
                    ? 'text-emerald-400'
                    : verified === 'error'
                      ? 'text-red-400'
                      : configured
                        ? 'text-amber-400'
                        : 'text-muted-foreground'
                return (
                  <Fragment key={g.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(g.id)}
                      className={`group flex min-h-64 flex-col justify-between overflow-hidden rounded-2xl border border-border bg-gradient-to-br ${meta.tone} p-5 text-left transition hover:-translate-y-0.5 hover:border-foreground/20`}
                    >
                      <div>
                        <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-black/20">
                          <Icon className="h-7 w-7" />
                        </div>
                        <h2 className="text-lg font-semibold">{g.title}</h2>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{g.description}</p>
                      </div>
                      <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
                        <span className={`text-xs font-medium ${statusClass}`}>{status}</span>
                        <span className="text-sm font-medium text-foreground group-hover:underline">Configurar</span>
                      </div>
                    </button>

                    <Sheet open={selectedId === g.id} onOpenChange={(open) => setSelectedId(open ? g.id : null)}>
                      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
                        <SheetHeader className="pr-8">
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${meta.tone}`}
                            >
                              <Icon className="h-6 w-6" />
                            </div>
                            <div>
                              <SheetTitle>Configurar {g.title}</SheetTitle>
                              <p className={`text-xs font-medium ${statusClass}`}>{status}</p>
                            </div>
                          </div>
                          <SheetDescription>{g.description}</SheetDescription>
                        </SheetHeader>

                        <section className="my-6 space-y-2">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Cómo se conecta</h3>
                            {meta.docs && (
                              <a
                                href={meta.docs}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline"
                              >
                                Documentación oficial <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          {meta.steps.map((step, index) => (
                            <div
                              key={step}
                              className="flex gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm"
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                                {index + 1}
                              </span>
                              <span>{step}</span>
                            </div>
                          ))}
                        </section>

                        <div className="mb-5 flex flex-wrap gap-2">
                          {['meta', 'instagram', 'calendly', 'ghl', 'fathom'].includes(g.id) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => syncHistory(g)}
                              disabled={syncingId === g.id || !canSyncHistory(g.id)}
                            >
                              {syncingId === g.id ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="mr-2 h-4 w-4" />
                              )}
                              Cargar históricos
                            </Button>
                          )}
                          {g.test && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => testGroup(g)}
                              disabled={testingId === g.id}
                            >
                              {testingId === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Probar conexión'}
                            </Button>
                          )}
                        </div>

                        <div className="space-y-4">
                          {g.fields
                            .filter((f) => !f.hidden)
                            .map((f) => {
                              const st = state[f.key]
                              const badge =
                                st?.source === 'db' ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                                    <CheckCircle2 className="h-3 w-3" /> guardado
                                  </span>
                                ) : st?.source === 'env' ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                                    <KeyRound className="h-3 w-3" /> en entorno
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                    <XCircle className="h-3 w-3" /> sin configurar
                                  </span>
                                )
                              return (
                                <div key={f.key} className="space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <Label htmlFor={f.key} className="text-sm">
                                      {f.label}
                                    </Label>
                                    {badge}
                                  </div>
                                  {f.type === 'textarea' ? (
                                    <Textarea
                                      id={f.key}
                                      rows={5}
                                      value={drafts[f.key] ?? ''}
                                      placeholder={f.placeholder}
                                      onChange={(e) => setDrafts({ ...drafts, [f.key]: e.target.value })}
                                    />
                                  ) : f.type === 'boolean' ? (
                                    <label
                                      htmlFor={f.key}
                                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer"
                                    >
                                      <Checkbox
                                        id={f.key}
                                        checked={(drafts[f.key] ?? st?.value ?? '0') === '1'}
                                        onCheckedChange={(checked) =>
                                          setDrafts({ ...drafts, [f.key]: checked ? '1' : '0' })
                                        }
                                      />
                                      {(drafts[f.key] ?? st?.value ?? '0') === '1' ? 'Activado' : 'Desactivado'}
                                    </label>
                                  ) : (
                                    <Input
                                      id={f.key}
                                      type={f.secret ? 'password' : 'text'}
                                      value={drafts[f.key] ?? ''}
                                      placeholder={
                                        f.secret && st?.source !== 'none'
                                          ? `Guardado (${st?.preview}). Escribe para cambiar.`
                                          : f.placeholder
                                      }
                                      onChange={(e) => setDrafts({ ...drafts, [f.key]: e.target.value })}
                                    />
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
                                <p className="text-xs text-muted-foreground">
                                  Compara los últimos 100 PaymentIntents con los cobros Stripe de esta subcuenta.
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={reviewStripe}
                                disabled={reviewingStripe || state.STRIPE_SECRET_KEY?.source === 'none'}
                              >
                                {reviewingStripe ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-2 h-4 w-4" />
                                )}
                                Revisar pagos
                              </Button>
                            </div>
                            {stripeReview && (
                              <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                                  {[
                                    ['Revisados', stripeReview.summary.total],
                                    ['Cotejados', stripeReview.summary.matched],
                                    ['Probables', stripeReview.summary.probable],
                                    ['Diferencias', stripeReview.summary.mismatch],
                                    ['Sin registrar', stripeReview.summary.missing],
                                  ].map(([label, value]) => (
                                    <div key={String(label)} className="rounded border p-2">
                                      <p className="text-xs text-muted-foreground">{label}</p>
                                      <p className="font-semibold">{value}</p>
                                    </div>
                                  ))}
                                </div>
                                <div className="max-h-72 overflow-auto rounded border">
                                  <table className="w-full text-xs">
                                    <thead className="sticky top-0 bg-card text-left">
                                      <tr>
                                        <th className="p-2">Fecha</th>
                                        <th className="p-2">Cliente</th>
                                        <th className="p-2">Stripe</th>
                                        <th className="p-2">App</th>
                                        <th className="p-2">Cotejo</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {stripeReview.rows.map((row) => (
                                        <tr key={row.paymentId} className="border-t">
                                          <td className="p-2 whitespace-nowrap">
                                            {new Date(row.createdAt).toLocaleDateString('es-ES')}
                                          </td>
                                          <td className="p-2">{row.customer || row.email || 'Sin identificar'}</td>
                                          <td className="p-2 whitespace-nowrap">
                                            {row.amount.toLocaleString('es-ES', {
                                              style: 'currency',
                                              currency: row.currency,
                                            })}
                                          </td>
                                          <td className="p-2 whitespace-nowrap">
                                            {row.internalAmount == null
                                              ? '—'
                                              : row.internalAmount.toLocaleString('es-ES', {
                                                  style: 'currency',
                                                  currency: row.currency,
                                                })}
                                          </td>
                                          <td className="p-2">
                                            <span
                                              className={
                                                row.reconciliation === 'matched'
                                                  ? 'text-emerald-600'
                                                  : row.reconciliation === 'probable'
                                                    ? 'text-blue-600'
                                                    : 'text-amber-600'
                                              }
                                            >
                                              {row.reconciliation === 'matched'
                                                ? 'Cotejado'
                                                : row.reconciliation === 'probable'
                                                  ? 'Coincidencia probable'
                                                  : row.reconciliation === 'mismatch'
                                                    ? 'Diferencia'
                                                    : 'Falta en app'}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
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
                                {assetUploading ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <ImagePlus className="h-3.5 w-3.5" />
                                )}
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
                              Se usan en los carruseles/flyers generados por IA (logo, fotos de producto o equipo). Se
                              guardan en el mismo bucket que las referencias visuales.
                            </p>
                            {brandAssets.length > 0 && (
                              <div className="flex flex-wrap gap-2 pt-1">
                                {brandAssets.map((a, idx) => (
                                  <div key={`${a.url}-${idx}`} className="relative group">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={a.url}
                                      alt={a.name}
                                      className="h-12 w-12 rounded object-cover border border-border"
                                    />
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

                        <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-border pt-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => disconnectGroup(g)}
                            disabled={savingId === g.id || !configured}
                            className="text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Desconectar
                          </Button>
                          <Button size="sm" onClick={() => saveGroup(g)} disabled={savingId === g.id}>
                            {savingId === g.id ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="mr-2 h-4 w-4" />
                            )}
                            Guardar {g.title}
                          </Button>
                        </div>
                      </SheetContent>
                    </Sheet>
                  </Fragment>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}
