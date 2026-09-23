'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { mensajeDeCarga, primerError } from '@/lib/supabase/resultado'
import { ConnectedFunnel } from '@/components/os/ConnectedFunnel'
import { FunnelDinamico, FUNNEL_LABELS, FUNNEL_ORDEN, type OpcionFunnel } from '@/components/os/FunnelDinamico'
import { TrendChart } from '@/components/os/TrendChart'
import { cn } from '@/lib/utils'
import { DonutChart, type Segmento } from '@/components/os/DonutChart'
import { KPICard, TargetRow } from '@/components/os/DashboardKPICard'
import { evaluaTarget, eligeTarget, valorTarget, METRICAS_CON_OBJETIVO } from '@/lib/targets/vs-actual'
import { PieChart, Target, Users, TrendingUp, Wallet, Filter, MousePointerClick, Megaphone } from 'lucide-react'
import { ACTIVE_SALE_STATUSES } from '@/lib/analytics'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils'
import { FINANCE_QUERY_ROW_CAP } from '@/lib/finance/pnl'
import {
  buildChannelRows,
  buildSalesOverview,
  type AttributionFilter,
  type FathomSinCita,
  type CampaignRow,
  type SaleRow,
  type ContactRow,
} from '@/lib/unit-economics'
import { useTenant } from '@/lib/tenant-context'
import { useCuentasMetaActivas } from '@/lib/meta/use-cuentas-activas'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { DEFAULT_PERIOD, getPeriodRange, inPeriod, type PeriodPreset, type PeriodRange } from '@/lib/filters/period'
import { isCancelled } from '@/lib/unit-economics'
import { leadDate } from '@/lib/analytics'
import type { FunnelOperativo, FiltroAtribucion } from '@/lib/metrics/operativo'
import { canonicalizeLeads, canonicalizeAppointments } from '@/lib/canonical/dedup'
import { canonicalCash, type StripePaymentRow } from '@/lib/canonical/cash'
import { resolverOferta, CONFIG_OFERTA_POR_DEFECTO } from '@/lib/metrics/oferta'
import { FunnelCanonicoPanel } from '@/components/os/DataQualityPanel'
import { PanelOrganico } from '@/components/os/PanelOrganico'

// Objetivo de dashboard (§27): fila mínima de `targets` para comparar contra lo del periodo.
type TargetRowEstado = {
  id: string
  metric_key: string
  scope_type: string
  is_active: boolean | null
  period_type: string | null
  period_start: string
  period_end: string
  target_value: number | string
}

type CollectionRow = {
  id?: string
  /** `payment_reference` = id de Stripe cuando el cobro vino de ahí: la clave del dedup (§2). */
  payment_reference?: string | null
  gross_amount: number | string | null
  collected_at: string | null
  status: string
}
type AppointmentRow = {
  id: string
  contact_id: string | null
  status: string
  appointment_datetime: string | null
  pipe_value: number | string | null
  offered?: boolean | null
  result?: string | null
}

const num = (x: number | string | null | undefined) => Number(x ?? 0)

const CHANNEL_LABELS: Record<string, string> = {
  meta: 'Meta Ads',
  facebook: 'Facebook Ads',
  instagram: 'Instagram Ads',
  google: 'Google Ads',
  youtube: 'YouTube Ads',
  tiktok: 'TikTok Ads',
  organico: 'Orgánico',
  organic: 'Orgánico',
  referido: 'Referidos',
  referral: 'Referidos',
  email: 'Email Marketing',
  afiliados: 'Colaboradores',
  affiliate: 'Colaboradores',
  otro: 'Otro',
  other: 'Otro',
}
const labelChannel = (ch: string) => CHANNEL_LABELS[ch?.toLowerCase()] || ch || 'Sin canal'

// Guard div/0 → null (se pinta como "—")
const safeDiv = (a: number, b: number): number | null => (b ? a / b : null)

// PeriodRange guarda Date|null; la API de funnels quiere YYYY-MM-DD o nada.
function rangoISO(d: Date | null): string | null {
  if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// FILTROS DE ATRIBUCIÓN — jerarquía limpia: lo principal visible (origen, atribución), lo
// avanzado (canal, cuenta, campaña) bajo un <details>. Los filtros acotan lo que ya está en
// pantalla; el funnel 'todos' sigue mostrando los totales del negocio porque su definición ES
// "sin exigir atribución". Escojer "solo atribuidos" aquí acota las tarjetas y tablas de anuncios.
function FiltrosAtribucion({
  origen,
  onOrigenChange,
  atribucion,
  onAtribucionChange,
  avanzadosAbiertos,
  onToggleAvanzados,
  funnelOpcion,
  onFunnelChange,
}: {
  origen: AttributionFilter
  onOrigenChange: (v: AttributionFilter) => void
  atribucion: FiltroAtribucion
  onAtribucionChange: (v: FiltroAtribucion) => void
  avanzadosAbiertos: boolean
  onToggleAvanzados: () => void
  funnelOpcion: OpcionFunnel
  onFunnelChange: (v: OpcionFunnel) => void
}) {
  return (
    <div className="dashboard-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
          <Filter className="h-3.5 w-3.5" /> Origen
        </span>
        <div className="flex gap-1" role="group" aria-label="Origen de los leads">
          {(
            [
              ['todos', 'Todos'],
              ['ads', 'Solo anuncios'],
              ['organico', 'Orgánico y directo'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => onOrigenChange(id)}
              aria-pressed={origen === id}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                origen === id ? 'bg-brand-500 text-zinc-950' : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground text-xs font-medium">Atribución</span>
        <div className="flex gap-1" role="group" aria-label="Cobertura de atribución">
          {(
            [
              ['todos', 'Todos'],
              ['atribuidos', 'Atribuidos'],
              ['no_atribuidos', 'No atribuidos'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => onAtribucionChange(id)}
              aria-pressed={atribucion === id}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                atribucion === id
                  ? 'bg-brand-500 text-zinc-950'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
          <Target className="h-3.5 w-3.5" /> Embudo
        </span>
        <div
          className="bg-muted border-border flex rounded-lg border p-0.5"
          role="tablist"
          aria-label="Familia de embudo"
        >
          {FUNNEL_ORDEN.map((o) => (
            <button
              key={o}
              role="tab"
              aria-selected={funnelOpcion === o}
              onClick={() => onFunnelChange(o)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                funnelOpcion === o ? 'bg-brand-500 text-zinc-950' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {FUNNEL_LABELS[o]}
            </button>
          ))}
        </div>
        <button
          onClick={onToggleAvanzados}
          aria-expanded={avanzadosAbiertos}
          className="text-muted-foreground hover:text-foreground ml-auto text-xs underline underline-offset-2"
        >
          {avanzadosAbiertos ? 'Ocultar avanzados' : 'Filtros avanzados'}
        </button>
      </div>
      {avanzadosAbiertos && (
        <div className="border-border/60 text-muted-foreground mt-3 space-y-1 border-t pt-3 text-xs">
          <p>
            <span className="text-foreground font-medium">Canal y cuenta:</span> el canal lo determina el origen de la
            campaña sincronizada (Meta Ads hoy; Google, Instagram y TikTok cuando su integración traiga datos) y la
            cuenta se elige en el selector de Meta Ads de arriba.
          </p>
          <p>
            <span className="text-foreground font-medium">Campaña:</span> se filtra en{' '}
            <span className="text-foreground">Marketing › Campañas</span>, donde vive la tabla completa por campaña y
            anuncio. Aquí se muestran los agregados, no la tabla.
          </p>
          <p>
            <span className="text-foreground font-medium">Nota honesta:</span> hoy casi ningún contacto lleva
            campaign_id (la tabla de atribución está vacía), así que «Atribuidos» puede mostrar 0 aunque los totales del
            negocio no lo sean. No es un fallo de esta pantalla: es el estado real de la cobertura de datos.
          </p>
        </div>
      )}
    </div>
  )
}

type MarketingFunnel = {
  impressions: number
  clicks: number
  leads: number
  adspend: number
  cpm: number | null
  ctr: number | null
  cpc: number | null
  cpl: number | null
  clickToLead: number | null
  salesCallsBooked: number
  leadToBooked: number | null
  bscCost: number | null
  dealsClosed: number
  convertLsc: number | null
  grossFromDeals: number
  roas: number | null
  pipeValue: number
}

function buildMarketingFunnel(
  campaigns: CampaignRow[],
  contacts: ContactRow[],
  appointments: AppointmentRow[],
  sales: SaleRow[]
): MarketingFunnel {
  const impressions = campaigns.reduce((a, c) => a + num(c.impressions), 0)
  const clicks = campaigns.reduce((a, c) => a + num(c.clicks), 0)
  const adspend = campaigns.reduce((a, c) => a + num(c.adspend), 0)

  // Leads: preferimos Σ leads_generated de campañas; si no hay dato, contamos contacts con campaign_id
  const leadsFromCampaigns = campaigns.reduce((a, c) => a + num(c.leads_generated), 0)
  const contactsWithCampaign = contacts.filter((c) => !!c.campaign_id)
  const leads = leadsFromCampaigns || contactsWithCampaign.length

  const contactHasCampaign = new Set(contactsWithCampaign.map((c) => c.id))

  const salesCallsBooked = appointments.filter((a) => a.contact_id && contactHasCampaign.has(a.contact_id)).length

  const attributedSales = sales.filter(
    (s) => ACTIVE_SALE_STATUSES.includes(s.status) && s.contact_id && contactHasCampaign.has(s.contact_id)
  )
  const dealsClosed = attributedSales.length
  const grossFromDeals = attributedSales.reduce((a, s) => a + num(s.gross_amount), 0)

  const pipeValue = appointments
    .filter((a) => a.contact_id && contactHasCampaign.has(a.contact_id))
    .reduce((a, ap) => a + num(ap.pipe_value), 0)

  return {
    impressions,
    clicks,
    leads,
    adspend,
    cpm: safeDiv(adspend * 1000, impressions),
    ctr: safeDiv(clicks * 100, impressions),
    cpc: safeDiv(adspend, clicks),
    cpl: safeDiv(adspend, leads),
    clickToLead: safeDiv(leads * 100, clicks),
    salesCallsBooked,
    leadToBooked: safeDiv(salesCallsBooked * 100, leads),
    bscCost: safeDiv(adspend, salesCallsBooked),
    dealsClosed,
    convertLsc: safeDiv(dealsClosed * 100, salesCallsBooked),
    grossFromDeals,
    roas: safeDiv(grossFromDeals, adspend),
    pipeValue,
  }
}

// ── REALIDAD OPERACIONAL vs ATRIBUCIÓN ──────────────────────────────────────
// ERROR QUE ESTO CORRIGE: el funnel de marketing filtraba agendas y cierres por
// "¿el contacto tiene campaign_id?". Con contact_attributions a 0 filas, casi
// ningún contacto lo tiene, y el funnel enseñaba 0 agendas y 0 cierres aunque
// hubiera 559 agendas y 27 ventas REALES. La ausencia de atribución NO significa
// que el evento no haya ocurrido: los totales del negocio se cuentan del CRM
// (contacts/appointments/sales), y la atribución se declara aparte, nunca mezclada.

function buildFunnelOperativo(
  contacts: ContactRow[],
  appointments: AppointmentRow[],
  sales: SaleRow[],
  hayPeriodo: boolean,
  rango: PeriodRange
): FunnelOperativo {
  const ahora = new Date()
  // Leads por FECHA REAL (leadDate = first_seen_at → first_contact_at → created_at): created_at es
  // cuándo se importó la fila (la importación de GHL estampó todo el histórico el mismo día), no
  // cuándo llegó el lead.
  const contactos = hayPeriodo ? contacts.filter((c) => inPeriod(leadDate(c), rango)) : contacts
  const agendasVisibles = hayPeriodo
    ? appointments.filter((a) => inPeriod(a.appointment_datetime, rango))
    : appointments
  const ventas = hayPeriodo ? sales.filter((s) => inPeriod(s.sale_date, rango)) : sales
  const ventasActivas = ventas.filter((s) => ACTIVE_SALE_STATUSES.includes(s.status))

  // ASISTENCIA = misma semántica que el KPI "Shows" de esta misma página (buildSalesOverview):
  // citas vivas que ya pasaron. Los closers casi nunca marcan status='show' (4 de 559), así que
  // contar el status diría 4 asistencias mientras el KPI de al lado enseña 517. Dos números
  // distintos para el mismo concepto es exactamente el problema de nomenclatura que unifica el brief.
  const agendasVivasYaPasadas = agendasVisibles.filter((a) => {
    if (isCancelled(a.status)) return false
    if (!a.appointment_datetime) return true
    const t = Date.parse(a.appointment_datetime)
    return Number.isNaN(t) || t <= ahora.getTime()
  }).length

  const conCampaign = new Set(contacts.filter((c) => !!c.campaign_id).map((c) => c.id))
  const agendasAtrib = agendasVisibles.filter((a) => a.contact_id && conCampaign.has(a.contact_id)).length
  const ventasAtrib = ventasActivas.filter((s) => s.contact_id && conCampaign.has(s.contact_id))

  return {
    leads: contactos.length,
    agendas: agendasVisibles.length,
    asistencias: agendasVivasYaPasadas,
    cierres: ventasActivas.length,
    facturacion: ventasActivas.reduce((a, s) => a + num(s.gross_amount), 0),
    atribuidos: {
      agendas: agendasAtrib,
      cierres: ventasAtrib.length,
      facturacion: ventasAtrib.reduce((a, s) => a + num(s.gross_amount), 0),
    },
  }
}

function ratioColor(ratio: number | null): string {
  if (ratio === null) return 'text-muted-foreground'
  if (ratio >= 3) return 'text-emerald-400'
  if (ratio >= 1) return 'text-amber-400'
  return 'text-red-400'
}

// Fila de la serie diaria de campañas: es la que permite acotar por periodo, porque lleva la fecha.
type DailyRow = {
  campaign_id: string | null
  date: string
  spend: number | null
  impressions: number | null
  clicks: number | null
  leads: number | null
  account_id: string | null
}

export default function UnitEconomicsPage() {
  const tenant = useTenant()
  // Solo las cuentas elegidas en Integraciones. Sin esto, esta pantalla sumaba las CATORCE cuentas
  // que ve el token y lo presentaba como si fuera el negocio.
  const cuentas = useCuentasMetaActivas(tenant)
  // De dónde vienen los datos del bloque global. Es un FILTRO, no una condición de entrada: por
  // defecto se ve todo, venga de ads, de la web o de recomendación.
  const [origen, setOrigen] = useState<AttributionFilter>('todos')
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(DEFAULT_PERIOD)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [loading, setLoading] = useState(true)
  // Un fallo de lectura NO se pinta como 0: el CAC y el LTV saldrían inventados.
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [daily, setDaily] = useState<DailyRow[]>([])
  // Reuniones grabadas en Fathom que no casaron con ninguna cita: son llamadas que ocurrieron.
  const [fathomSueltas, setFathomSueltas] = useState<FathomSinCita[]>([])
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [sales, setSales] = useState<SaleRow[]>([])
  const [collections, setCollections] = useState<CollectionRow[]>([])
  // Espejo de pagos de Stripe (§2): fuente PRIMARIA del cash. Vacío = Stripe sin sincronizar →
  // el merge resuelve por el fallback (collections), nunca un 0 por "no conectado" (§39).
  const [stripePagos, setStripePagos] = useState<StripePaymentRow[]>([])
  // Objetivos del dashboard (§27): la MISMA tabla `targets` que ya consumen dashboard y ranking.
  // Sin filas las cards se muestran limpias — nunca un falso "0% del objetivo" (§39).
  const [targets, setTargets] = useState<TargetRowEstado[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [appointments, setAppointments] = useState<AppointmentRow[]>([])
  // Selección de cuentas Meta para las métricas de anuncios: 'todas' o un subconjunto de las
  // seleccionadas en Integraciones. NUNCA "todas las accesibles por el token": si el usuario
  // eligió A y C en Integraciones, B y D no existen para esta pantalla.
  const [cuentaSel, setCuentaSel] = useState<string>('todas')
  // Filtros de atribución. 'todos' manda por defecto: los totales del negocio primero. El filtro
  // de atribución acota a la parte DEMOSTRABLEMENTE atribuida o a la que falta atribuir, pero
  // NUNCA redefin el total: "no atribuible" no es "no ocurrió".
  const [atribucion, setAtribucion] = useState<FiltroAtribucion>('todos')
  const [avanzadosAbiertos, setAvanzadosAbiertos] = useState(false)
  // Selector de embudo — subido a la barra de filtros global (junto a origen/atribución).
  const [funnelOpcion, setFunnelOpcion] = useState<OpcionFunnel>('todos')

  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()
      const [campRes, salesRes, collRes, stripeRes, contactsRes, apptRes, dailyRes, fathomRes, targetsRes] =
        await Promise.all([
          supabase
            .from('campaigns')
            .select('id, channel, adspend, leads_generated, impressions, clicks, account_id')
            .range(0, FINANCE_QUERY_ROW_CAP),
          supabase
            .from('sales')
            .select('id, gross_amount, status, contact_id, sale_date')
            .range(0, FINANCE_QUERY_ROW_CAP),
          supabase
            .from('collections')
            .select('id, gross_amount, collected_at, status, payment_reference')
            .range(0, FINANCE_QUERY_ROW_CAP),
          // Fuente PRIMARIA del cash (§2): espejo de pagos de Stripe (succeeded, neto de su
          // refunded_amount). Sin filas el merge resuelve por collections — y el desglose por
          // fuente lo deja visible en vez de suponer que Stripe está al día.
          supabase
            .from('stripe_payments')
            .select('payment_id, charge_id, amount, refunded_amount, status, paid_at, customer_email')
            .range(0, FINANCE_QUERY_ROW_CAP),
          // email/phone entran para la consolidación canónica de leads (dedup por persona, §6/§17).
          supabase
            .from('contacts')
            .select('id, campaign_id, created_at, first_seen_at, email, phone')
            .range(0, FINANCE_QUERY_ROW_CAP),
          supabase
            .from('appointments')
            .select('id, contact_id, status, appointment_datetime, pipe_value, offered, result')
            .range(0, FINANCE_QUERY_ROW_CAP),
          // La serie DIARIA es lo que permite filtrar por periodo. El aviso que había aquí decía que no
          // se podía porque `campaigns.adspend` es un acumulado — cierto, pero `campaign_daily` existe
          // y tiene el gasto por día y campaña.
          supabase
            .from('campaign_daily')
            .select('campaign_id, date, spend, impressions, clicks, leads, account_id')
            .range(0, FINANCE_QUERY_ROW_CAP),
          supabase
            .from('fathom_match_review')
            .select('meeting_started_at, invitee_email')
            .eq('status', 'pendiente')
            .range(0, FINANCE_QUERY_ROW_CAP),
          supabase
            .from('targets')
            .select('id, metric_key, scope_type, is_active, period_type, period_start, period_end, target_value')
            .eq('scope_type', 'company'),
        ])
      if (!mounted) return
      const fallo = primerError(
        campRes,
        salesRes,
        collRes,
        stripeRes,
        contactsRes,
        apptRes,
        dailyRes,
        fathomRes,
        targetsRes
      )
      setErrorCarga(fallo ? mensajeDeCarga('los datos de campañas, ventas y cobros', fallo) : null)
      setCampaigns(campRes.data || [])
      setSales(salesRes.data || [])
      setCollections(collRes.data || [])
      setStripePagos((stripeRes.data || []) as StripePaymentRow[])
      setContacts(contactsRes.data || [])
      setAppointments(apptRes.data || [])
      setDaily(dailyRes.data || [])
      setFathomSueltas(fathomRes.data || [])
      setTargets((targetsRes.data || []) as TargetRowEstado[])
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const rango = useMemo(() => getPeriodRange(periodPreset, customFrom, customTo), [periodPreset, customFrom, customTo])
  const hayPeriodo = periodPreset !== 'all'

  // UN solo punto de verdad para "qué campañas cuentan": las de las cuentas seleccionadas
  // en Integraciones (cuentas.filtrar), acotado además al subconjunto elegido en el selector.
  const campaignsVisibles = useMemo(() => {
    const porIntegracion = cuentas.filtrar(campaigns)
    if (cuentaSel === 'todas') return porIntegracion
    return porIntegracion.filter((c) => !c.account_id || c.account_id === cuentaSel)
  }, [campaigns, cuentas, cuentaSel])
  const dailyVisible = useMemo(
    () =>
      cuentas
        .filtrar(daily)
        .filter((d) => !hayPeriodo || inPeriod(d.date, rango))
        .filter((d) => cuentaSel === 'todas' || !d.account_id || d.account_id === cuentaSel),
    [daily, cuentas, hayPeriodo, rango, cuentaSel]
  )

  // Con periodo activo mandan los datos DIARIOS; sin periodo, el acumulado de la campaña. Mezclarlos
  // daría un gasto que no corresponde a ninguna de las dos cosas.
  const campanasParaTotales = useMemo(() => {
    if (!hayPeriodo) return campaignsVisibles
    const porCampana = new Map<string, { spend: number; impressions: number; clicks: number; leads: number }>()
    for (const d of dailyVisible) {
      if (!d.campaign_id) continue
      const acc = porCampana.get(d.campaign_id) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0 }
      acc.spend += Number(d.spend ?? 0)
      acc.impressions += Number(d.impressions ?? 0)
      acc.clicks += Number(d.clicks ?? 0)
      acc.leads += Number(d.leads ?? 0)
      porCampana.set(d.campaign_id, acc)
    }
    return campaignsVisibles
      .filter((c) => porCampana.has(c.id))
      .map((c) => {
        const d = porCampana.get(c.id)!
        return {
          ...c,
          adspend: d.spend,
          impressions: d.impressions,
          clicks: d.clicks,
          leads_generated: d.leads,
        }
      })
  }, [hayPeriodo, campaignsVisibles, dailyVisible])

  const ventasVisibles = useMemo(
    () => (hayPeriodo ? sales.filter((s) => inPeriod(s.sale_date, rango)) : sales),
    [sales, hayPeriodo, rango]
  )

  const channelRows = useMemo(
    () => buildChannelRows(campanasParaTotales, ventasVisibles, contacts),
    [campanasParaTotales, ventasVisibles, contacts]
  )

  // CASH COLLECTED CANÓNICO (§2): fuente primaria Stripe (espejo) + cobros internos sin
  // contraparte en Stripe; dedup por payment_reference — el mismo dinero cuenta UNA vez y gana
  // la primaria; devoluciones restadas una sola vez y conflictos de importe registrados. La
  // tabla `refunds` aún no entra como tercer argumento: el reverso de un cobro interno ya
  // queda reflejado en su status 'reversed' en collections.
  const cash = useMemo(
    () =>
      canonicalCash(
        stripePagos.filter((p) => !hayPeriodo || inPeriod(p.paid_at, rango)),
        collections
          .filter((c) => !hayPeriodo || inPeriod(c.collected_at, rango))
          .map((c) => ({
            id: c.id ?? `${c.collected_at}:${c.gross_amount}`,
            payment_reference: c.payment_reference ?? null,
            gross_amount: num(c.gross_amount),
            status: c.status,
            collected_at: c.collected_at,
          })),
        []
      ),
    [stripePagos, collections, hayPeriodo, rango]
  )

  const totals = useMemo(() => {
    const totalAdspend = campanasParaTotales.reduce((a, c) => a + num(c.adspend), 0)
    // Neto del merge canónico (§2): NUNCA la suma de las dos fuentes — contar Stripe y la app
    // por separado convertiría un mismo cobro en dos.
    const totalCashCollected = cash.net
    const activeSales = ventasVisibles.filter((s) => ACTIVE_SALE_STATUSES.includes(s.status))
    // Clientes ÚNICOS, no nº de ventas — mismo fix que buildChannelRows. Antes dividía por
    // nº de ventas: un cliente que compra 2 veces contaba como "2 clientes", lo que infla el
    // denominador y hace que tanto CAC como "LTV medio" salgan sistemáticamente por debajo de
    // lo real.
    const totalCustomers = new Set(activeSales.map((s) => s.contact_id).filter((id): id is string => !!id)).size
    const totalGross = activeSales.reduce((a, s) => a + num(s.gross_amount), 0)

    const mer = totalAdspend ? totalCashCollected / totalAdspend : null
    const cacGlobal = totalCustomers ? totalAdspend / totalCustomers : null
    const ltvMedio = totalCustomers ? totalGross / totalCustomers : null
    const ltvCacRatio = cacGlobal && ltvMedio ? ltvMedio / cacGlobal : null

    return { totalAdspend, totalCashCollected, totalCustomers, mer, cacGlobal, ltvMedio, ltvCacRatio }
  }, [campanasParaTotales, ventasVisibles, cash])

  const marketingFunnel = useMemo(
    () => buildMarketingFunnel(campanasParaTotales, contacts, appointments, ventasVisibles),
    [campanasParaTotales, contacts, appointments, ventasVisibles]
  )

  // REALIDAD OPERACIONAL: totales del CRM en el periodo, SIN exigir atribución. Es lo que el
  // negocio vivió de verdad. La parte atribuida a anuncios se declara aparte y nunca colapsa
  // "no atribuible" a "0 eventos". El funnel 'todos' del selector dinámico SIEMPRE recibe este
  // total completo: es su definición. El filtro de atribución (atribucion) acota el resto de la
  // página, no esta base.
  const funnelOperativo = useMemo(
    () => buildFunnelOperativo(contacts, appointments, sales, hayPeriodo, rango),
    [contacts, appointments, sales, hayPeriodo, rango]
  )
  // El filtro de atribución NO recorta funnelOperativoBase (su definición es el total real);
  // lo que hace es decidir qué vista de ventas se enseña debajo, junto con el filtro de origen.
  // Se combinan en el filtro efectivo que ya entiende buildSalesOverview:
  //   atribuidos + (todos|ads)  → 'ads'      (solo lo demostrablemente atribuido)
  //   no_atribuidos             → 'organico' (lo que falta de atribuir)
  //   todos                     → el origen tal cual
  const filtroEfectivo: AttributionFilter = useMemo(() => {
    if (atribucion === 'atribuidos') return 'ads'
    if (atribucion === 'no_atribuidos') return 'organico'
    return origen
  }, [atribucion, origen])

  // Citas del periodo elegido, con el mismo rango que el resto de la pantalla.
  const agendasVisibles = useMemo(
    () => (hayPeriodo ? appointments.filter((a) => inPeriod(a.appointment_datetime, rango)) : appointments),
    [appointments, hayPeriodo, rango]
  )
  const fathomVisible = useMemo(
    () => (hayPeriodo ? fathomSueltas.filter((f) => inPeriod(f.meeting_started_at, rango)) : fathomSueltas),
    [fathomSueltas, hayPeriodo, rango]
  )
  const ventas = useMemo(
    () => buildSalesOverview(agendasVisibles, ventasVisibles, contacts, filtroEfectivo, new Date(), fathomVisible),
    [agendasVisibles, ventasVisibles, contacts, filtroEfectivo, fathomVisible]
  )

  const hasData = campaignsVisibles.length > 0 || sales.length > 0 || appointments.length > 0
  // ¿Hay campañas de anuncios que mirar? Decide si el bloque de atribución se muestra.
  const hasAdsData = campanasParaTotales.length > 0
  // El detalle de anuncios (cards de atribución, embudo de adquisición, tabla por canal) SOLO se
  // enseña cuando el filtro pide anuncios: con origen+atribución en "todos" la pantalla describe
  // el negocio entero, y mezclar "0 de 96 atribuidos" dentro de esa lectura confunde. Quien quiera
  // la vista de anuncios, la pide con el filtro — es exactamente para eso que existe.
  const vistaAnuncios = origen === 'ads' || atribucion === 'atribuidos'

  // ── TARGET vs ACTUAL (§29): el objetivo VIGENTE de cada métrica, comparado contra lo del periodo ──
  // El objetivo sale de la tabla `targets` (editada en Formularios KPI › Objetivos del dashboard):
  // gana el company activo cuya ventana SOLAPA con el periodo visible — un target "de este mes"
  // nunca se compara contra el acumulado histórico. Con el filtro en "todo" se usa el objetivo que
  // contiene hoy. Sin objetivo la card va limpia (sin_target), y un actual no calculable (ad spend
  // a cero) no pinta gap inventado (sin_dato) — la regla 0 ≠ NULL (§39) aplicada a los objetivos.
  const kpiObjetivos = (
    metricKey: string,
    actual: number | null,
    tipo: 'money' | 'count' | 'ratio'
  ): { status: 'verde' | 'ambar' | 'rojo'; gap: string; label: string } | null => {
    const metrica = METRICAS_CON_OBJETIVO.find((m) => m.key === metricKey)
    if (!metrica) return null
    const fromStr = hayPeriodo && rango.from ? rango.from.toISOString().slice(0, 10) : null
    const toStr = hayPeriodo && rango.to ? rango.to.toISOString().slice(0, 10) : null
    const objetivo = valorTarget(eligeTarget(targets, metricKey, fromStr, toStr, new Date().toISOString().slice(0, 10)))
    if (objetivo === null) return null
    const ev = evaluaTarget(actual, objetivo, metrica.direccion)
    if (ev.estado === 'sin_dato' || ev.estado === 'sin_target' || ev.gap === null) return null
    const fmt = (v: number) =>
      tipo === 'money'
        ? formatCurrency(v)
        : tipo === 'ratio'
          ? `${formatNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
          : formatNumber(v)
    return {
      status: ev.estado,
      gap: `${ev.gap >= 0 ? '+' : '-'}${fmt(Math.abs(ev.gap))}`,
      label: `objetivo ${fmt(objetivo)}`,
    }
  }

  // ── ENTIDADES CANÓNICAS (dashboard global §6/§17/§21) ──
  // Consolidación de leads (email › teléfono), agendas (evento calendario) y ventas
  // (oportunidad / contacto+fecha+importe) — SIN sumar dos fuentes del mismo evento.
  // El funnel canónico alimenta la sección "Funnel del negocio". El diagnóstico de calidad
  // (duplicados, conflictos, huecos de captura) vive en Configuración › Data Health.
  const funnelGlobal = useMemo(() => {
    const { leads } = canonicalizeLeads(
      contacts.map((c) => ({
        id: c.id,
        email: c.email ?? null,
        phone: c.phone ?? null,
        created_at: c.created_at ?? null,
      }))
    )
    const { appointments: apptsCanon } = canonicalizeAppointments(
      appointments.map((a) => ({
        id: a.id,
        contact_id: a.contact_id,
        calendly_event_id: null,
        calendar_event_id: null,
        scheduled_at: a.appointment_datetime,
        status: a.status,
      }))
    )
    const resueltas = appointments.map((a) => resolverOferta(a, CONFIG_OFERTA_POR_DEFECTO))
    const ofertas = resueltas.filter((r) => r.valor === true).length
    const offersDeclaradas = resueltas.filter((r) => r.valor === true && r.origen === 'declarado').length
    return {
      newUniqueLeads: leads.length,
      booked: apptsCanon.length,
      shows: funnelOperativo.asistencias,
      offers: ofertas,
      offersDeclaradas,
      sales: funnelOperativo.cierres,
    }
  }, [contacts, appointments, funnelOperativo])

  // ── EVOLUCIÓN TEMPORAL ───────────────────────────────────────────
  // Series día/semana/mes dentro de la ventana del periodo (o últimos 90 días si "todo").
  // Leads del CRM (contacts), agendas (appointments), cierres (ventas activas) y gasto+leads
  // de anuncios (campaign_daily, ya filtrado por cuenta/periodo). TrendChart pinta huecos
  // como huecos: un día sin dato no finge una caída a cero.
  const [granularidad, setGranularidad] = useState<'dia' | 'semana' | 'mes'>('dia')
  const etiquetaGranularidad = granularidad === 'dia' ? 'día' : granularidad === 'semana' ? 'semana' : 'mes'
  const seriesEvolucion = useMemo(() => {
    const fin = rango.to ?? new Date()
    const t1 = fin.getTime()
    const t0 = rango.from ? new Date(rango.from).getTime() : t1 - 90 * 86400000
    const porDia = new Map<string, { leads: number; agendas: number; cierres: number; spend: number }>()
    const dia = (d: string) => d.slice(0, 10)
    const bump = (d: string, k: 'leads' | 'agendas' | 'cierres' | 'spend', n: number) => {
      const key = dia(d)
      if (key < new Date(t0).toISOString().slice(0, 10) || key > iso(t1)) return
      const acc = porDia.get(key) ?? { leads: 0, agendas: 0, cierres: 0, spend: 0 }
      acc[k] += n
      porDia.set(key, acc)
    }
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
    for (const c of contacts) {
      if (leadDate(c)) bump(leadDate(c), 'leads', 1)
    }
    for (const a of appointments) {
      if (a.appointment_datetime) bump(a.appointment_datetime, 'agendas', 1)
    }
    for (const s of ventasVisibles) {
      if (ACTIVE_SALE_STATUSES.includes(s.status) && s.sale_date) bump(s.sale_date, 'cierres', 1)
    }
    for (const d of dailyVisible) {
      bump(d.date, 'spend', num(d.spend))
    }
    // Agregación por granularidad: día = tal cual; semana = dominio común (UTC); mes = 'YYYY-MM'.
    const agg = new Map<string, { leads: number; agendas: number; cierres: number; spend: number }>()
    const clave = (d: string) => {
      if (granularidad === 'dia') return d
      if (granularidad === 'semana') {
        const dt = new Date(`${d}T00:00:00Z`)
        dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay())
        return dt.toISOString().slice(0, 10)
      }
      return d.slice(0, 7)
    }
    for (const [d, v] of porDia) {
      const k = clave(d)
      const acc = agg.get(k) ?? { leads: 0, agendas: 0, cierres: 0, spend: 0 }
      acc.leads += v.leads
      acc.agendas += v.agendas
      acc.cierres += v.cierres
      acc.spend += v.spend
      agg.set(k, acc)
    }
    const fechas = [...agg.keys()].sort()
    const serie = (k: 'leads' | 'agendas' | 'cierres' | 'spend') =>
      fechas.map((f) => ({ date: f, value: agg.get(f)![k] }))
    return { leads: serie('leads'), agendas: serie('agendas'), cierres: serie('cierres'), spend: serie('spend') }
  }, [contacts, appointments, ventasVisibles, dailyVisible, rango, granularidad])

  // GATE DE TRACKING: una métrica sin ningún dato en la ventana no se pinta — ni gráfico vacío
  // ni "cero ruido". En cuanto haya un lead, una agenda, un cierre o gasto registrado, el
  // gráfico entra solo. La sección completa desaparece si no hay ninguna serie con datos.
  const tieneDatosSerie = (serie: { value: number }[]) => serie.some((p) => p.value > 0)
  const hayEvolucion = {
    leads: tieneDatosSerie(seriesEvolucion.leads),
    spend: tieneDatosSerie(seriesEvolucion.spend),
    agendas: tieneDatosSerie(seriesEvolucion.agendas),
    cierres: tieneDatosSerie(seriesEvolucion.cierres),
  }
  const evolucionVisible = Object.values(hayEvolucion).some(Boolean)

  // Distribución de facturación por canal (para el donut de la vista de anuncios).
  const donutCanal: Segmento[] = useMemo(
    () =>
      channelRows
        .filter((r) => r.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .map((r, i) => ({
          label: labelChannel(r.channel),
          value: r.revenue,
          color: `hsl(var(--brand-500) / ${Math.max(1 - i * 0.28, 0.16)})`,
        })),
    [channelRows]
  )

  return (
    <div className="dashboard-surface p-4 sm:p-6 space-y-5">
      {errorCarga && (
        <div className="dashboard-card border-destructive/40 p-4">
          <p className="text-foreground text-sm font-medium">Faltan datos para calcular estas cifras</p>
          <p className="text-muted-foreground mt-1 text-sm">{errorCarga}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-primary mt-2 text-sm hover:underline"
            type="button"
          >
            Reintentar
          </button>
        </div>
      )}
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <PieChart className="w-6 h-6 text-white" />
          <h1 className="text-2xl font-semibold text-foreground">Métricas y KPIs</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          Rentabilidad, ventas y conversión de tu negocio en el periodo seleccionado.
        </p>
        {/* El aviso que había aquí decía que esta pantalla no podía filtrar por periodo porque
            `campaigns.adspend` es un acumulado. Era cierto a medias: `campaign_daily` guarda el gasto
            por día y campaña, y es lo que se usa en cuanto se elige un periodo. */}
        {/* Estado REAL de la selección de cuentas: el texto anterior confesaba el bug
            ("Todas las cuentas de Meta accesibles") — ahora se declara lo que de verdad cuenta. */}
        <p className="text-muted-foreground mt-2 text-xs">
          {cuentas.listo && !cuentas.todas
            ? `Cuentas de Meta: solo las ${cuentas.seleccionadas.length} seleccionadas en Integraciones › Meta Ads.`
            : 'Cuentas de Meta: todas las accesibles por el token. Selecciona cuentas en Integraciones › Meta Ads para acotar.'}
          {hayPeriodo
            ? ' El gasto y las métricas de anuncios salen de la serie diaria del periodo elegido.'
            : ' Sin periodo: acumulado histórico desde el origen de los datos.'}
        </p>
      </div>

      {/* Selector de cuenta Meta: multi-select real cuando hay varias elegidas en Integraciones. */}
      {cuentas.listo && !cuentas.todas && cuentas.seleccionadas.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <Megaphone className="w-4 h-4 text-muted-foreground" />
          <span className="text-muted-foreground text-xs">Meta Ads:</span>
          <select
            value={cuentaSel}
            onChange={(e) => setCuentaSel(e.target.value)}
            className="bg-muted border border-border rounded-md px-2 py-1 text-xs text-foreground"
            aria-label="Cuenta de Meta Ads"
          >
            <option value="todas">Todas las seleccionadas ({cuentas.seleccionadas.length})</option>
            {cuentas.seleccionadas.map((id) => (
              <option key={id} value={id}>
                {cuentas.nombres?.[id] || id}
              </option>
            ))}
          </select>
        </div>
      )}

      <PeriodFilterBar
        preset={periodPreset}
        onPresetChange={setPeriodPreset}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        onClear={() => {
          setPeriodPreset('all')
          setCustomFrom('')
          setCustomTo('')
        }}
      />

      {/* FILTROS GLOBALES: origen + atribución + familia de embudo, todo en una barra. */}
      <FiltrosAtribucion
        origen={origen}
        onOrigenChange={setOrigen}
        atribucion={atribucion}
        onAtribucionChange={setAtribucion}
        avanzadosAbiertos={avanzadosAbiertos}
        onToggleAvanzados={() => setAvanzadosAbiertos((v) => !v)}
        funnelOpcion={funnelOpcion}
        onFunnelChange={setFunnelOpcion}
      />

      {/* Top cards: los datos principales del negocio, lo primero (jerarquía de lectura del
          dashboard: números que deciden presupuesto → funnel → detalle por departamento). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="MER"
          value={
            loading || totals.mer === null
              ? '—'
              : `${formatNumber(totals.mer, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
          }
          icon={TrendingUp}
          loading={loading}
          description={
            cash.bySource.stripe > 0 && cash.bySource.internal > 0
              ? `Cash neto: Stripe ${formatCurrency(cash.bySource.stripe)} + interno ${formatCurrency(cash.bySource.internal)} / ad spend`
              : cash.bySource.stripe > 0
                ? 'Cash neto de Stripe / ad spend'
                : 'Cash neto de cobros internos (Stripe sin sincronizar) / ad spend'
          }
          target={kpiObjetivos('mer', totals.mer, 'ratio') ?? undefined}
        />
        <KPICard
          title="CAC global"
          value={loading ? '—' : totals.cacGlobal !== null ? formatCurrency(totals.cacGlobal) : '—'}
          icon={Target}
          loading={loading}
          description="Ad spend / clientes únicos (no por venta)"
          target={kpiObjetivos('cac', totals.cacGlobal, 'money') ?? undefined}
        />
        <KPICard
          title="LTV medio"
          value={loading ? '—' : totals.ltvMedio !== null ? formatCurrency(totals.ltvMedio) : '—'}
          icon={Wallet}
          loading={loading}
          description="Facturación activa / clientes únicos"
        />
        <div className="dashboard-card p-5">
          <div className="flex items-start justify-between mb-4">
            <p className="text-sm font-medium text-muted-foreground">LTV:CAC ratio</p>
            <div className="w-9 h-9 rounded-lg border border-border bg-background flex items-center justify-center">
              <Users className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
          {loading ? (
            <div className="space-y-2">
              <div className="h-8 w-32 bg-muted animate-pulse rounded" />
              <div className="h-4 w-20 bg-muted animate-pulse rounded" />
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${ratioColor(totals.ltvCacRatio)}`}>
                  {totals.ltvCacRatio !== null
                    ? `${formatNumber(totals.ltvCacRatio, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}:1`
                    : '—'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Objetivo saludable: ≥ 3:1</p>
              {(() => {
                const t = kpiObjetivos('ltv_cac', totals.ltvCacRatio, 'ratio')
                return t ? <TargetRow target={t} /> : null
              })()}
            </>
          )}
        </div>
      </div>

      {/* FUNNEL DINÁMICO: la familia la elige la barra de filtros global (controlado). */}
      <FunnelDinamico
        tenant={tenant}
        operativo={funnelOperativo}
        loading={loading}
        opcion={funnelOpcion}
        rango={{ from: rangoISO(rango.from), to: rangoISO(rango.to) }}
      />

      {/* VENTAS Y AGENDAS — todas, vengan de donde vengan. El embudo de marketing de abajo mide lo
          atribuible a los anuncios y por eso deja fuera lo orgánico; esto NO puede heredar ese
          filtro, o la pantalla dice 0 citas con cientos en la base. El origen es un desplegable. */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-foreground text-lg font-semibold">Ventas y agendas</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Todas las del periodo, vengan de anuncios, de la web o de recomendación.
            </p>
          </div>
          <label className="text-muted-foreground text-xs">
            Origen
            <select
              value={origen}
              onChange={(e) => setOrigen(e.target.value as AttributionFilter)}
              className="border-border bg-background/60 text-foreground mt-1 block rounded-lg border px-2 py-1 text-sm"
            >
              <option value="todos">Todos los orígenes</option>
              <option value="ads">Solo atribuido a anuncios</option>
              <option value="organico">Orgánico y directo</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard
            title="Agendas"
            value={loading ? '—' : formatNumber(ventas.agendas)}
            icon={Users}
            loading={loading}
            description={`${formatNumber(ventas.canceladas)} canceladas`}
          />
          <KPICard
            title="Shows"
            value={loading ? '—' : formatNumber(ventas.shows)}
            icon={Target}
            loading={loading}
            // Una cita futura no cuenta como asistencia todavía: contarla daría un show-up que aún
            // no ha ocurrido, y con esa cifra se decide.
            description={
              ventas.llamadasSinCita > 0
                ? `Incluye ${formatNumber(ventas.llamadasSinCita)} llamadas grabadas en Fathom sin cita asociada`
                : 'Citas no canceladas que ya han pasado'
            }
          />
          <KPICard
            title="Ventas"
            value={loading ? '—' : formatNumber(ventas.ventas)}
            icon={Wallet}
            loading={loading}
            description={
              ventas.tasaCierre !== null ? `${formatPercent(ventas.tasaCierre)} de cierre sobre shows` : 'Sin shows aún'
            }
            target={kpiObjetivos('sales_count', ventas.ventas, 'count') ?? undefined}
          />
          <KPICard
            title="Facturación"
            value={loading ? '—' : formatCurrency(ventas.facturacion)}
            icon={TrendingUp}
            loading={loading}
            description={ventas.tasaAsistencia !== null ? `${formatPercent(ventas.tasaAsistencia)} de asistencia` : '—'}
            target={kpiObjetivos('revenue', ventas.facturacion, 'money') ?? undefined}
          />
        </div>
      </div>

      {/* EVOLUCIÓN TEMPORAL: día/semana/mes de las métricas que se gestionan por tendencia.
          Solo las series con datos entran; sin ninguna, la sección no se renderiza. */}
      {evolucionVisible && (
        <section className="dashboard-card p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">Evolución</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Variación en el tiempo del periodo seleccionado. Las campañas de anuncios aportan gasto; sin periodo se
                muestran los últimos 90 días.
              </p>
            </div>
            <div
              className="bg-muted border-border flex rounded-lg border p-0.5"
              role="tablist"
              aria-label="Granularidad"
            >
              {(
                [
                  ['dia', 'Día'],
                  ['semana', 'Semana'],
                  ['mes', 'Mes'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={granularidad === id}
                  onClick={() => setGranularidad(id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    granularidad === id ? 'bg-brand-500 text-zinc-950' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {hayEvolucion.leads && (
              <TrendChart title={`Leads por ${etiquetaGranularidad}`} data={seriesEvolucion.leads} />
            )}
            {hayEvolucion.spend && (
              <TrendChart
                title={`Gasto publicitario por ${etiquetaGranularidad}`}
                data={seriesEvolucion.spend}
                format={formatCurrency}
              />
            )}
            {hayEvolucion.agendas && (
              <TrendChart title={`Agendas por ${etiquetaGranularidad}`} data={seriesEvolucion.agendas} />
            )}
            {hayEvolucion.cierres && (
              <TrendChart title={`Cierres por ${etiquetaGranularidad}`} data={seriesEvolucion.cierres} />
            )}
          </div>
        </section>
      )}

      {/* ADQUISICIÓN ORGÁNICA (prototipo): contenido público del negocio vía Apify. Números con
          fuente visible; sin Apify configurado la sección muestra un estado honesto y nada más. */}
      <PanelOrganico />

      {/* FUNNEL GLOBAL (dashboard global §20-§23): una única versión coherente de la realidad —
          leads canónicos y agendas consolidadas. El diagnóstico de calidad (duplicados, conflictos,
          huecos de captura) vive en Configuración › Data Health. */}
      {!loading && (contacts.length > 0 || appointments.length > 0 || sales.length > 0) && (
        <FunnelCanonicoPanel funnel={funnelGlobal} />
      )}

      {/* ATRIBUCIÓN declarada aparte: nunca se resta del total del negocio. Solo tiene sentido en
          la vista de anuncios; en "todos" la pantalla describe el negocio completo. */}
      {vistaAnuncios && hasAdsData && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <div className="dashboard-card p-3">
            <p className="text-muted-foreground">Agendas atribuidas a anuncios</p>
            <p className="text-base font-semibold text-foreground mt-1">
              {formatNumber(funnelOperativo.atribuidos.agendas)}
              <span className="text-muted-foreground text-xs font-normal">
                {' '}
                de {formatNumber(funnelOperativo.agendas)}
              </span>
            </p>
          </div>
          <div className="dashboard-card p-3">
            <p className="text-muted-foreground">Cierres atribuidos</p>
            <p className="text-base font-semibold text-foreground mt-1">
              {formatNumber(funnelOperativo.atribuidos.cierres)}
              <span className="text-muted-foreground text-xs font-normal">
                {' '}
                de {formatNumber(funnelOperativo.cierres)}
              </span>
            </p>
          </div>
          <div className="dashboard-card p-3">
            <p className="text-muted-foreground">Facturación atribuida</p>
            <p className="text-base font-semibold text-foreground mt-1">
              {formatCurrency(funnelOperativo.atribuidos.facturacion)}
              <span className="text-muted-foreground text-xs font-normal">
                {' '}
                de {formatCurrency(funnelOperativo.facturacion)}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* DETALLE DE ANUNCIOS — solo en la vista de anuncios (vistaAnuncios): en "todos" la
          pantalla describe el negocio entero y este embudo mediría otra cosa. */}
      {vistaAnuncios && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Detalle de adquisición</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Impresiones, clicks y leads de campañas, atribuidos hasta el cierre de venta — solo lo que viene de
              anuncios. Las cifras de todo origen están arriba.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              title="Impressions"
              value={loading ? '—' : formatNumber(marketingFunnel.impressions)}
              icon={Megaphone}
              loading={loading}
            />
            <KPICard
              title="Clicks (outbound)"
              value={loading ? '—' : formatNumber(marketingFunnel.clicks)}
              icon={MousePointerClick}
              loading={loading}
            />
            <KPICard
              title="New unique leads"
              value={loading ? '—' : formatNumber(marketingFunnel.leads)}
              icon={Filter}
              loading={loading}
            />
            <KPICard
              title="Adspend"
              value={loading ? '—' : formatCurrency(marketingFunnel.adspend)}
              icon={Wallet}
              loading={loading}
            />
          </div>

          <div className="grid gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title="CPM"
                value={loading ? '—' : marketingFunnel.cpm !== null ? formatCurrency(marketingFunnel.cpm) : '—'}
                loading={loading}
                description="Coste por mil impresiones"
              />
              <KPICard
                title="CTR"
                value={loading ? '—' : formatPercent(marketingFunnel.ctr)}
                loading={loading}
                description="Clicks / impresiones"
              />
              <KPICard
                title="CPC"
                value={loading ? '—' : marketingFunnel.cpc !== null ? formatCurrency(marketingFunnel.cpc) : '—'}
                loading={loading}
                description="Coste por click"
              />
              <KPICard
                title="CPL"
                value={loading ? '—' : marketingFunnel.cpl !== null ? formatCurrency(marketingFunnel.cpl) : '—'}
                loading={loading}
                description="Coste por lead"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              title="% Clic a lead"
              value={loading ? '—' : formatPercent(marketingFunnel.clickToLead)}
              loading={loading}
            />
            <KPICard
              title="Agendas atribuidas"
              value={loading ? '—' : formatNumber(marketingFunnel.salesCallsBooked)}
              icon={Users}
              loading={loading}
              description="Citas de contactos con campaña"
            />
            <KPICard
              title="% Lead a agenda"
              value={loading ? '—' : formatPercent(marketingFunnel.leadToBooked)}
              loading={loading}
            />
            <KPICard
              title="Coste por agenda"
              value={loading ? '—' : marketingFunnel.bscCost !== null ? formatCurrency(marketingFunnel.bscCost) : '—'}
              loading={loading}
              description="Gasto publicitario / agendas atribuidas"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              title="Cierres atribuidos"
              value={loading ? '—' : formatNumber(marketingFunnel.dealsClosed)}
              icon={Target}
              loading={loading}
              description="Ventas de contactos con campaña"
            />
            <KPICard
              title="% Cierre sobre agendas"
              value={loading ? '—' : formatPercent(marketingFunnel.convertLsc)}
              loading={loading}
              description="Cierres atribuidos / agendas atribuidas"
            />
            <KPICard
              title="ROAS"
              value={
                loading || marketingFunnel.roas === null
                  ? '—'
                  : `${formatNumber(marketingFunnel.roas, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
              }
              icon={TrendingUp}
              loading={loading}
              description="Facturación de cierres atribuidos / gasto"
            />
            <KPICard
              title="Valor de pipeline"
              value={loading ? '—' : marketingFunnel.pipeValue > 0 ? formatCurrency(marketingFunnel.pipeValue) : '—'}
              icon={Wallet}
              loading={loading}
              description="Valor de pipeline en citas atribuidas"
            />
          </div>
        </div>
      )}

      {/* DISTRIBUCIÓN por canal (vista de anuncios): qué parte de la facturación y de los leads
          aporta cada canal. Con la cobertura de atribución actual puede no haber nada que
          distribuir — entonces no se enseña, en lugar de pintar donuts vacíos. */}
      {vistaAnuncios && (donutCanal.length > 0 || channelRows.some((r) => r.leads > 0)) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DonutChart title="Facturación por canal" data={donutCanal} format={formatCurrency} />
          <DonutChart
            title="Leads por canal"
            data={channelRows
              .filter((r) => r.leads > 0)
              .sort((a, b) => b.leads - a.leads)
              .map((r, i) => ({
                label: labelChannel(r.channel),
                value: r.leads,
                color: `hsl(var(--brand-500) / ${Math.max(1 - i * 0.28, 0.16)})`,
              }))}
          />
        </div>
      )}

      {/* Tabla por canal */}
      {vistaAnuncios && (
        <div className="dashboard-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Unit economics por canal</h3>
          {loading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-10 w-full bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : !hasData || channelRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sin datos todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground text-xs uppercase tracking-wider border-b border-border">
                    <th className="py-2 pr-4">Canal</th>
                    <th className="py-2 pr-4">Ad spend</th>
                    <th className="py-2 pr-4">Leads</th>
                    <th className="py-2 pr-4">CPL</th>
                    <th className="py-2 pr-4">Clientes</th>
                    <th className="py-2 pr-4">CAC</th>
                    <th className="py-2 pr-4">Revenue</th>
                    <th className="py-2 pr-4">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {channelRows.map((row) => (
                    <tr key={row.channel} className="border-b border-border/50 text-foreground">
                      <td className="py-2.5 pr-4 font-medium text-foreground">{labelChannel(row.channel)}</td>
                      <td className="py-2.5 pr-4">{formatCurrency(row.adspend)}</td>
                      <td className="py-2.5 pr-4">{formatNumber(row.leads)}</td>
                      <td className="py-2.5 pr-4">{row.cpl !== null ? formatCurrency(row.cpl) : '—'}</td>
                      <td className="py-2.5 pr-4">{formatNumber(row.customers)}</td>
                      <td className="py-2.5 pr-4">{row.cac !== null ? formatCurrency(row.cac) : '—'}</td>
                      <td className="py-2.5 pr-4">{formatCurrency(row.revenue)}</td>
                      <td className="py-2.5 pr-4">
                        {row.roas !== null ? (
                          <span className={ratioColor(row.roas)}>
                            {formatNumber(row.roas, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Nota de atribución */}
      {vistaAnuncios && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          La atribución por canal se calcula a partir de{' '}
          <span className="text-muted-foreground">contacts.campaign_id</span> (aproximación tipo last-touch): cada
          contacto se asigna al canal de la campaña que lo originó, y las ventas activas de esos contactos se atribuyen
          al canal correspondiente. Los clientes sin campaña asociada no se incluyen en el desglose por canal.
        </p>
      )}
    </div>
  )
}
