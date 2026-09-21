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
  ExternalLink,
  Trash2,
  ShoppingBag,
  Gem,
  GraduationCap,
  Settings2,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { EstadoPanel } from '@/components/ui/carga/EstadoPanel'
import { esFalloVisible, pedir, type Fallo } from '@/lib/ui/pedir'
import { useTenant } from '@/lib/tenant-context'
import { isAccountSelected, parseAccountIds, serializeAccountIds, toggleAccountId } from '@/lib/meta/accounts'
import { brandFor, type Brand } from '@/components/integrations/brands'
import { historyFor } from '@/lib/integrations/history'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { CATEGORY_LABELS, type IntegrationCategory } from '@/lib/integrations-catalog'
import { WebhooksEntrantesPanel } from '@/components/integrations/WebhooksEntrantesPanel'
import type { WebhookEntranteEstado } from '@/lib/webhooks/entrantes'
import { formatNumber } from '@/lib/utils'

type Field = {
  key: string
  label: string
  type: 'text' | 'password' | 'textarea' | 'boolean'
  secret: boolean
  placeholder?: string
  help?: string
  hidden?: boolean
  /** No hace falta para conectar: se pinta plegado bajo "Opciones avanzadas". */
  advanced?: boolean
}
type Group = {
  id: string
  title: string
  description: string
  category: IntegrationCategory
  test?: boolean
  required?: string[]
  // Guía de puesta en marcha: de dónde sale cada dato y qué hacer con él. Ver el catálogo.
  pasos?: { titulo: string; detalle: string }[]
  // Ruta del webhook entrante, con `{tenant}` por rellenar.
  webhookPath?: string
  fields: Field[]
}

// Orden de las categorías tal y como se muestran en el panel.
const CATEGORY_ORDER: IntegrationCategory[] = ['marketing', 'ventas', 'pagos', 'comunicacion', 'ia', 'seguridad']
type StateEntry = {
  source: 'db' | 'env' | 'none'
  secret: boolean
  preview: string
  value?: string
  /** Longitud del secreto guardado. Una longitud no es una credencial, y es lo único que delata un
   *  token pegado a medias, que Meta reporta como "Bad signature" y la máscara esconde. */
  length?: number
}
type BackfillRow = {
  paymentId: string
  createdAt: string
  amount: number
  currency: string
  email: string | null
  verdict: 'ya_registrado' | 'registrable' | 'sin_contacto' | 'no_es_venta' | 'reembolsado'
  reason: string
}
type StripeCustomerRow = {
  stripe_customer_id: string
  contact_id: string | null
  email: string | null
  name: string | null
  status: 'cliente' | 'activo_mensual' | 'moroso' | 'cancelado'
  subscription_id: string | null
  current_period_end: string | null
  last_synced_at: string
}
const STRIPE_CUSTOMER_STATUS_META: Record<StripeCustomerRow['status'], { label: string; className: string }> = {
  cliente: { label: 'Cliente (pago único)', className: 'text-blue-600' },
  activo_mensual: { label: 'Activo mensual', className: 'text-emerald-600' },
  moroso: { label: 'Moroso', className: 'text-red-600' },
  cancelado: { label: 'Cancelado', className: 'text-muted-foreground' },
}
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
      'Entra en developers.facebook.com y crea un token de acceso.',
      'Dale el permiso ads_read. Solo lectura: nunca escribimos en tu cuenta.',
      'Pega el token abajo y pulsa «Buscar cuentas».',
      'Elige la cuenta publicitaria que quieres enlazar y guarda.',
    ],
    docs: 'https://developers.facebook.com/docs/marketing-apis/get-started/',
  },
  instagram: {
    icon: Camera,
    tone: 'from-fuchsia-500/25 to-orange-500/5',
    steps: [
      'Conecta una cuenta profesional de Instagram a una página de Facebook.',
      'En Meta Business asigna esa página y la cuenta de Instagram al usuario que genera el token.',
      'Genera un token con permisos para leer el perfil, las publicaciones y sus insights; un token solo de Ads no sirve.',
      'Copia el identificador de Instagram Business, guarda y pulsa «Comprobar» antes de cargar el histórico.',
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
      'Anthropic y Groq son los motores base: pega sus claves de servidor.',
      'DeepSeek es opcional. Si pones su clave, pasa a atender el texto de esta subcuenta.',
      'Con DeepSeek puesto, pulsa “Buscar modelos” y elige el que quieras; vacío = automático.',
      'Guarda y verifica; las claves quedan cifradas y nunca llegan al navegador.',
    ],
    docs: 'https://api-docs.deepseek.com/',
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
}

// Estado que calcula el servidor en lib/integrations/health.ts. Tres luces: verde = comprobada
// contra su API y respondiendo; gris = sin configurar o sin comprobar; roja = error o sin sincronizar.
type IntegrationHealth = {
  id: string
  status: 'conectada' | 'parcial' | 'sin_configurar' | 'error'
  headline: string
  detail: string
  fix?: string
  checkedAt: string | null
  stale: boolean
  missingKeys: string[]
  syncs: {
    id: string
    label: string
    status: string
    detail: string
    rows: number | null
    /** Estado de los datos (lib/ops/sync-health.ts): por qué la tabla está como está. */
    dataState: string
    lastRunAt: string | null
    lastError: string | null
  }[]
}

/** Logotipo de marca. `currentColor` no vale aquí: cada marca tiene su color y es lo que la hace
 *  reconocible de un vistazo. */
function BrandMark({ brand, className, ...rest }: { brand: Brand; className?: string } & { 'aria-hidden'?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={brand.color} role="img" {...rest}>
      <title>{brand.title}</title>
      <path d={brand.path} />
    </svg>
  )
}

const LUZ: Record<IntegrationHealth['status'], { dot: string; text: string }> = {
  conectada: { dot: 'bg-emerald-400', text: 'text-emerald-400' },
  // Ámbar: funciona, pero una parte va con retraso. Ni verde (mentiría) ni rojo (no hay nada que
  // arreglar). Sin este estado la pantalla saltaba de verde a rojo sin cambio real.
  parcial: { dot: 'bg-amber-400', text: 'text-amber-400' },
  sin_configurar: { dot: 'bg-zinc-500', text: 'text-muted-foreground' },
  error: { dot: 'bg-red-400', text: 'text-red-400' },
}

// "hace 3 horas" en vez de una fecha: lo que importa de una comprobación es su antigüedad, porque un
// verde de la semana pasada no dice nada de hoy.
function haceCuanto(iso: string | null): string | null {
  if (!iso) return null
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms) || ms < 0) return null
  const min = Math.round(ms / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

/** Campo de la sección avanzada. Mismo comportamiento que el formulario principal, sin duplicar su
 *  JSX entero: aquí solo hacen falta texto, contraseña, casilla y área de texto. */
function AdvancedField({
  field,
  state,
  value,
  onChange,
}: {
  field: { key: string; label: string; type: string; secret: boolean; placeholder?: string; help?: string }
  state?: StateEntry
  value?: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={field.key} className="text-sm">
          {field.label}
        </Label>
        <span className="text-muted-foreground text-xs">
          {state?.source === 'db' ? 'guardado' : state?.source === 'env' ? 'en entorno' : 'sin configurar'}
        </span>
      </div>
      {field.type === 'textarea' ? (
        <Textarea
          id={field.key}
          rows={4}
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === 'boolean' ? (
        <label
          htmlFor={field.key}
          className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <Checkbox
            id={field.key}
            checked={(value ?? state?.value ?? '0') === '1'}
            onCheckedChange={(checked) => onChange(checked ? '1' : '0')}
          />
          {(value ?? state?.value ?? '0') === '1' ? 'Activado' : 'Desactivado'}
        </label>
      ) : (
        <Input
          id={field.key}
          type={field.secret ? 'password' : 'text'}
          value={value ?? ''}
          placeholder={
            field.secret && state?.source !== 'none'
              ? `Guardado (${state?.preview}). Escribe para cambiar.`
              : field.placeholder
          }
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.help ? <p className="text-muted-foreground text-xs">{field.help}</p> : null}
    </div>
  )
}

/**
 * Guía de puesta en marcha de una integración.
 *
 * Las credenciales no se "rellenan": se van a buscar a otro producto. Sin decir DÓNDE está cada
 * valor, configurar una integración exige que haya alguien técnico delante — y si además hay que
 * montar a mano la URL de un webhook, aparece la errata que luego cuesta una tarde encontrar.
 *
 * Por eso la dirección se pinta ya montada con la subcuenta y con botón de copiar, y cada paso dice
 * de dónde sale el dato. Solo aparece en las integraciones que declaran `pasos` o `webhookPath`.
 */
function GuiaIntegracion({ grupo, tenant }: { grupo: Group; tenant: string }) {
  const url = grupo.webhookPath
    ? `${typeof window === 'undefined' ? '' : window.location.origin}${grupo.webhookPath.replace('{tenant}', tenant)}`
    : null
  if (!grupo.pasos?.length && !url) return null

  return (
    <section className="border-border bg-muted/20 my-5 space-y-4 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Cómo configurarlo</h3>

      {url ? (
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs">
            Dirección del webhook de esta subcuenta. Cópiala tal cual: lleva dentro el identificador de la subcuenta y
            no vale la de otra.
          </p>
          <div className="flex items-center gap-2">
            <code className="bg-background/60 border-border flex-1 overflow-x-auto rounded border px-2 py-1.5 text-xs">
              {url}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(url)
                  .then(() => toast.success('Dirección copiada'))
                  // Sin portapapeles (navegador antiguo o permiso denegado) se puede seleccionar a mano:
                  // el texto está a la vista, así que el fallo no deja a nadie bloqueado.
                  .catch(() => toast.error('No se pudo copiar: selecciónala y cópiala a mano'))
              }}
            >
              Copiar
            </Button>
          </div>
        </div>
      ) : null}

      {grupo.pasos?.length ? (
        <ol className="space-y-3">
          {grupo.pasos.map((paso, i) => (
            <li key={paso.titulo} className="flex gap-3">
              <span className="bg-primary/10 text-primary mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                {i + 1}
              </span>
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{paso.titulo}</p>
                <p className="text-muted-foreground text-xs leading-relaxed">{paso.detalle}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

export default function IntegracionesPage() {
  const tenant = useTenant()
  const [groups, setGroups] = useState<Group[]>([])
  const [state, setState] = useState<Record<string, StateEntry>>({})
  const [encReady, setEncReady] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  // El motivo del fallo, para poder enseñarlo en pantalla en vez de dejar un loader eterno.
  const [falloCarga, setFalloCarga] = useState<Fallo | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [stripeReview, setStripeReview] = useState<StripeReview | null>(null)
  const [reviewingStripe, setReviewingStripe] = useState(false)
  const [stripeCustomers, setStripeCustomers] = useState<StripeCustomerRow[] | null>(null)
  const [syncingCustomers, setSyncingCustomers] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // El estado de cada integración lo calcula el servidor (credenciales + última comprobación real
  // contra su API + si sus sincronizaciones pueden funcionar). Antes era un `verification` local que
  // solo existía si habías pulsado "probar" en esa visita: al recargar, todo volvía a "configurada".
  const [health, setHealth] = useState<Record<string, IntegrationHealth>>({})
  // Integración recién conectada que todavía no ha dicho si quiere traer el pasado.
  const [askHistory, setAskHistory] = useState<string | null>(null)
  // Cuentas publicitarias que ve el token de Meta. null = todavía no se han buscado.
  // Importador de pagos de Stripe a ventas. Nada se escribe sin que aquí se elija producto y plan.
  const [backfill, setBackfill] = useState<BackfillRow[] | null>(null)
  const [backfillLoading, setBackfillLoading] = useState(false)
  const [syncingPayments, setSyncingPayments] = useState(false)
  const [catalogo, setCatalogo] = useState<{
    products: { id: string; name: string }[]
    plans: { id: string; name: string; method: string | null }[]
  } | null>(null)
  const [importChoice, setImportChoice] = useState<{ productId: string; planId: string }>({ productId: '', planId: '' })
  const [importing, setImporting] = useState(false)
  const [metaAccounts, setMetaAccounts] = useState<{ id: string; name: string; active: boolean }[] | null>(null)
  // Modelos que la clave de IA puede usar DE VERDAD, preguntados al proveedor.
  const [modelosIa, setModelosIa] = useState<{ id: string }[] | null>(null)
  const [buscandoModelos, setBuscandoModelos] = useState(false)
  const [findingAccounts, setFindingAccounts] = useState(false)
  // La mitad receptora de las integraciones: los webhooks que los proveedores llaman. El estado
  // lo calcula el servidor con evidencia real (audit_logs / raw_events), nunca el navegador.
  const [webhooksEntrantes, setWebhooksEntrantes] = useState<WebhookEntranteEstado[]>([])

  // ESTA ERA LA PANTALLA QUE SE QUEDABA CARGANDO.
  //
  // El código anterior hacía `await fetch(...)` y `await r.json()` SIN try/catch/finally. Con eso basta:
  // una red que se corta un segundo, o un 502 que devuelve el HTML de error de Vercel en vez de JSON,
  // hace que el await rechace, la función se abandone a mitad y nadie llegue nunca a `setLoading(false)`.
  // Resultado: "Cargando…" para siempre, sin error, sin botón y sin forma de salir salvo recargar.
  //
  // Ahora la petición pasa por `pedir` (timeout, cancelación y clasificación del fallo, sin lanzar), el
  // motivo se guarda en estado para poder enseñarlo, y `finally` apaga el loader por todos los caminos.
  const load = useCallback(async () => {
    setLoading(true)
    setFalloCarga(null)
    try {
      const res = await pedir<{
        groups: Group[]
        state: Record<string, StateEntry>
        encReady: boolean
        health?: IntegrationHealth[]
        webhooksEntrantes?: WebhookEntranteEstado[]
      }>(`/api/${tenant}/evergreen/settings/integraciones`)

      if (!res.ok) {
        // Una cancelación por navegar a otra pantalla no es un error que enseñar.
        if (!esFalloVisible(res)) return
        setFalloCarga(res)
        // El 403 no se anuncia como "error cargando": el mensaje ya viene clasificado por tipo.
        toast.error(res.mensaje)
        return
      }

      const j = res.data
      setGroups(j.groups)
      setState(j.state)
      setEncReady(j.encReady)
      setHealth(Object.fromEntries(((j.health ?? []) as IntegrationHealth[]).map((h) => [h.id, h])))
      setWebhooksEntrantes(j.webhooksEntrantes ?? [])
      // precargar los no-secretos en los drafts para poder editarlos
      const d: Record<string, string> = {}
      for (const [k, v] of Object.entries(j.state as Record<string, StateEntry>)) {
        if (!v.secret && v.value != null) d[k] = v.value
      }
      setDrafts(d)
    } finally {
      setLoading(false)
    }
  }, [tenant])
  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (selectedId === 'stripe' && stripeCustomers === null) void loadStripeCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Vuelta del flujo OAuth de Google (provider=ga4/gmail). El callback de la app redirige a ESTA
  // pantalla con el resultado en la URL; el token se guarda en el callback y nunca pasa por el
  // navegador. YouTube usa otro camino (redirect del playground + pegar código): ver abajo.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const res = sp.get('google')
    if (!res) return
    const servicio = sp.get('servicio')
    if (res === 'conectada') toast.success(`${servicio === 'youtube' ? 'YouTube' : 'Google'} conectado`)
    else if (res === 'cancelada') toast.info('Autorización cancelada')
    else {
      const motivos: Record<string, string> = {
        sin_credenciales: 'Faltan las credenciales OAuth de la integración. Guárdalas primero.',
        sin_refresh_token: 'Google no devolvió un refresh token. Vuelve a autorizar.',
        no_se_pudo_guardar: 'No se pudo guardar la conexión.',
        sin_config_enc_key: 'Falta CONFIG_ENC_KEY en el servidor.',
        permisos_incompletos: 'La autorización quedó incompleta: faltaron permisos solicitados.',
      }
      toast.error(motivos[sp.get('motivo') || ''] || 'No se pudo completar la autorización')
    }
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  // Al abrir una integración se comprueba contra su API si no hay comprobación fresca. Es UNA llamada
  // (la de la que se abre), no diecisiete al cargar la pantalla, y es lo que hace que el estado sea
  // información de ahora y no de la última vez que alguien pulsó un botón.
  useEffect(() => {
    if (!selectedId) return
    const grupo = groups.find((g) => g.id === selectedId)
    const estado = health[selectedId]
    if (!grupo?.test || !estado) return
    if (estado.missingKeys.length > 0) return // sin credenciales no hay nada que preguntar a la API
    if (estado.checkedAt && !estado.stale) return
    if (testingId) return
    void testGroup(grupo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

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
    await load()
    // Se comprueba al momento, y solo si la API responde bien se ofrece traer el pasado: ofrecer una
    // carga de histórico con una credencial que no funciona es mandar al usuario directo a un error.
    if (g.test) {
      const probe = await testGroup(g)
      if (probe?.ok && historyFor(g.id)) setAskHistory(g.id)
    } else if (historyFor(g.id)) {
      setAskHistory(g.id)
    }
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
    if (j.ok) toast.success(`${g.title}: ${j.message || 'conexión OK'}`)
    else toast.error(`${g.title}: ${j.message || 'falló'}`)
    // Se recarga el estado del servidor en vez de deducirlo aquí: el veredicto queda guardado, así
    // que la luz tiene que salir de la misma fuente que al entrar en la pantalla.
    await load()
    return j as { ok: boolean; message?: string }
  }

  // Borra UNA clave. Hace falta porque vaciar el campo y guardar NO borra un secreto: el endpoint
  // ignora los secretos en blanco a propósito (si no, el campo enmascarado los borraría cada vez que
  // guardas otra cosa). Sin esto, una credencial mal pegada se queda para siempre y la única salida
  // es "Desconectar", que borra TODAS las de esa integración.
  async function clearField(g: Group, key: string, label: string) {
    if (!window.confirm(`¿Borrar "${label}" de ${g.title}? Las demás credenciales se mantienen.`)) return
    setSavingId(g.id)
    const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear: [key] }),
    })
    setSavingId(null)
    if (!r.ok) {
      toast.error(`No se pudo borrar ${label}`)
      return
    }
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    toast.success(`${label} borrado`)
    await load()
    if (g.test) void testGroup(g)
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
    toast.success(`${g.title} desconectada; el histórico se ha conservado`)
    await load()
  }

  // Busca las cuentas que ve el token ANTES de guardar nada: si hubiera que guardar primero, se
  // guardaría un token inválido para descubrir que lo es.
  async function buscarModelosIa() {
    setBuscandoModelos(true)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ia-modelos', token: drafts.DEEPSEEK_API_KEY || undefined }),
      })
      const j = await r.json()
      if (!j.ok) {
        setModelosIa([])
        toast.error(j.message || 'No se pudieron leer los modelos')
        return
      }
      setModelosIa(j.modelos)
      // Si el modelo guardado ya no existe en la cuenta, se avisa en vez de dejarlo fallar en cada uso.
      if (j.aviso) toast.warning(j.aviso)
      else if (!drafts.DEEPSEEK_MODEL && j.sugerido) setDrafts({ ...drafts, DEEPSEEK_MODEL: j.sugerido })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setBuscandoModelos(false)
    }
  }

  async function findMetaAccounts() {
    setFindingAccounts(true)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'meta-accounts', token: drafts.META_ACCESS_TOKEN || undefined }),
      })
      const j = await r.json()
      if (!j.ok) {
        setMetaAccounts([])
        toast.error(j.message || 'No se pudieron buscar las cuentas')
        return
      }
      setMetaAccounts(j.accounts)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setFindingAccounts(false)
    }
  }

  async function loadBackfill() {
    setBackfillLoading(true)
    try {
      const [informe, catalogoRes] = await Promise.all([
        fetch(`/api/${tenant}/evergreen/stripe-backfill`),
        fetch(`/api/${tenant}/evergreen/stripe-backfill/registrar`),
      ])
      const j = await informe.json()
      if (!informe.ok) {
        toast.error(j.error || 'No se pudo leer el informe de Stripe')
        return
      }
      setBackfill((j.pendientes ?? []) as BackfillRow[])
      if (catalogoRes.ok) setCatalogo(await catalogoRes.json())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setBackfillLoading(false)
    }
  }

  // Registra como ventas los pagos elegidos. El servidor vuelve a clasificar cada uno antes de
  // escribir: lo que se ve aquí es de hace unos segundos, y un pago pudo reembolsarse entre medias.
  async function registrarVentas(pagos: string[]) {
    if (!importChoice.productId || !importChoice.planId) {
      toast.error('Elige antes producto y plan de pago')
      return
    }
    // Los pagos de una misma persona son los PLAZOS de una venta, así que el servidor agrupa por
    // cliente: N pagos pueden salir como menos ventas. El aviso lo dice para que el número final no
    // sorprenda.
    if (
      !window.confirm(
        `Se van a registrar ${pagos.length} pagos como ventas (los plazos de una misma persona se agrupan en una sola venta). ¿Continuar?`
      )
    )
      return
    setImporting(true)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/stripe-backfill/registrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentIds: pagos,
          productId: importChoice.productId,
          paymentPlanId: importChoice.planId,
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        toast.error(j.error || 'No se pudieron registrar')
        return
      }
      const fallos = (j.resultados ?? []).filter((x: { ok: boolean }) => !x.ok)
      const ventas = typeof j.ventasCreadas === 'number' ? j.ventasCreadas : j.registradas
      toast.success(`${j.registradas} de ${j.total} pagos registrados en ${ventas} ventas`, {
        description: fallos.length ? `${fallos.length} sin registrar: ${fallos[0].motivo}` : 'Ya aparecen en Ventas.',
      })
      await loadBackfill()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setImporting(false)
    }
  }

  // Backfill de custom fields de GHL: relee contactos en GHL y puebla contacts.custom_fields
  // (merge idempotente). El resultado del run queda en el historial de syncs del panel.
  async function backfillCustomFields() {
    setSyncingId('ghl-custom-fields')
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones/custom-fields-backfill`, {
        method: 'POST',
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'El backfill falló')
      toast.success('Campos personalizados importados', {
        description: `${j.conCampos ?? 0} contactos actualizados · ${j.definicionesCreadas ?? 0} campos nuevos · ${j.cortado ? 'parcial (vuelve a lanzar para continuar)' : 'completo'}`,
      })
    } catch (error) {
      toast.error('No se pudieron importar los campos', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSyncingId(null)
    }
  }

  async function syncHistory(g: Group) {
    setSyncingId(g.id)
    setAskHistory(null)
    try {
      // Instagram conserva su propia ruta; el resto entra por history-sync, que es donde vive el
      // criterio de "hasta dónde se pide" de cada proveedor.
      const direct: Record<string, string> = {
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

  // ESPEJO DE PAGOS (fuente primaria de Cash Collected, §2): lee PaymentIntents liquidados con
  // su devolución y hace upsert idempotente en stripe_payments. Idempotente: pulsar de nuevo
  // nunca duplica; con `truncated`, repetir continúa donde se quedó.
  async function syncStripePayments() {
    setSyncingPayments(true)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/stripe-payments-sync`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j.error || j.message || 'No se pudo sincronizar los pagos')
        return
      }
      const d = j.detail ?? {}
      toast.success(
        d.truncado
          ? `Pagos sincronizados en parte: ${d.pagos ?? 0}. Quedaban más por leer — pulsa de nuevo para continuar.`
          : `Pagos sincronizados: ${d.pagos ?? 0} (${d.devueltos ?? 0} con devolución).`
      )
    } catch (error) {
      toast.error('No se pudo sincronizar los pagos', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSyncingPayments(false)
    }
  }

  async function loadStripeCustomers() {
    // Se llama con `void` desde un useEffect: un fetch que rechace aquí quedaba como rechazo de promesa
    // sin gestionar, y la lista se quedaba en `null` (= "cargando") para siempre.
    const res = await pedir<{ rows?: StripeCustomerRow[] }>(
      `/api/${tenant}/evergreen/settings/integraciones/stripe-customers`
    )
    setStripeCustomers(res.ok ? (res.data?.rows ?? []) : [])
  }

  async function syncStripeCustomersHandler() {
    setSyncingCustomers(true)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones/stripe-customers`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j.error || 'No se pudo sincronizar la base de clientes')
        return
      }
      toast.success('Base de clientes actualizada con Stripe', {
        description: `${j.matched} vinculados a contactos existentes · ${j.unmatched} sin vincular`,
      })
      await loadStripeCustomers()
    } catch (error) {
      toast.error('No se pudo sincronizar con Stripe', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSyncingCustomers(false)
    }
  }

  // El fallo se enseña, con su motivo real y su botón. Antes este camino no existía: si la carga
  // fallaba, se quedaba el "Cargando…" de abajo indefinidamente.
  if (falloCarga) {
    return (
      <div className="p-8">
        <EstadoPanel
          estado={falloCarga.tipo === 'permiso' ? 'sin_permiso' : 'error'}
          que="las integraciones"
          mensajeError={falloCarga.mensaje}
          onReintentar={falloCarga.reintentable ? () => void load() : undefined}
        />
      </div>
    )
  }

  if (loading) {
    // Skeleton con la forma real de la pantalla (lista de integraciones), no un spinner suelto: así no
    // salta el contenido al llegar. Y no aparece nada si la carga baja de 300 ms.
    return (
      <div className="p-8">
        <EstadoPanel estado="cargando" que="las integraciones" filasSkeleton={8} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
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

      {/* La mitad receptora de las integraciones: URLs exactas por subcuenta, estado del secret
          y último evento recibido con su evidencia. Antes de este bloque, dar de alta un webhook
          exigía cazar la URL en una guía y descubrir a posteriori que nada entraba. */}
      <WebhooksEntrantesPanel webhooks={webhooksEntrantes} tenant={tenant} />

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
                const brand = brandFor(g.id)
                const historia = historyFor(g.id)
                const h = health[g.id]
                const luz = LUZ[h?.status ?? 'sin_configurar']
                const status = testingId === g.id ? 'Comprobando…' : (h?.headline ?? 'Sin configurar')
                const statusClass = luz.text
                const comprobado = haceCuanto(h?.checkedAt ?? null)
                return (
                  <Fragment key={g.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(g.id)}
                      style={{ ['--brand' as string]: brand?.color ?? '#8b8b93' }}
                      className="group relative isolate flex min-h-60 flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-5 text-left transition-all duration-300 hover:border-[color:var(--brand)]/40 hover:shadow-[0_0_40px_-12px_var(--brand)]"
                    >
                      {/* El resplandor de marca vive en una capa propia y solo sube de opacidad al
                          pasar por encima: iluminar la tarjeta entera taparía el texto. */}
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07] transition-opacity duration-300 group-hover:opacity-[0.16]"
                        style={{
                          background: `radial-gradient(120% 80% at 85% 0%, var(--brand) 0%, transparent 60%)`,
                        }}
                      />
                      {/* Marca de agua: el mismo logotipo, enorme y sangrando por la esquina. */}
                      {brand ? (
                        <BrandMark
                          brand={brand}
                          aria-hidden
                          className="pointer-events-none absolute -right-6 -top-6 -z-10 h-40 w-40 opacity-[0.06] transition-opacity duration-300 group-hover:opacity-[0.14]"
                        />
                      ) : (
                        <Icon
                          aria-hidden
                          className="pointer-events-none absolute -right-6 -top-6 -z-10 h-40 w-40 opacity-[0.05] transition-opacity duration-300 group-hover:opacity-[0.12]"
                        />
                      )}

                      <div>
                        <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-black/30">
                          {brand ? <BrandMark brand={brand} className="h-7 w-7" /> : <Icon className="h-7 w-7" />}
                        </div>
                        <h2 className="text-lg font-semibold">{g.title}</h2>
                        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{g.description}</p>
                      </div>

                      <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
                        <span className="text-foreground inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium transition-colors group-hover:bg-white/10">
                          <Settings2 className="h-3.5 w-3.5" />
                          {h?.status === 'conectada' || h?.status === 'parcial' ? 'Ver' : 'Configurar'}
                        </span>
                        <span className="flex items-center gap-2 text-xs font-medium">
                          {/* La luz y el texto dicen lo mismo: el color por sí solo no sirve a quien
                              no distingue verde de rojo. */}
                          <span className={`h-2 w-2 shrink-0 rounded-full ${luz.dot}`} aria-hidden />
                          <span className={statusClass}>{status}</span>
                        </span>
                      </div>
                    </button>

                    <Sheet open={selectedId === g.id} onOpenChange={(open) => setSelectedId(open ? g.id : null)}>
                      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
                        <SheetHeader className="pr-8">
                          <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-black/30">
                              {brand ? <BrandMark brand={brand} className="h-6 w-6" /> : <Icon className="h-6 w-6" />}
                            </div>
                            <div>
                              <SheetTitle>
                                {h?.status === 'conectada' || h?.status === 'parcial'
                                  ? g.title
                                  : `Configurar ${g.title}`}
                              </SheetTitle>
                              <p className="flex items-center gap-2 text-xs font-medium">
                                <span className={`h-2 w-2 shrink-0 rounded-full ${luz.dot}`} aria-hidden />
                                <span className={statusClass}>{status}</span>
                                {comprobado ? (
                                  <span className="text-muted-foreground font-normal">· comprobado {comprobado}</span>
                                ) : null}
                              </p>
                            </div>
                          </div>
                          <SheetDescription>{g.description}</SheetDescription>
                        </SheetHeader>

                        <GuiaIntegracion grupo={g} tenant={tenant} />

                        {h ? (
                          <section
                            className={`my-5 space-y-2 rounded-lg border p-3 text-sm ${
                              h.status === 'conectada'
                                ? 'border-emerald-500/30 bg-emerald-500/5'
                                : h.status === 'error'
                                  ? 'border-red-500/30 bg-red-500/5'
                                  : h.status === 'parcial'
                                    ? 'border-amber-500/30 bg-amber-500/5'
                                    : 'border-border bg-muted/30'
                            }`}
                          >
                            <p className="flex items-start gap-2">
                              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${luz.dot}`} aria-hidden />
                              <span>{h.detail}</span>
                            </p>
                            {/* El arreglo va PEGADO al problema. Un mensaje de error sin el siguiente
                                paso obliga a buscar en documentación de APIs, que es exactamente lo
                                que no debería tener que hacer quien usa esto. */}
                            {h.fix ? <p className="text-muted-foreground pl-4 text-xs">{h.fix}</p> : null}
                            {h.missingKeys.length > 0 ? (
                              <p className="text-muted-foreground pl-4 text-xs">Falta: {h.missingKeys.join(', ')}</p>
                            ) : null}
                            {h.syncs.length > 0 ? (
                              <ul className="text-muted-foreground space-y-1 pl-4 text-xs">
                                {h.syncs.map((sync) => (
                                  <li key={sync.id}>
                                    <span
                                      className={
                                        sync.status === 'ok'
                                          ? 'text-emerald-400'
                                          : sync.status === 'sync_fallido' || sync.status === 'sin_planificador'
                                            ? 'text-red-400'
                                            : ''
                                      }
                                    >
                                      {sync.label}
                                    </span>
                                    : {sync.detail}
                                    {/* Cuándo corrió por última vez. Sin esto, "hay 12 filas" no dice
                                        si son de hoy o de hace tres meses. */}
                                    {sync.lastRunAt ? (
                                      <span className="text-muted-foreground/70">
                                        {' '}
                                        · última vez {haceCuanto(sync.lastRunAt)}
                                      </span>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {g.test ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void testGroup(g)}
                                disabled={testingId === g.id}
                              >
                                {testingId === g.id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-2 h-4 w-4" />
                                )}
                                Comprobar ahora
                              </Button>
                            ) : null}
                          </section>
                        ) : null}

                        {/* Cuando la integración funciona, la guía de conexión es ruido: se pliega. */}
                        <details className="my-6" open={h?.status !== 'conectada'}>
                          <summary className="cursor-pointer text-sm font-semibold">Cómo se conecta</summary>
                          <section className="mt-2 space-y-2">
                            <div className="flex items-center justify-between">
                              <h3 className="sr-only">Cómo se conecta</h3>
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
                        </details>

                        {historia ? (
                          <section
                            className={`mb-5 space-y-2 rounded-lg border p-3 text-sm ${
                              askHistory === g.id ? 'border-primary/50 bg-primary/5' : 'border-border'
                            }`}
                          >
                            <p className="font-medium">
                              {askHistory === g.id ? '¿Traemos también el pasado?' : 'Cargar histórico'}
                            </p>
                            {/* Qué trae y hasta dónde llega, dicho ANTES de pulsar: una carga que
                                tarda varios minutos sin avisar parece que se ha colgado. */}
                            <p className="text-muted-foreground text-xs">
                              {historia.brings} {historia.reach}
                              {historia.slow ? ' Puede tardar unos minutos.' : ''}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant={askHistory === g.id ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => syncHistory(g)}
                                disabled={syncingId === g.id || !canSyncHistory(g.id)}
                              >
                                {syncingId === g.id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-2 h-4 w-4" />
                                )}
                                {syncingId === g.id ? 'Trayendo histórico…' : 'Cargar histórico'}
                              </Button>
                              {askHistory === g.id ? (
                                <Button variant="ghost" size="sm" onClick={() => setAskHistory(null)}>
                                  Ahora no
                                </Button>
                              ) : null}
                            </div>
                          </section>
                        ) : null}

                        {g.id === 'ghl' ? (
                          <section className="mb-5 space-y-2 rounded-lg border border-border p-3 text-sm">
                            <p className="font-medium">Importar campos personalizados</p>
                            <p className="text-muted-foreground text-xs">
                              Relee los contactos en GHL y copia aquí sus campos personalizados (los que configures en
                              GHL como «Custom Fields»), creándolos en la subcuenta si no existen. Puedes lanzarlo
                              tantas veces como quieras: no duplica ni pisa lo ya guardado.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => backfillCustomFields()}
                              disabled={syncingId === 'ghl-custom-fields'}
                            >
                              {syncingId === 'ghl-custom-fields' ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="mr-2 h-4 w-4" />
                              )}
                              {syncingId === 'ghl-custom-fields' ? 'Importando campos…' : 'Importar campos'}
                            </Button>
                          </section>
                        ) : null}

                        {g.id === 'meta' ? (
                          <section className="mb-5 space-y-3 rounded-lg border border-border p-3">
                            <div>
                              <p className="text-sm font-medium">Elegir cuenta publicitaria</p>
                              <p className="text-muted-foreground text-xs">
                                Pega arriba el token y busca: te salen las cuentas que ese token ve, con su nombre. No
                                hace falta que averigües ningún identificador.
                              </p>
                            </div>
                            <Button variant="outline" size="sm" onClick={findMetaAccounts} disabled={findingAccounts}>
                              {findingAccounts ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Search className="mr-2 h-4 w-4" />
                              )}
                              Buscar cuentas
                            </Button>
                            {metaAccounts?.length === 0 ? (
                              <p className="text-muted-foreground text-xs">Ese token no ve ninguna cuenta.</p>
                            ) : null}
                            {metaAccounts && metaAccounts.length > 0 ? (
                              <div className="space-y-1">
                                {metaAccounts.map((acc) => {
                                  // Comparación por id (no por substring: "act_12" hacía salir marcada
                                  // también a "act_123") y con la MISMA función que usa el servidor.
                                  const elegida = isAccountSelected(drafts.META_AD_ACCOUNT_ID, acc.id)
                                  return (
                                    <label
                                      key={acc.id}
                                      className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${
                                        elegida ? 'border-primary/60 bg-primary/5' : 'border-border hover:bg-muted/40'
                                      }`}
                                    >
                                      {/* Checkbox, no radio: se pueden elegir varias cuentas. */}
                                      <input
                                        type="checkbox"
                                        checked={elegida}
                                        onChange={() =>
                                          setDrafts({
                                            ...drafts,
                                            META_AD_ACCOUNT_ID: toggleAccountId(drafts.META_AD_ACCOUNT_ID, acc.id),
                                          })
                                        }
                                      />
                                      <span className="flex-1">{acc.name}</span>
                                      {/* Una cuenta cerrada o con deuda no devuelve datos: mejor
                                          saberlo antes de elegirla que después. */}
                                      {!acc.active ? (
                                        <span className="text-xs text-amber-400">inactiva en Meta</span>
                                      ) : null}
                                      <code className="text-muted-foreground text-xs">{acc.id}</code>
                                    </label>
                                  )
                                })}
                                <div className="flex items-center gap-3 pt-1">
                                  <button
                                    type="button"
                                    className="text-primary text-xs hover:underline"
                                    onClick={() =>
                                      setDrafts({
                                        ...drafts,
                                        META_AD_ACCOUNT_ID: serializeAccountIds(metaAccounts.map((a) => a.id)),
                                      })
                                    }
                                  >
                                    Seleccionar todas
                                  </button>
                                  <button
                                    type="button"
                                    className="text-muted-foreground text-xs hover:underline"
                                    onClick={() => setDrafts({ ...drafts, META_AD_ACCOUNT_ID: '' })}
                                  >
                                    Ninguna
                                  </button>
                                  <span className="text-muted-foreground ml-auto text-xs">
                                    {parseAccountIds(drafts.META_AD_ACCOUNT_ID).length === 0
                                      ? 'Sin marcar: se sincronizan TODAS las que vea el token'
                                      : `${parseAccountIds(drafts.META_AD_ACCOUNT_ID).length} de ${metaAccounts.length} seleccionadas`}
                                  </span>
                                </div>
                                <p className="text-muted-foreground text-xs">
                                  Puedes marcar varias. Déjalas todas sin marcar para sincronizar todas las que vea el
                                  token. Solo las cuentas seleccionadas alimentan métricas, campañas y los crons.
                                </p>
                              </div>
                            ) : null}
                          </section>
                        ) : null}

                        <div className="space-y-4">
                          {g.fields
                            .filter((f) => !f.hidden && !f.advanced)
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
                                  <div className="flex items-center justify-between gap-2">
                                    <Label htmlFor={f.key} className="text-sm">
                                      {f.label}
                                    </Label>
                                    <span className="flex items-center gap-2">
                                      {badge}
                                      {st?.source === 'db' ? (
                                        <button
                                          type="button"
                                          onClick={() => void clearField(g, f.key, f.label)}
                                          disabled={savingId === g.id}
                                          className="text-muted-foreground text-xs underline hover:text-red-400"
                                        >
                                          Borrar
                                        </button>
                                      ) : null}
                                    </span>
                                  </div>
                                  {/* Un valor que viene del entorno no se puede quitar desde aquí: lo
                                      manda la variable de Vercel, y decir "bórralo" sería mandar a un
                                      botón que no existe. */}
                                  {f.secret && st?.length ? (
                                    <p className="text-muted-foreground text-xs">
                                      Guardado: {st.length} caracteres. Si al copiarlo se cortó, aquí se ve.
                                    </p>
                                  ) : null}
                                  {st?.source === 'env' ? (
                                    <p className="text-xs text-amber-400">
                                      Este valor viene de una variable de entorno del servidor. Para quitarlo hay que
                                      borrarlo en Vercel; escribir aquí otro valor sí lo sustituye.
                                    </p>
                                  ) : null}
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

                        {/* Lo que NO hace falta para conectar va plegado. Un formulario con nueve
                            campos cuando solo dos son obligatorios hace que la gente rellene lo que
                            no debe, o abandone creyendo que le falta algo. */}
                        {g.fields.some((f) => !f.hidden && f.advanced) ? (
                          <details className="mt-4">
                            <summary className="text-muted-foreground cursor-pointer text-sm">
                              Opciones avanzadas ({g.fields.filter((f) => !f.hidden && f.advanced).length})
                            </summary>
                            <div className="mt-3 space-y-4">
                              {g.fields
                                .filter((f) => !f.hidden && f.advanced)
                                .map((f) => (
                                  <AdvancedField
                                    key={f.key}
                                    field={f}
                                    state={state[f.key]}
                                    value={drafts[f.key]}
                                    onChange={(v) => setDrafts({ ...drafts, [f.key]: v })}
                                  />
                                ))}
                              {/* El modelo de IA NO se escribe a mano: se pregunta al proveedor cuáles
                                  puede usar esta clave. Un nombre inventado o retirado deja la IA
                                  muerta y el panel en verde. */}
                              {g.id === 'ai' ? (
                                <div className="border-border/60 rounded-lg border border-dashed p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-muted-foreground text-xs">Modelos disponibles en tu cuenta</p>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={buscarModelosIa}
                                      disabled={buscandoModelos}
                                    >
                                      {buscandoModelos ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : (
                                        <Search className="mr-2 h-4 w-4" />
                                      )}
                                      Buscar modelos
                                    </Button>
                                  </div>
                                  {modelosIa?.length === 0 ? (
                                    <p className="text-muted-foreground mt-2 text-xs">
                                      Esa clave no puede listar modelos.
                                    </p>
                                  ) : null}
                                  {modelosIa && modelosIa.length > 0 ? (
                                    <select
                                      value={drafts.DEEPSEEK_MODEL ?? ''}
                                      onChange={(e) => setDrafts({ ...drafts, DEEPSEEK_MODEL: e.target.value })}
                                      className="border-border bg-background/60 text-foreground mt-2 block w-full rounded-lg border px-2 py-1 text-sm"
                                    >
                                      <option value="">Automático (el primero disponible)</option>
                                      {modelosIa.map((m) => (
                                        <option key={m.id} value={m.id}>
                                          {m.id}
                                        </option>
                                      ))}
                                    </select>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </details>
                        ) : null}

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
                                            {formatNumber(row.amount, {
                                              style: 'currency',
                                              currency: row.currency,
                                            })}
                                          </td>
                                          <td className="p-2 whitespace-nowrap">
                                            {row.internalAmount == null
                                              ? '—'
                                              : formatNumber(row.internalAmount, {
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

                        {g.id === 'stripe' && (
                          <div className="border-border mt-5 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                            <div>
                              <p className="text-sm font-medium">Sincronizar pagos (Cash Collected)</p>
                              <p className="text-muted-foreground text-xs">
                                Rellena el espejo que alimenta Cash Collected como fuente primaria: pagos liquidados de
                                Stripe con su devolución, deduplicados contra los cobros internos.
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={syncStripePayments}
                              disabled={syncingPayments || state.STRIPE_SECRET_KEY?.source === 'none'}
                            >
                              {syncingPayments ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="mr-2 h-4 w-4" />
                              )}
                              Sincronizar pagos
                            </Button>
                          </div>
                        )}

                        {g.id === 'stripe' && (
                          <div className="border-border mt-5 space-y-3 rounded-md border p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium">Registrar pagos de Stripe como ventas</p>
                                <p className="text-muted-foreground text-xs">
                                  Los pagos no se convierten en ventas solos: `sales` exige producto y plan de pago, y
                                  un pago de Stripe no dice cuáles. Elígelos aquí y se registran con su cobro.
                                </p>
                              </div>
                              <Button variant="outline" size="sm" onClick={loadBackfill} disabled={backfillLoading}>
                                {backfillLoading ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-2 h-4 w-4" />
                                )}
                                Buscar pagos sin registrar
                              </Button>
                            </div>

                            {backfill
                              ? (() => {
                                  const registrables = backfill.filter((b) => b.verdict === 'registrable')
                                  const otros = backfill.filter((b) => b.verdict !== 'registrable')
                                  return (
                                    <div className="space-y-3">
                                      {registrables.length === 0 ? (
                                        <p className="text-muted-foreground text-xs">
                                          No hay pagos registrables.{' '}
                                          {otros.length > 0
                                            ? `Hay ${otros.length} que necesitan otra cosa (sin contacto, reembolsados o no completados).`
                                            : ''}
                                        </p>
                                      ) : (catalogo?.products ?? []).length === 0 ||
                                        (catalogo?.plans ?? []).length === 0 ? (
                                        // SIN CATÁLOGO NO SE PUEDE REGISTRAR, y antes eso se veía como
                                        // dos desplegables vacíos y un botón que no se activaba nunca,
                                        // sin decir por qué. Una venta necesita producto Y plan de pago:
                                        // el plan es el que fija el precio, el nº de cuotas y qué parte
                                        // del bruto genera comisión.
                                        <div className="border-border bg-card/60 rounded-lg border p-3">
                                          <p className="text-foreground text-xs font-medium">
                                            Faltan datos de catálogo en esta subcuenta
                                          </p>
                                          <p className="text-muted-foreground mt-1 text-xs">
                                            Hay {registrables.length} pagos listos para registrar, pero una venta
                                            necesita un producto y un plan de pago, y aquí{' '}
                                            {(catalogo?.products ?? []).length === 0 &&
                                            (catalogo?.plans ?? []).length === 0
                                              ? 'no hay ninguno de los dos'
                                              : (catalogo?.products ?? []).length === 0
                                                ? 'no hay ningún producto'
                                                : 'no hay ningún plan de pago'}
                                            . El plan es el que fija el precio, el número de cuotas y qué parte del
                                            bruto genera comisión: por eso no se puede elegir por ti.
                                          </p>
                                          <a
                                            href={`/${tenant}/settings/products`}
                                            className="text-primary mt-2 inline-block text-xs hover:underline"
                                          >
                                            Crear producto y plan de pago →
                                          </a>
                                        </div>
                                      ) : (
                                        <>
                                          <div className="flex flex-wrap items-end gap-2">
                                            <label className="text-muted-foreground text-xs">
                                              Producto
                                              <select
                                                value={importChoice.productId}
                                                onChange={(e) =>
                                                  setImportChoice((p) => ({ ...p, productId: e.target.value }))
                                                }
                                                className="border-border bg-background/60 text-foreground mt-1 block rounded-lg border px-2 py-1 text-sm"
                                              >
                                                <option value="">Elige…</option>
                                                {(catalogo?.products ?? []).map((p) => (
                                                  <option key={p.id} value={p.id}>
                                                    {p.name}
                                                  </option>
                                                ))}
                                              </select>
                                            </label>
                                            <label className="text-muted-foreground text-xs">
                                              Plan de pago
                                              <select
                                                value={importChoice.planId}
                                                onChange={(e) =>
                                                  setImportChoice((p) => ({ ...p, planId: e.target.value }))
                                                }
                                                className="border-border bg-background/60 text-foreground mt-1 block rounded-lg border px-2 py-1 text-sm"
                                              >
                                                <option value="">Elige…</option>
                                                {(catalogo?.plans ?? []).map((p) => (
                                                  <option key={p.id} value={p.id}>
                                                    {p.name}
                                                    {p.method ? ` · ${p.method}` : ''}
                                                  </option>
                                                ))}
                                              </select>
                                            </label>
                                            <Button
                                              size="sm"
                                              onClick={() => void registrarVentas(registrables.map((r) => r.paymentId))}
                                              disabled={importing || !importChoice.productId || !importChoice.planId}
                                            >
                                              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                              Registrar {registrables.length} ventas
                                            </Button>
                                          </div>
                                          <div className="max-h-60 overflow-auto rounded border">
                                            <table className="w-full text-xs">
                                              <thead className="bg-card sticky top-0 text-left">
                                                <tr>
                                                  <th className="p-2">Fecha</th>
                                                  <th className="p-2">Cliente</th>
                                                  <th className="p-2 text-right">Importe</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {registrables.map((b) => (
                                                  <tr key={b.paymentId} className="border-t">
                                                    <td className="p-2 whitespace-nowrap">
                                                      {new Date(b.createdAt).toLocaleDateString('es-ES')}
                                                    </td>
                                                    <td className="p-2">{b.email || 'sin email'}</td>
                                                    <td className="p-2 text-right whitespace-nowrap">
                                                      {formatNumber(b.amount, {
                                                        style: 'currency',
                                                        currency: b.currency || 'EUR',
                                                      })}
                                                    </td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </>
                                      )}
                                      {otros.length > 0 ? (
                                        <details>
                                          <summary className="text-muted-foreground cursor-pointer text-xs">
                                            {otros.length} pagos que NO se registran, y por qué
                                          </summary>
                                          <ul className="text-muted-foreground mt-2 space-y-1 text-xs">
                                            {otros.slice(0, 30).map((b) => (
                                              <li key={b.paymentId}>
                                                {new Date(b.createdAt).toLocaleDateString('es-ES')} ·{' '}
                                                {b.email || 'sin email'} · {b.reason}
                                              </li>
                                            ))}
                                          </ul>
                                        </details>
                                      ) : null}
                                    </div>
                                  )
                                })()
                              : null}
                          </div>
                        )}

                        {g.id === 'stripe' && (
                          <div className="mt-5 space-y-3 rounded-md border border-dashed p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium">Base de clientes/alumnos</p>
                                <p className="text-xs text-muted-foreground">
                                  Completa quién ha pagado, quién paga mensualmente y quién está en mora, según Stripe.
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={syncStripeCustomersHandler}
                                disabled={syncingCustomers || state.STRIPE_SECRET_KEY?.source === 'none'}
                              >
                                {syncingCustomers ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-2 h-4 w-4" />
                                )}
                                Sincronizar clientes
                              </Button>
                            </div>
                            {stripeCustomers && stripeCustomers.length > 0 && (
                              <div className="max-h-72 overflow-auto rounded border">
                                <table className="w-full text-xs">
                                  <thead className="sticky top-0 bg-card text-left">
                                    <tr>
                                      <th className="p-2">Cliente</th>
                                      <th className="p-2">Estado</th>
                                      <th className="p-2">Vinculado</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {stripeCustomers.map((c) => (
                                      <tr key={c.stripe_customer_id} className="border-t">
                                        <td className="p-2">{c.name || c.email || c.stripe_customer_id}</td>
                                        <td className="p-2">
                                          <span className={STRIPE_CUSTOMER_STATUS_META[c.status].className}>
                                            {STRIPE_CUSTOMER_STATUS_META[c.status].label}
                                          </span>
                                        </td>
                                        <td className="p-2">
                                          {c.contact_id ? 'Sí' : 'No — sin contacto interno con ese email'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {stripeCustomers && stripeCustomers.length === 0 && (
                              <p className="text-xs text-muted-foreground">
                                Todavía no se ha sincronizado ningún cliente. Usa &quot;Sincronizar clientes&quot;.
                              </p>
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
                          </Button>{' '}
                          {g.id === 'youtube' && (
                            <div className="w-full space-y-2 border-t border-border pt-3">
                              <p className="text-xs text-muted-foreground">
                                El refresh token de YouTube no se pega a mano: se autoriza y Google lo genera. Solo el
                                redirect del playground está registrado en el cliente OAuth de esta integración, así que
                                el código vuelve ahí.
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={async () => {
                                    // Asegurar que client+secret están guardados antes de abrir Google.
                                    await saveGroup(g)
                                    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
                                    u.searchParams.set('client_id', drafts.YOUTUBE_CLIENT_ID || '')
                                    u.searchParams.set('redirect_uri', 'https://developers.google.com/oauthplayground')
                                    u.searchParams.set('response_type', 'code')
                                    u.searchParams.set(
                                      'scope',
                                      'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'
                                    )
                                    u.searchParams.set('access_type', 'offline')
                                    u.searchParams.set('prompt', 'consent')
                                    window.open(u.toString(), '_blank', 'noopener')
                                  }}
                                  disabled={
                                    savingId === g.id || !drafts.YOUTUBE_CLIENT_ID || !drafts.YOUTUBE_CLIENT_SECRET // sin client+secret Google no puede emparejar el token
                                  }
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" /> Autorizar con Google
                                </Button>
                                <Input
                                  className="min-w-0 flex-1"
                                  placeholder="Código que devuelve Google (o su URL completa)"
                                  value={drafts.YOUTUBE_OAUTH_CODE || ''}
                                  onChange={(e) => setDrafts((p) => ({ ...p, YOUTUBE_OAUTH_CODE: e.target.value }))}
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={async () => {
                                    const r = await fetch(`/api/${tenant}/evergreen/settings/integraciones`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        action: 'youtube-exchange',
                                        code: drafts.YOUTUBE_OAUTH_CODE || '',
                                      }),
                                    })
                                    const j = await r.json()
                                    if (!r.ok) {
                                      toast.error(j.error || 'No se pudo completar la autorización')
                                      return
                                    }
                                    toast.success('YouTube conectado: refresh token guardado')
                                    setDrafts((p) => {
                                      const n = { ...p }
                                      delete n.YOUTUBE_OAUTH_CODE
                                      return n
                                    })
                                    void load()
                                  }}
                                  disabled={!drafts.YOUTUBE_OAUTH_CODE || savingId === g.id}
                                >
                                  <KeyRound className="mr-2 h-4 w-4" /> Completar conexión
                                </Button>
                              </div>
                            </div>
                          )}
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
