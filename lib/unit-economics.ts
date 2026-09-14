import { ACTIVE_SALE_STATUSES } from '@/lib/analytics'

// Lógica pura de agregación por canal (CAC/LTV) de Unit Economics, extraída del
// componente de página para poder testearla sin un transform de JSX (ver
// tests/metrics/unit-economics.test.mjs y docs/METRICS.md sección 6).

export type CampaignRow = {
  id: string
  channel: string
  adspend: number | string | null
  leads_generated: number | string | null
  impressions?: number | string | null
  clicks?: number | string | null
  /** Cuenta publicitaria de origen (act_XXX). Es lo que permite mostrar SOLO las seleccionadas. */
  account_id?: string | null
}
export type SaleRow = {
  id: string
  gross_amount: number | string | null
  status: string
  contact_id: string | null
  sale_date?: string | null
}
export type ContactRow = {
  id: string
  campaign_id: string | null
}

export type ChannelRow = {
  channel: string
  adspend: number
  leads: number
  cpl: number | null
  customers: number
  cac: number | null
  revenue: number
  roas: number | null
}

const num = (x: number | string | null | undefined) => Number(x ?? 0)

export function buildChannelRows(campaigns: CampaignRow[], sales: SaleRow[], contacts: ContactRow[]): ChannelRow[] {
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

  // "customers" = clientes ÚNICOS (contact_id distinto), no nº de ventas — un mismo cliente con
  // 2 ventas activas en el canal no debe contar como 2 clientes (infla artificialmente el CAC
  // hacia abajo y hace parecer el canal más eficiente de lo que es).
  const seenPerChannel = new Map<string, Set<string>>()
  for (const s of sales) {
    if (!ACTIVE_SALE_STATUSES.includes(s.status) || !s.contact_id) continue
    const channel = contactChannel.get(s.contact_id)
    if (!channel) continue
    const row = ensure(channel)
    const seen = seenPerChannel.get(channel) ?? seenPerChannel.set(channel, new Set()).get(channel)!
    if (!seen.has(s.contact_id)) {
      seen.add(s.contact_id)
      row.customers += 1
    }
    row.revenue += num(s.gross_amount)
  }

  agg.forEach((row) => {
    row.cpl = row.leads ? row.adspend / row.leads : null
    row.cac = row.customers ? row.adspend / row.customers : null
    row.roas = row.adspend ? row.revenue / row.adspend : null
  })

  return Array.from(agg.values()).sort((a, b) => b.adspend - a.adspend)
}
