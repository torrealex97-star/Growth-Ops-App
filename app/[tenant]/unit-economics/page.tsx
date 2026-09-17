'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ConnectedFunnel } from '@/components/os/ConnectedFunnel'
import { FunnelDinamico, type OpcionFunnel } from '@/components/os/FunnelDinamico'
import { KPICard } from '@/components/os/DashboardKPICard'
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
import { DEFAULT_PERIOD,  getPeriodRange, inPeriod, type PeriodPreset, type PeriodRange } from '@/lib/filters/period'
import { isCancelled } from '@/lib/unit-economics'
import type { FunnelOperativo, FiltroAtribucion } from '@/lib/metrics/operativo'

type CollectionRow = {
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
  afiliados: 'Afiliados',
  affiliate: 'Afiliados',
  otro: 'Otro',
  other: 'Otro',
}
const labelChannel = (ch: string) => CHANNEL_LABELS[ch?.toLowerCase()] || ch || 'Sin canal'

// Guard div/0 → null (se pinta como "—")
const safeDiv = (a: number, b: number): number | null => (b ? a / b : null)

// Etiqueta de cobertura de atribución del funnel del negocio: dice cuánta parte del negocio
// puede demostrarse atribuida a anuncios, sin dar por hecho que lo no atribuido no ocurrió.
function cuentaAtribucionLabel(f: FunnelOperativo, hayAnuncios: boolean): string {
  if (!hayAnuncios) return 'sin campañas sincronizadas: solo realidad operacional'
  if (f.cierres === 0) return 'sin cierres en el periodo'
  const pctAtrib = Math.round((f.atribuidos.cierres / f.cierres) * 100)
  return `${pctAtrib}% de cierres atribuidos a anuncios`
}

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
}: {
  origen: AttributionFilter
  onOrigenChange: (v: AttributionFilter) => void
  atribucion: FiltroAtribucion
  onAtribucionChange: (v: FiltroAtribucion) => void
  avanzadosAbiertos: boolean
  onToggleAvanzados: () => void
}) {
  return (
    <div className="dashboard-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
          <Filter className="h-3.5 w-3.5" /> Origen
        </span>
        <div className="flex gap-1" role="group" aria-label="Origen de los leads">
          {([
            ['todos', 'Todos'],
            ['ads', 'Solo anuncios'],
            ['organico', 'Orgánico y directo'],
          ] as const).map(([id, label]) => (
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
          {([
            ['todos', 'Todos'],
            ['atribuidos', 'Atribuidos'],
            ['no_atribuidos', 'No atribuidos'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => onAtribucionChange(id)}
              aria-pressed={atribucion === id}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                atribucion === id ? 'bg-brand-500 text-zinc-950' : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
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
            <span className="text-foreground font-medium">Canal y cuenta:</span> el canal lo determina el origen de
            la campaña sincronizada (Meta Ads hoy; Google, Instagram y TikTok cuando su integración traiga datos) y
            la cuenta se elige en el selector de Meta Ads de arriba.
          </p>
          <p>
            <span className="text-foreground font-medium">Campaña:</span> se filtra en{' '}
            <span className="text-foreground">Marketing › Campañas</span>, donde vive la tabla completa por campaña y
            anuncio. Aquí se muestran los agregados, no la tabla.
          </p>
          <p>
            <span className="text-foreground font-medium">Nota honesta:</span> hoy casi ningún contacto lleva
            campaign_id (la tabla de atribución está vacía), así que "Atribuidos" puede mostrar 0 aunque los totales
            del negocio no lo sean. No es un fallo de esta pantalla: es el estado real de la cobertura de datos.
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
  const contactos = hayPeriodo ? contacts.filter((c) => c.created_at && inPeriod(c.created_at, rango)) : contacts
  const agendasVisibles = hayPeriodo ? appointments.filter((a) => inPeriod(a.appointment_datetime, rango)) : appointments
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
  const [daily, setDaily] = useState<DailyRow[]>([])
  // Reuniones grabadas en Fathom que no casaron con ninguna cita: son llamadas que ocurrieron.
  const [fathomSueltas, setFathomSueltas] = useState<FathomSinCita[]>([])
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [sales, setSales] = useState<SaleRow[]>([])
  const [collections, setCollections] = useState<CollectionRow[]>([])
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

  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()
      const [campRes, salesRes, collRes, contactsRes, apptRes, dailyRes, fathomRes] = await Promise.all([
        supabase
          .from('campaigns')
          .select('id, channel, adspend, leads_generated, impressions, clicks, account_id')
          .range(0, FINANCE_QUERY_ROW_CAP),
        supabase
          .from('sales')
          .select('id, gross_amount, status, contact_id, sale_date')
          .range(0, FINANCE_QUERY_ROW_CAP),
        supabase.from('collections').select('gross_amount, collected_at, status').range(0, FINANCE_QUERY_ROW_CAP),
        supabase.from('contacts').select('id, campaign_id, created_at').range(0, FINANCE_QUERY_ROW_CAP),
        supabase
          .from('appointments')
          .select('id, contact_id, status, appointment_datetime, pipe_value')
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
      ])
      if (!mounted) return
      setCampaigns(campRes.data || [])
      setSales(salesRes.data || [])
      setCollections(collRes.data || [])
      setContacts(contactsRes.data || [])
      setAppointments(apptRes.data || [])
      setDaily(dailyRes.data || [])
      setFathomSueltas(fathomRes.data || [])
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

  const totals = useMemo(() => {
    const totalAdspend = campanasParaTotales.reduce((a, c) => a + num(c.adspend), 0)
    const totalCashCollected = collections
      .filter((c) => c.status === 'collected')
      .filter((c) => !hayPeriodo || inPeriod(c.collected_at, rango))
      .reduce((a, c) => a + num(c.gross_amount), 0)
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
  }, [campanasParaTotales, collections, ventasVisibles, hayPeriodo, rango])

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

  return (
    <div className="dashboard-surface p-4 sm:p-6 space-y-5">
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

      {/* FILTRO DE ATRIBUCIÓN: principals visibles, avanzados bajo demanda. */}
      <FiltrosAtribucion
        origen={origen}
        onOrigenChange={setOrigen}
        atribucion={atribucion}
        onAtribucionChange={setAtribucion}
        avanzadosAbiertos={avanzadosAbiertos}
        onToggleAvanzados={() => setAvanzadosAbiertos((v) => !v)}
      />

      {/* FUNNEL DINÁMICO: familia 'todos' = realidad operacional; las demás salen del motor lib/funnels. */}
      <FunnelDinamico
        tenant={tenant}
        operativo={funnelOperativo}
        loading={loading}
        rango={{ from: rangoISO(rango.from), to: rangoISO(rango.to) }}
      />

      {/* ATRIBUCIÓN declarada aparte: nunca se resta del total del negocio. */}
      {hasAdsData && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <div className="dashboard-card p-3">
            <p className="text-muted-foreground">Agendas atribuidas a anuncios</p>
            <p className="text-base font-semibold text-foreground mt-1">
              {formatNumber(funnelOperativo.atribuidos.agendas)}
              <span className="text-muted-foreground text-xs font-normal"> de {formatNumber(funnelOperativo.agendas)}</span>
            </p>
          </div>
          <div className="dashboard-card p-3">
            <p className="text-muted-foreground">Cierres atribuidos</p>
            <p className="text-base font-semibold text-foreground mt-1">
              {formatNumber(funnelOperativo.atribuidos.cierres)}
              <span className="text-muted-foreground text-xs font-normal"> de {formatNumber(funnelOperativo.cierres)}</span>
            </p>
          </div>
          <div className="dashboard-card p-3">
            <p className="text-muted-foreground">Facturación atribuida</p>
            <p className="text-base font-semibold text-foreground mt-1">
              {formatCurrency(funnelOperativo.atribuidos.facturacion)}
              <span className="text-muted-foreground text-xs font-normal"> de {formatCurrency(funnelOperativo.facturacion)}</span>
            </p>
          </div>
        </div>
      )}

      {/* Top cards */}
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
          description="Cash collected / ad spend"
        />
        <KPICard
          title="CAC global"
          value={loading ? '—' : totals.cacGlobal !== null ? formatCurrency(totals.cacGlobal) : '—'}
          icon={Target}
          loading={loading}
          description="Ad spend / clientes únicos (no por venta)"
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
            </>
          )}
        </div>
      </div>

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
          />
          <KPICard
            title="Facturación"
            value={loading ? '—' : formatCurrency(ventas.facturacion)}
            icon={TrendingUp}
            loading={loading}
            description={ventas.tasaAsistencia !== null ? `${formatPercent(ventas.tasaAsistencia)} de asistencia` : '—'}
          />
        </div>
      </div>

      {/* Embudo de marketing */}
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

      {/* Tabla por canal */}
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

      {/* Nota de atribución */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        La atribución por canal se calcula a partir de{' '}
        <span className="text-muted-foreground">contacts.campaign_id</span> (aproximación tipo last-touch): cada
        contacto se asigna al canal de la campaña que lo originó, y las ventas activas de esos contactos se atribuyen al
        canal correspondiente. Los clientes sin campaña asociada no se incluyen en el desglose por canal.
      </p>
    </div>
  )
}
