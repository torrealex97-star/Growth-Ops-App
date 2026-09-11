'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KPICard } from '@/components/os/DashboardKPICard'
import { PieChart, Target, Users, TrendingUp, Wallet, Filter, MousePointerClick, Megaphone } from 'lucide-react'
import { ACTIVE_SALE_STATUSES } from '@/lib/analytics'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { FINANCE_QUERY_ROW_CAP } from '@/lib/finance/pnl'

type CampaignRow = {
  id: string
  channel: string
  adspend: number | string | null
  leads_generated: number | string | null
  impressions: number | string | null
  clicks: number | string | null
}
type SaleRow = {
  id: string
  gross_amount: number | string | null
  status: string
  contact_id: string | null
  sale_date: string | null
}
type CollectionRow = {
  gross_amount: number | string | null
  collected_at: string | null
  status: string
}
type ContactRow = {
  id: string
  campaign_id: string | null
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

type ChannelRow = {
  channel: string
  adspend: number
  leads: number
  cpl: number | null
  customers: number
  cac: number | null
  revenue: number
  roas: number | null
}

function buildChannelRows(campaigns: CampaignRow[], sales: SaleRow[], contacts: ContactRow[]): ChannelRow[] {
  // campaign id -> channel
  const campaignChannel = new Map<string, string>()
  for (const c of campaigns) campaignChannel.set(c.id, c.channel || 'Sin canal')

  // contact id -> channel (via contacts.campaign_id -> campaign.channel)
  const contactChannel = new Map<string, string>()
  for (const ct of contacts) {
    if (ct.campaign_id) {
      const ch = campaignChannel.get(ct.campaign_id)
      if (ch) contactChannel.set(ct.id, ch)
    }
  }

  const agg = new Map<string, ChannelRow>()
  const ensure = (channel: string) =>
    agg.get(channel) ??
    agg
      .set(channel, { channel, adspend: 0, leads: 0, cpl: null, customers: 0, cac: null, revenue: 0, roas: null })
      .get(channel)!

  for (const c of campaigns) {
    const row = ensure(c.channel || 'Sin canal')
    row.adspend += num(c.adspend)
    row.leads += num(c.leads_generated)
  }

  for (const s of sales) {
    if (!ACTIVE_SALE_STATUSES.includes(s.status) || !s.contact_id) continue
    const channel = contactChannel.get(s.contact_id)
    if (!channel) continue
    const row = ensure(channel)
    row.customers += 1
    row.revenue += num(s.gross_amount)
  }

  agg.forEach((row) => {
    row.cpl = row.leads ? row.adspend / row.leads : null
    row.cac = row.customers ? row.adspend / row.customers : null
    row.roas = row.adspend ? row.revenue / row.adspend : null
  })

  return Array.from(agg.values()).sort((a, b) => b.adspend - a.adspend)
}

// Guard div/0 → null (se pinta como "—")
const safeDiv = (a: number, b: number): number | null => (b ? a / b : null)

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

function ratioColor(ratio: number | null): string {
  if (ratio === null) return 'text-muted-foreground'
  if (ratio >= 3) return 'text-emerald-400'
  if (ratio >= 1) return 'text-amber-400'
  return 'text-red-400'
}

export default function UnitEconomicsPage() {
  const [loading, setLoading] = useState(true)
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [sales, setSales] = useState<SaleRow[]>([])
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [appointments, setAppointments] = useState<AppointmentRow[]>([])

  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()
      const [campRes, salesRes, collRes, contactsRes, apptRes] = await Promise.all([
        supabase
          .from('campaigns')
          .select('id, channel, adspend, leads_generated, impressions, clicks')
          .range(0, FINANCE_QUERY_ROW_CAP),
        supabase
          .from('sales')
          .select('id, gross_amount, status, contact_id, sale_date')
          .range(0, FINANCE_QUERY_ROW_CAP),
        supabase.from('collections').select('gross_amount, collected_at, status').range(0, FINANCE_QUERY_ROW_CAP),
        supabase.from('contacts').select('id, campaign_id').range(0, FINANCE_QUERY_ROW_CAP),
        supabase
          .from('appointments')
          .select('id, contact_id, status, appointment_datetime, pipe_value')
          .range(0, FINANCE_QUERY_ROW_CAP),
      ])
      if (!mounted) return
      setCampaigns(campRes.data || [])
      setSales(salesRes.data || [])
      setCollections(collRes.data || [])
      setContacts(contactsRes.data || [])
      setAppointments(apptRes.data || [])
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const channelRows = useMemo(() => buildChannelRows(campaigns, sales, contacts), [campaigns, sales, contacts])

  const totals = useMemo(() => {
    const totalAdspend = campaigns.reduce((a, c) => a + num(c.adspend), 0)
    const totalCashCollected = collections
      .filter((c) => c.status === 'collected')
      .reduce((a, c) => a + num(c.gross_amount), 0)
    const activeSales = sales.filter((s) => ACTIVE_SALE_STATUSES.includes(s.status))
    const totalCustomers = activeSales.length
    const totalGross = activeSales.reduce((a, s) => a + num(s.gross_amount), 0)

    const mer = totalAdspend ? totalCashCollected / totalAdspend : null
    const cacGlobal = totalCustomers ? totalAdspend / totalCustomers : null
    const ltvMedio = totalCustomers ? totalGross / totalCustomers : null
    const ltvCacRatio = cacGlobal && ltvMedio ? ltvMedio / cacGlobal : null

    return { totalAdspend, totalCashCollected, totalCustomers, mer, cacGlobal, ltvMedio, ltvCacRatio }
  }, [campaigns, collections, sales])

  const marketingFunnel = useMemo(
    () => buildMarketingFunnel(campaigns, contacts, appointments, sales),
    [campaigns, contacts, appointments, sales]
  )

  const hasData = campaigns.length > 0 || sales.length > 0

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <PieChart className="w-6 h-6 text-white" />
          <h1 className="text-2xl font-semibold text-foreground">Métricas y KPIs</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          Pasa el ratón por las gráficas para ver el rendimiento mes a mes.
        </p>
      </div>

      {/* Top cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="MER"
          value={loading ? '—' : totals.mer !== null ? `${totals.mer.toFixed(2)}x` : '—'}
          icon={TrendingUp}
          loading={loading}
          description="Cash collected / ad spend"
        />
        <KPICard
          title="CAC global"
          value={loading ? '—' : totals.cacGlobal !== null ? formatCurrency(totals.cacGlobal) : '—'}
          icon={Target}
          loading={loading}
          description="Ad spend / clientes nuevos"
        />
        <KPICard
          title="LTV medio"
          value={loading ? '—' : totals.ltvMedio !== null ? formatCurrency(totals.ltvMedio) : '—'}
          icon={Wallet}
          loading={loading}
          description="Facturación media por venta activa"
        />
        <div className="rounded-2xl border border-[#26262A] bg-[#141416] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_8px_24px_rgba(0,0,0,0.3)]">
          <div className="flex items-start justify-between mb-4">
            <p className="text-sm font-medium text-muted-foreground">LTV:CAC ratio</p>
            <div className="w-9 h-9 rounded-lg border border-[#26262A] bg-[#0A0A0B] flex items-center justify-center">
              <Users className="w-4 h-4 text-[#A1A1AA]" />
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
                  {totals.ltvCacRatio !== null ? `${totals.ltvCacRatio.toFixed(2)}:1` : '—'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Objetivo saludable: ≥ 3:1</p>
            </>
          )}
        </div>
      </div>

      {/* Embudo de marketing */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Embudo de marketing</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Impresiones, clicks y leads de campañas, atribuidos hasta el cierre de venta
          </p>
        </div>

        {/* Cards de tráfico y coste */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Impressions"
            value={loading ? '—' : marketingFunnel.impressions.toLocaleString('es-ES')}
            icon={Megaphone}
            loading={loading}
          />
          <KPICard
            title="Clicks (outbound)"
            value={loading ? '—' : marketingFunnel.clicks.toLocaleString('es-ES')}
            icon={MousePointerClick}
            loading={loading}
          />
          <KPICard
            title="New unique leads"
            value={loading ? '—' : marketingFunnel.leads.toLocaleString('es-ES')}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="% Click to Lead"
            value={loading ? '—' : formatPercent(marketingFunnel.clickToLead)}
            loading={loading}
          />
          <KPICard
            title="Sales calls booked"
            value={loading ? '—' : marketingFunnel.salesCallsBooked.toLocaleString('es-ES')}
            icon={Users}
            loading={loading}
            description="Citas de contactos con campaña"
          />
          <KPICard
            title="% Lead to Booked"
            value={loading ? '—' : formatPercent(marketingFunnel.leadToBooked)}
            loading={loading}
          />
          <KPICard
            title="BSC cost"
            value={loading ? '—' : marketingFunnel.bscCost !== null ? formatCurrency(marketingFunnel.bscCost) : '—'}
            loading={loading}
            description="Coste por sales call agendada"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Deals closed"
            value={loading ? '—' : marketingFunnel.dealsClosed.toLocaleString('es-ES')}
            icon={Target}
            loading={loading}
            description="Ventas atribuidas a marketing"
          />
          <KPICard
            title="% Convert LSC"
            value={loading ? '—' : formatPercent(marketingFunnel.convertLsc)}
            loading={loading}
            description="Closes / sales calls booked"
          />
          <KPICard
            title="ROAS"
            value={loading ? '—' : marketingFunnel.roas !== null ? `${marketingFunnel.roas.toFixed(2)}x` : '—'}
            icon={TrendingUp}
            loading={loading}
            description="Gross de deals cerrados / adspend"
          />
          <KPICard
            title="Pipe value"
            value={loading ? '—' : marketingFunnel.pipeValue > 0 ? formatCurrency(marketingFunnel.pipeValue) : '—'}
            icon={Wallet}
            loading={loading}
            description="Valor de pipeline en citas atribuidas"
          />
        </div>

        {/* Mini-embudo visual */}
        <div className="rounded-2xl border border-[#26262A] bg-[#141416] p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">
            Impresiones → Clicks → Leads → Sales Calls → Closes
          </h3>
          {loading ? (
            <div className="h-24 w-full bg-muted animate-pulse rounded" />
          ) : (
            <div className="flex flex-col sm:flex-row items-stretch gap-2">
              {[
                { label: 'Impresiones', value: marketingFunnel.impressions },
                { label: 'Clicks', value: marketingFunnel.clicks },
                { label: 'Leads', value: marketingFunnel.leads },
                { label: 'Sales Calls', value: marketingFunnel.salesCallsBooked },
                { label: 'Closes', value: marketingFunnel.dealsClosed },
              ].map((stage, i, arr) => {
                const prev = i > 0 ? arr[i - 1].value : null
                const pct = prev !== null ? safeDiv(stage.value * 100, prev) : null
                return (
                  <div key={stage.label} className="flex items-center gap-2 flex-1">
                    <div className="flex-1 rounded-2xl border border-[#26262A] bg-[#0A0A0B] p-4 text-center">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">{stage.label}</p>
                      <p className="text-xl font-bold text-foreground mt-1">{stage.value.toLocaleString('es-ES')}</p>
                      {pct !== null && <p className="text-xs text-white mt-1">{pct.toFixed(1)}% vs. anterior</p>}
                    </div>
                    {i < arr.length - 1 && <span className="text-muted-foreground text-lg hidden sm:block">→</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Tabla por canal */}
      <div className="rounded-2xl border border-[#26262A] bg-[#141416] p-5">
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
                    <td className="py-2.5 pr-4">{row.leads.toLocaleString('es-ES')}</td>
                    <td className="py-2.5 pr-4">{row.cpl !== null ? formatCurrency(row.cpl) : '—'}</td>
                    <td className="py-2.5 pr-4">{row.customers.toLocaleString('es-ES')}</td>
                    <td className="py-2.5 pr-4">{row.cac !== null ? formatCurrency(row.cac) : '—'}</td>
                    <td className="py-2.5 pr-4">{formatCurrency(row.revenue)}</td>
                    <td className="py-2.5 pr-4">
                      {row.roas !== null ? <span className={ratioColor(row.roas)}>{row.roas.toFixed(2)}x</span> : '—'}
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
