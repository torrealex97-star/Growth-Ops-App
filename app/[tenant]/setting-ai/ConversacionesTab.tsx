'use client'
import { useTenant } from '@/lib/tenant-context'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Sparkles, Loader2, MessageCircle, ExternalLink, Phone, Mail, SearchX, ChevronDown, CalendarCheck, DollarSign } from 'lucide-react'
import { formatNumber, formatPercent } from '@/lib/utils'
import { SearchBox } from '@/components/ui/search-box'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { canalesDisponibles, filtrarConversaciones } from '@/lib/setting-ai/filtrar-conversaciones'
import {
  alimentarVerificadas,
  claveDia,
  etiquetaDia,
  horaDe,
  inicialesDe,
  marcaVerificada,
  tiempoRelativo,
  ultimoMensaje,
  vistaPrevia,
  type MsgMin,
  type VerificacionContacto,
} from '@/lib/setting-ai/inbox'

type ConvMsg = MsgMin & { created_time?: string }
type IgConversation = {
  id: string
  participant?: string
  updated_time?: string
  unread_count: number
  message_count: number
  messages: ConvMsg[]
}

// GHL devuelve la misma forma base (id, unread_count, message_count, messages) más el canal y
// la vinculación con el perfil del CRM (resuelta en servidor por ghl_contact_id → email →
// teléfono); la UI es la misma lista con un badge de canal y un enlace al contacto.
type GhConversation = IgConversation & {
  channel?: string
  contactId?: string
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  contact_photo_url?: string | null
  contactoVinculado?: { id: string; full_name: string } | null
  vinculacion?: string | null
}
type Conv = IgConversation & Partial<GhConversation>
type Analysis = {
  avatar_detectado?: string
  fase_alcanzada?: string
  resumen?: string
  fortalezas?: string[]
  fallos?: { cita: string; problema: string }[]
  recomendaciones?: string[]
}
type ResumenMetricas = {
  totalConversaciones: number
  conContactoVinculado: number
  conAgendaVerificada: number
  conVentaVerificada: number
  sinContactoVinculado: number
  sinContactoConEnlaceAgenda: number
  tasaVinculacion: number
  tasaAgendaSobreVinculados: number
}

const PLATFORMS = [
  { k: 'instagram' as const, label: 'Instagram' },
  { k: 'ghl' as const, label: 'GHL' },
  { k: 'facebook' as const, label: 'Facebook' },
  { k: 'tiktok' as const, label: 'TikTok' },
]
type Platform = (typeof PLATFORMS)[number]['k']
type RespuestaConvos = {
  error?: string
  configured?: boolean
  conversations?: Conv[]
  motivo?: string
  // GHL paginado: total declarado por la API y si queda página siguiente ("Cargar más").
  total?: number | null
  hayMas?: boolean
}

type RespuestaMetricas = {
  error?: string
  configured?: boolean
  resumen?: ResumenMetricas
  motivo?: string
  // Por conversación: alimenta las marcas de cita/venta verificada del inbox (misma fuente
  // que las tarjetas). tieneAgenda/tieneVenta null = sin contacto vinculado, no verificable.
  porConversacion?: { conversationId: string; tieneAgenda?: boolean | null; tieneVenta?: boolean | null }[]
}

// Presentación del canal: icono y etiqueta legible. Lo que GHL no clasifique queda como
// "Chat" (misma política honesta del mapeador: nada inventado).
const CANAL_UI: Record<string, { label: string; icono: 'sms' | 'call' | 'email' | 'chat' }> = {
  sms: { label: 'SMS', icono: 'sms' },
  call: { label: 'Llamada', icono: 'call' },
  email: { label: 'Email', icono: 'email' },
  instagram: { label: 'Instagram', icono: 'chat' },
  facebook: { label: 'Facebook', icono: 'chat' },
  whatsapp: { label: 'WhatsApp', icono: 'chat' },
  chat: { label: 'Chat', icono: 'chat' },
}
const canalUi = (canal: string | undefined) =>
  CANAL_UI[canal ?? ''] ?? { label: labelCase(canal), icono: 'chat' as const }
function labelCase(canal: string | undefined): string {
  if (!canal) return 'Chat'
  return canal.charAt(0).toUpperCase() + canal.slice(1)
}
function IconoCanal({ tipo, className }: { tipo: 'sms' | 'call' | 'email' | 'chat'; className?: string }) {
  if (tipo === 'sms' || tipo === 'call') return <Phone className={className} />
  if (tipo === 'email') return <Mail className={className} />
  return <MessageCircle className={className} />
}

export default function ConversacionesTab() {
  const tenant = useTenant()
  const [platform, setPlatform] = useState<Platform>('instagram')
  const [loading, setLoading] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [conversations, setConversations] = useState<Conv[]>([])
  const [error, setError] = useState('')
  const [motivo, setMotivo] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState<string | null>(null)
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({})
  const [analyzeError, setAnalyzeError] = useState<Record<string, string>>({})
  const [metricas, setMetricas] = useState<
    Partial<Record<'instagram' | 'ghl', { resumen?: ResumenMetricas; motivo?: string }>>
  >({})
  const [busqueda, setBusqueda] = useState('')
  const [canal, setCanal] = useState('todos')
  // Conversaciones con hecho verificado en el CRM (cita/venta del contacto vinculado). La fuente
  // es la que ya calcula /conversations/metrics para las tarjetas: no se inventa nada en cliente
  // (un hecho es un hecho; sin contacto vinculado → sin marca).
  const [verificadas, setVerificadas] = useState<Record<string, VerificacionContacto>>({})
  // "Cargar más" (GHL): si el servidor declara página siguiente, cuántas quedan del total,
  // estado de la petición en curso y su error (reintentable; no tumba la bandeja).
  const [hayMas, setHayMas] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [errorMas, setErrorMas] = useState('')
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Cambiar de plataforma limpia también el filtro: la lista nueva no comparte canales.
    setBusqueda('')
    setCanal('todos')
    setOpenId(null)
    setVerificadas({})
    setHayMas(false)
    setTotal(null)
    setCargandoMas(false)
    setErrorMas('')
    if (platform !== 'instagram' && platform !== 'ghl') {
      setConfigured(false)
      setConversations([])
      setError('')
      return
    }
    let cancel = false
    setLoading(true)
    setError('')
    // La carga anterior se moría por tiempo (lambda + Graph API en serie): aquí acotamos el
    // esperar en cliente también, para que el usuario vea un mensaje y no una rueda eterna.
    const controlador = new AbortController()
    const reloj = setTimeout(() => controlador.abort(), 35_000)
    fetch(`/api/${tenant}/evergreen/setting-ai/conversations?platform=${platform}`, {
      signal: controlador.signal,
    })
      .then(async (r) =>
        r.ok ? ((await r.json()) as RespuestaConvos) : { error: `El servidor respondió ${r.status}` }
      )
      .then((j) => {
        if (cancel) return
        if (j.error) {
          setError(j.error)
          setConfigured(false)
          return
        }
        setConfigured(!!j.configured)
        setConversations(j.conversations || [])
        setMotivo(j.motivo || '')
        setHayMas(!!j.hayMas)
        setTotal(j.total ?? null)
      })
      .catch((e) => {
        if (!cancel) {
          setError(e.name === 'AbortError' ? 'La carga tardó demasiado. Inténtalo de nuevo.' : e.message)
          setConfigured(false)
        }
      })
      .finally(() => {
        clearTimeout(reloj)
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [platform, tenant])

  // Al abrir una conversación, el chat se lee desde el final (última réplica): así se lee
  // cualquier bandeja; además deja visible la burbuja más reciente sin scroll manual.
  useEffect(() => {
    if (openId && chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [openId])

  // Resumen cross-plataforma (Instagram y GHL: las dos con datos reales hoy). Independiente del
  // tab activo — se ve aunque estés en el placeholder de Facebook/TikTok: comparar de un vistazo
  // qué canal trae más leads/agendas verificadas es el punto.
  useEffect(() => {
    let cancel = false
    for (const p of ['instagram', 'ghl'] as const) {
      fetch(`/api/${tenant}/evergreen/setting-ai/conversations/metrics?platform=${p}`)
        .then((r) => r.json())
        .then((j: RespuestaMetricas) => {
          if (cancel) return
          setMetricas((m) => ({
            ...m,
            [p]:
              j.configured && j.resumen
                ? { resumen: j.resumen as ResumenMetricas }
                : { motivo: j.motivo || j.error || '' },
          }))
          // Las marcas del inbox se alimentan de la MISMA respuesta (porConversacion) que
          // alimentan las tarjetas: sin llamadas nuevas y sin una segunda definición de
          // "verificado". Lo nuevo de cada plataforma gana; la otra plataforma no se toca.
          setVerificadas((v) => alimentarVerificadas(v, p, j.porConversacion ?? []))
        })
        .catch(() => {
          if (!cancel) setMetricas((m) => ({ ...m, [p]: { motivo: 'No se pudieron calcular las métricas.' } }))
        })
    }
    return () => {
      cancel = true
    }
    // Recalcula cuando la lista de conversaciones se refresca (el snapshot que leen estos
    // endpoints puede haber cambiado tras la descarga).
  }, [tenant, conversations.length])

  async function analyze(c: IgConversation) {
    setAnalyzing(c.id)
    setAnalyzeError((e) => ({ ...e, [c.id]: '' }))
    try {
      const conversation = c.messages.map((m) => ({ who: m.from === 'agente' ? 'agent' : 'lead', text: m.text || '' }))
      const r = await fetch(`/api/${tenant}/evergreen/setting-ai/analyze-conversation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversation, model: 'sonnet' }),
      }).then((res) => res.json())
      if (r.error) throw new Error(r.error)
      setAnalyses((a) => ({ ...a, [c.id]: r }))
    } catch (e) {
      setAnalyzeError((er) => ({ ...er, [c.id]: (e as Error).message }))
    } finally {
      setAnalyzing(null)
    }
  }

  // "Cargar más" (solo GHL): pide la siguiente tanda al POST y muestra lo que el servidor
  // devuelve YA FUSIONADO con lo anterior (el snapshot del servidor es acumulativo). No toca
  // filtros ni la conversación abierta: sigue leyendo donde estaba. El cursor vive en servidor,
  // así que un reintento tras un corte continúa y no duplica filas.
  async function cargarMas() {
    if (cargandoMas) return
    setCargandoMas(true)
    setErrorMas('')
    try {
      const r = await fetch(`/api/${tenant}/evergreen/setting-ai/conversations?platform=ghl`, {
        method: 'POST',
      })
      const j = (await r.json()) as RespuestaConvos
      if (j.error) throw new Error(j.error)
      if (j.configured === false) throw new Error(j.motivo || 'GHL no está configurado.')
      setConversations(j.conversations || [])
      setMotivo(j.motivo || '')
      setHayMas(!!j.hayMas)
      setTotal(j.total ?? null)
    } catch (e) {
      setErrorMas((e as Error).message)
    } finally {
      setCargandoMas(false)
    }
  }

  const canales = canalesDisponibles(conversations)
  const visibles = filtrarConversaciones(conversations, busqueda, canal)
  const seleccionada = visibles.find((c) => c.id === openId) ?? null

  return (
    <div className="flex flex-col h-[calc(100vh-6.5rem)] text-foreground">
      <div className="flex items-center gap-3 flex-wrap pb-3 border-b border-border">
        <div>
          <h1 className="text-base font-bold text-foreground leading-tight">Conversaciones</h1>
          <p className="text-2xs text-muted-foreground leading-tight">
            Toda la comunicación con cada lead, del primer contacto a la venta: redes sociales y bandeja de GHL.
          </p>
          {motivo && configured && <p className="text-2xs text-amber-500/90 leading-tight mt-0.5">{motivo}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap pb-3">
          <SearchBox
            value={busqueda}
            onChange={setBusqueda}
            placeholder="Buscar por nombre, email o teléfono…"
            className="w-64"
          />
          {canales.length > 1 && (
            <Select value={canal} onValueChange={setCanal}>
              <SelectTrigger className="w-40 bg-card border-border" aria-label="Filtrar por canal">
                <SelectValue placeholder="Canal" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="todos">Todos los canales</SelectItem>
                {canales.map((ch) => (
                  <SelectItem key={ch} value={ch}>
                    {canalUi(ch).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!loading && !error && configured !== false && conversations.length > 0 && (
            <span className="text-2xs text-muted-foreground">
              {visibles.length} de {total != null && platform === 'ghl' ? total : conversations.length} conversaciones
            </span>
          )}
        </div>
        <div className="flex-1" />
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {PLATFORMS.map((p) => (
            <button
              key={p.k}
              onClick={() => setPlatform(p.k)}
              aria-pressed={platform === p.k}
              className={`px-3 py-1.5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 ${
                platform === p.k ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <ResumenCrossPlataforma metricas={metricas} />

      {platform !== 'instagram' && platform !== 'ghl' ? (
        <div className="flex-1 flex items-center justify-center py-4">
          <PlaceholderPlatform platform={platform} />
        </div>
      ) : loading ? (
        <ListaSkeleton />
      ) : error ? (
        <p className="text-red-400 text-sm text-center py-10">Error: {error}</p>
      ) : configured === false ? (
        <EstadoSinConfig platform={platform} motivo={motivo} tenant={tenant} />
      ) : conversations.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-10">No hay conversaciones recientes.</p>
      ) : visibles.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-10 flex items-center justify-center gap-2">
          <SearchX className="w-4 h-4" /> Ninguna conversación coincide con la búsqueda.
        </p>
      ) : (
        // Bandeja de dos paneles: lista escaneable a la izquierda, transcripción completa a la
        // derecha. El patrón inbox (lista + lectura) es el que ya conocen de cualquier CRM de chat:
        // se escanea quién habló último y cuándo sin abrir nada, y la conversación abierta se lee
        // entera sin plegar el resto.
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(280px,380px)_1fr] gap-3 py-3">
          <ul aria-label="Conversaciones" className="flex flex-col gap-1.5 overflow-y-auto pr-1">
            {visibles.map((c) => (
              <li key={c.id}>
                <FilaConversacion
                  c={c}
                  activa={openId === c.id}
                  onClick={() => setOpenId(openId === c.id ? null : c.id)}
                  verificacion={verificadas[`${platform}:${c.id}`]}
                />
              </li>
            ))}
            {platform === 'ghl' && hayMas && (
              <li>
                <button
                  onClick={cargarMas}
                  disabled={cargandoMas}
                  aria-busy={cargandoMas}
                  className="w-full rounded-xl border border-dashed border-border px-3 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 flex items-center justify-center gap-2"
                >
                  {cargandoMas ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" />
                      Cargar más
                      {total != null && conversations.length < total ? ` (${conversations.length} de ${total})` : ''}
                    </>
                  )}
                </button>
              </li>
            )}
            {errorMas && (
              <li className="text-2xs text-red-400/90 text-center px-2">
                {errorMas}{' '}
                <button
                  onClick={cargarMas}
                  className="underline hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
                >
                  Reintentar
                </button>
              </li>
            )}
          </ul>
          <div className="hidden lg:block min-h-0">
            {seleccionada ? (
              <PanelChat
                key={seleccionada.id}
                c={seleccionada}
                platform={platform}
                tenant={tenant}
                chatRef={chatRef}
                analyzing={analyzing === seleccionada.id}
                onAnalyze={() => analyze(seleccionada)}
                analyzeError={analyzeError[seleccionada.id]}
                analysis={analyses[seleccionada.id]}
              />
            ) : (
              <div className="h-full rounded-xl border border-dashed border-border flex flex-col items-center justify-center text-center text-muted-foreground text-sm gap-1.5 p-6">
                <MessageCircle className="w-6 h-6 opacity-60" />
                <p className="font-medium text-foreground">Elige una conversación</p>
                <p className="text-2xs max-w-xs">
                  Se abre aquí la transcripción completa del chat, con quién respondió qué y cuándo.
                </p>
              </div>
            )}
          </div>
          {/* En móvil/tablet la transcripción va debajo de la lista (sin segunda columna). */}
          <div className="lg:hidden">
            {seleccionada && (
              <PanelChat
                c={seleccionada}
                platform={platform}
                tenant={tenant}
                chatRef={chatRef}
                analyzing={analyzing === seleccionada.id}
                onAnalyze={() => analyze(seleccionada)}
                analyzeError={analyzeError[seleccionada.id]}
                analysis={analyses[seleccionada.id]}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function nombreDe(c: Conv): string {
  return c.contactoVinculado?.full_name || c.contact_name || c.participant || 'Lead sin nombre'
}

// Avatar del inbox: foto real del contacto (profilePhoto de GHL) cuando llega, con fallback
// determinista a iniciales y — sin nombre — al icono del canal. onError oculta la foto (las URLs
// de GHL pueden caducar) y deja el fallback; nunca un hueco roto ni un layout que salte.
function Avatar({
  nombre,
  fotoUrl,
  icono,
  resaltado,
  sm,
}: {
  nombre: string
  fotoUrl?: string | null
  icono: 'sms' | 'call' | 'email' | 'chat'
  resaltado?: boolean
  sm?: boolean
}) {
  const [fotoRota, setFotoRota] = useState(false)
  const tam = sm ? 'w-8 h-8' : 'w-9 h-9'
  const iniciales = inicialesDe(nombre)
  return (
    <span
      className={`${tam} shrink-0 rounded-full grid place-items-center text-2xs font-bold overflow-hidden ${
        resaltado ? 'bg-brand-600 text-white' : 'bg-muted text-muted-foreground'
      }`}
      aria-hidden
    >
      {fotoUrl && !fotoRota ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fotoUrl}
          alt=""
          className="w-full h-full rounded-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFotoRota(true)}
        />
      ) : iniciales ? (
        iniciales
      ) : (
        <IconoCanal tipo={icono} className={sm ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      )}
    </span>
  )
}

function FilaConversacion({
  c,
  activa,
  onClick,
  verificacion,
}: {
  c: Conv
  activa: boolean
  onClick: () => void
  // Hecho verificado en el CRM (cita/venta del contacto vinculado); null = sin hecho que mostrar.
  verificacion?: VerificacionContacto | null
}) {
  const nombre = nombreDe(c)
  const canal = canalUi(c.channel)
  const ult = ultimoMensaje(c.messages)
  const sinLeer = c.unread_count > 0
  const marcas = marcaVerificada(verificacion)
  return (
    <button
      onClick={onClick}
      aria-pressed={activa}
      className={`w-full text-left rounded-xl border p-2.5 flex items-start gap-2.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 ${
        activa ? 'border-brand-600/60 bg-brand-600/[0.06]' : 'border-border hover:bg-muted/50'
      } ${sinLeer && !activa ? 'bg-brand-600/[0.04]' : ''}`}
    >
      <Avatar nombre={nombre} fotoUrl={c.contact_photo_url} icono={canal.icono} resaltado={sinLeer} />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className={`text-sm truncate ${sinLeer ? 'font-bold text-foreground' : 'font-medium text-foreground'}`}>
            {nombre}
          </span>
          {sinLeer && <span className="w-2 h-2 shrink-0 rounded-full bg-brand-500" aria-label="Sin leer" />}
          <span className="text-3xs text-muted-foreground ml-auto shrink-0">
            {tiempoRelativo(c.updated_time) ?? ''}
          </span>
        </span>
        <span className="block text-2xs text-muted-foreground truncate mt-0.5">{vistaPrevia(ult)}</span>
        <span className="flex items-center gap-1.5 mt-1">
          <span className="inline-flex items-center gap-1 text-3xs text-muted-foreground border border-border rounded px-1 py-0.5">
            <IconoCanal tipo={canal.icono} className="w-2.5 h-2.5" />
            {canal.label}
          </span>
          {marcas && (
            <>
              {marcas.agenda && (
                <span
                  className="inline-flex items-center gap-0.5 text-3xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1 py-0.5"
                  title="Este contacto tiene una cita en el CRM"
                >
                  <CalendarCheck className="w-2.5 h-2.5" /> Cita
                </span>
              )}
              {marcas.venta && (
                <span
                  className="inline-flex items-center gap-0.5 text-3xs font-semibold text-brand-400 bg-brand-500/10 border border-brand-500/30 rounded px-1 py-0.5"
                  title="Este contacto tiene una venta en el CRM"
                >
                  <DollarSign className="w-2.5 h-2.5" /> Venta
                </span>
              )}
            </>
          )}
          {c.messages.length > 0 && <span className="text-3xs text-muted-foreground">{c.messages.length} msgs</span>}
        </span>
      </span>
    </button>
  )
}

function PanelChat({
  c,
  platform,
  tenant,
  chatRef,
  analyzing,
  onAnalyze,
  analyzeError,
  analysis,
}: {
  c: Conv
  platform: Platform
  tenant: string
  chatRef: RefObject<HTMLDivElement>
  analyzing: boolean
  onAnalyze: () => void
  analyzeError?: string
  analysis?: Analysis
}) {
  const nombre = nombreDe(c)
  const canal = canalUi(c.channel)
  const msgs = c.messages
  return (
    <div className="h-full flex flex-col rounded-xl border border-border bg-background overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border bg-muted/30">
        <Avatar nombre={nombre} fotoUrl={c.contact_photo_url} icono={canal.icono} sm />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate leading-tight">{nombre}</p>
          <p className="text-3xs text-muted-foreground leading-tight">
            {c.contact_email || c.contact_phone || canal.label}
            {c.messages.length > 0 && ` · ${c.messages.length} mensajes`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {platform === 'ghl' &&
            (c.contactoVinculado ? (
              <a
                href={`/${tenant}/crm/contactos/${c.contactoVinculado.id}`}
                className="inline-flex items-center gap-1 text-2xs text-brand-400 hover:opacity-80"
                title={`Perfil vinculado (${c.vinculacion === 'ghl_contact_id' ? 'ID de GHL' : c.vinculacion === 'email' ? 'email' : 'teléfono'})`}
              >
                <ExternalLink className="w-3 h-3" /> Ver perfil
              </a>
            ) : (
              <span
                className="text-3xs text-muted-foreground flex items-center gap-1"
                title="Sin match por ID de GHL, email ni teléfono"
              >
                <MessageCircle className="w-3 h-3" /> Sin perfil en CRM
              </span>
            ))}
          <button
            onClick={onAnalyze}
            disabled={analyzing || msgs.length === 0}
            className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg px-2.5 py-1.5 text-2xs font-semibold inline-flex items-center gap-1.5 active:scale-[0.98] transition-transform"
          >
            {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Analizar con IA
          </button>
        </div>
      </div>
      {msgs.length === 0 ? (
        <p className="text-muted-foreground text-xs p-4">No se pudo extraer la transcripción de esta conversación.</p>
      ) : (
        <div ref={chatRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {bloquesPorDia(msgs).map((b) => (
            <div key={b.clave || b.etiqueta || 'sin-fecha'} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 py-0.5">
                <span className="h-px flex-1 bg-border" />
                <span className="text-3xs text-muted-foreground font-medium">{b.etiqueta}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              {b.mensajes.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-xs whitespace-pre-wrap ${
                    m.from === 'agente'
                      ? 'self-end bg-brand-600 text-white rounded-br-sm'
                      : 'self-start bg-muted text-foreground rounded-bl-sm'
                  }`}
                >
                  {m.text}
                  {m.created_time && (
                    <span
                      className={`block text-right text-3xs mt-0.5 ${m.from === 'agente' ? 'text-white/70' : 'text-muted-foreground'}`}
                    >
                      {horaDe(m.created_time)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {(analyzeError || analysis) && (
        <div className="border-t border-border p-3">
          {analyzeError && <p className="text-red-400 text-xs">{analyzeError}</p>}
          {analysis && <AnalysisCard a={analysis} />}
        </div>
      )}
    </div>
  )
}

// Agrupa los mensajes por día para los separadores (Hoy / Ayer / fecha). Fuera del JSX para
// que el render sea legible; los helpers puros viven en lib/setting-ai/inbox.ts (testeables).
function bloquesPorDia(msgs: ConvMsg[]) {
  const bloques: { clave: string; etiqueta: string | null; mensajes: ConvMsg[] }[] = []
  for (const m of msgs) {
    const clave = claveDia(m.created_time)
    const ult = bloques[bloques.length - 1]
    if (ult && ult.clave === clave) ult.mensajes.push(m)
    else bloques.push({ clave, etiqueta: etiquetaDia(m.created_time), mensajes: [m] })
  }
  return bloques
}

// Skeleton con la MISMA forma que la bandeja final (skill: nunca un spinner genérico donde
// va una lista): filas avatar + dos líneas, 8 unidades como el límite habitual del listado.
function ListaSkeleton() {
  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(280px,380px)_1fr] gap-3 py-3" aria-hidden>
      <div className="flex flex-col gap-1.5 overflow-hidden">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="rounded-xl border border-border p-2.5 flex items-start gap-2.5 animate-pulse">
            <span className="w-9 h-9 rounded-full bg-muted shrink-0" />
            <span className="flex-1 flex flex-col gap-1.5 pt-0.5">
              <span className="h-3 w-1/3 rounded bg-muted" />
              <span className="h-2.5 w-3/4 rounded bg-muted" />
            </span>
          </div>
        ))}
      </div>
      <div className="hidden lg:flex rounded-xl border border-border items-center justify-center">
        <p className="text-2xs text-muted-foreground">Cargando conversaciones…</p>
      </div>
    </div>
  )
}

function EstadoSinConfig({ platform, motivo, tenant }: { platform: Platform; motivo: string; tenant: string }) {
  const esGhl = platform === 'ghl'
  return (
    <div className="flex-1 flex items-center justify-center py-4">
      <div className="text-center text-muted-foreground text-sm max-w-md">
        <MessageCircle className="w-8 h-8 mx-auto mb-3 opacity-50" />
        <p className="mb-1 font-semibold text-foreground">
          {esGhl ? 'GoHighLevel no está operativo para mensajería.' : 'Instagram no está operativo para mensajería.'}
        </p>
        {motivo && <p className="mb-3 text-foreground">{motivo}</p>}
        <p className="mb-3">
          {esGhl ? (
            <>
              Configura el <b>PIT token</b> y el <b>Location ID</b> para ver aquí la bandeja unificada de GHL (SMS,
              Facebook, Instagram, WhatsApp y email).
            </>
          ) : (
            <>
              Configura el token (necesita el permiso{' '}
              <code className="text-2xs bg-muted px-1 py-0.5 rounded">instagram_manage_messages</code>) para ver y
              analizar aquí las conversaciones reales.
            </>
          )}
        </p>
        <a
          href={`/${tenant}/settings/integraciones`}
          className="inline-flex items-center rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3 py-2 active:scale-[0.98] transition-transform"
        >
          Ir a Configuración → Integraciones
        </a>
      </div>
    </div>
  )
}

// Comparativa cross-plataforma: qué canal de mensajería genera más leads/agendas reales. Solo
// Instagram y GHL tienen datos hoy — Facebook y TikTok se pintan como "próximamente" en la MISMA
// fila para que la comparación esté lista en cuanto se conecten.
function ResumenCrossPlataforma({
  metricas,
}: {
  metricas: Partial<Record<'instagram' | 'ghl', { resumen?: ResumenMetricas; motivo?: string }>>
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 py-3 border-b border-border">
      <TarjetaPlataforma label="Instagram" data={metricas.instagram} />
      <TarjetaPlataforma label="GHL" data={metricas.ghl} hint="SMS · Facebook · Instagram · WhatsApp · email" />
    </div>
  )
}

function TarjetaPlataforma({
  label,
  data,
  proximamente,
  hint,
}: {
  label: string
  data?: { resumen?: ResumenMetricas; motivo?: string }
  proximamente?: boolean
  hint?: string
}) {
  const metrics = data?.resumen
  const motivo = data?.motivo
  return (
    <div className="border border-border rounded-xl p-3 bg-muted/30">
      <p className="text-2xs font-semibold text-foreground mb-1.5">
        {label}
        {hint && <span className="ml-1.5 font-normal text-3xs text-muted-foreground">{hint}</span>}
      </p>
      {proximamente ? (
        <p className="text-3xs text-muted-foreground">Próximamente — sin integración de mensajería todavía.</p>
      ) : metrics ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-foreground">{formatNumber(metrics.totalConversaciones)}</span>
            <span className="text-3xs text-muted-foreground">conversaciones</span>
          </div>
          <p className="text-3xs text-muted-foreground">
            <b className="text-foreground">{formatNumber(metrics.conAgendaVerificada)}</b> con agenda verificada en CRM
            ({formatPercent(metrics.tasaAgendaSobreVinculados * 100, 0)} de los vinculados) ·{' '}
            <b className="text-foreground">{formatNumber(metrics.conVentaVerificada)}</b> con venta
          </p>
          <p className="text-3xs text-muted-foreground">
            {formatNumber(metrics.conContactoVinculado)} de {formatNumber(metrics.totalConversaciones)} vinculadas a un
            contacto real ({formatPercent(metrics.tasaVinculacion * 100, 0)}) ·{' '}
            {formatNumber(metrics.sinContactoVinculado)} sin vincular{' '}
            {metrics.sinContactoConEnlaceAgenda > 0 && (
              <span title="Se envió un enlace de agenda en el texto, pero no hay contacto vinculado para confirmar que se completó">
                ({formatNumber(metrics.sinContactoConEnlaceAgenda)} con enlace de agenda enviado, sin confirmar)
              </span>
            )}
          </p>
        </div>
      ) : (
        <p className="text-3xs text-muted-foreground">{motivo || 'Cargando…'}</p>
      )}
    </div>
  )
}

function PlaceholderPlatform({ platform }: { platform: 'facebook' | 'tiktok' }) {
  const label = platform === 'facebook' ? 'Facebook' : 'TikTok'
  return (
    <div className="text-center text-muted-foreground text-sm max-w-md">
      <MessageCircle className="w-8 h-8 mx-auto mb-3 opacity-50" />
      <p className="mb-2 font-semibold text-foreground">{label}: próximamente.</p>
      <p>
        Todavía no está conectada la extracción de conversaciones de {label}. En cuanto se active la integración,
        aparecerán aquí con el mismo análisis IA que Instagram.
      </p>
    </div>
  )
}

function AnalysisCard({ a }: { a: Analysis }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-muted/40 text-xs flex flex-col gap-2">
      <div className="flex gap-3 flex-wrap">
        {a.avatar_detectado && (
          <span>
            <b className="text-foreground">Avatar:</b> {a.avatar_detectado}
          </span>
        )}
        {a.fase_alcanzada && (
          <span>
            <b className="text-foreground">Fase:</b> {a.fase_alcanzada}
          </span>
        )}
      </div>
      {a.resumen && <p className="text-muted-foreground">{a.resumen}</p>}
      {!!a.fortalezas?.length && (
        <div>
          <b className="text-emerald-400">Fortalezas</b>
          <ul className="list-disc pl-4 mt-0.5">
            {a.fortalezas.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {!!a.fallos?.length && (
        <div>
          <b className="text-amber-400">Fallos</b>
          <ul className="list-disc pl-4 mt-0.5">
            {a.fallos.map((f, i) => (
              <li key={i}>
                <i>&ldquo;{f.cita}&rdquo;</i> — {f.problema}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!a.recomendaciones?.length && (
        <div>
          <b className="text-brand-400">Recomendaciones</b>
          <ul className="list-disc pl-4 mt-0.5">
            {a.recomendaciones.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
