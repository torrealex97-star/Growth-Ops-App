import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { deriveDailyRow, isPaidSource, type DailyFunnelInput, type DailyFunnelRow } from '@/lib/ads/funnel'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing', 'adscripcion']

// Resumen DIARIO de métricas (una fila por fecha) para el equipo de ads.
//   · Métricas de ads por día  → campaign_daily (gasto, impresiones, alcance, clics de enlace,
//     visitas a la página, registros/leads).
//   · Agendas de tráfico pago por día → appointments cuya fuente UTM es de pago (Meta), cruzadas
//     por fecha de la cita.
// Filtros: rango [from,to], `campaign` (contiene, para aislar campañas de VSL) y `paidOnly`
// (solo agendas de tráfico pago, por defecto activo). Devuelve filas ya con métricas derivadas.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: urow } = await sb.from('users').select('roles(key)').eq('id', t.userId).single()
    const role = (urow?.roles as { key?: string } | null)?.key
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const from = req.nextUrl.searchParams.get('from')
    const to = req.nextUrl.searchParams.get('to')
    const campaignQ = (req.nextUrl.searchParams.get('campaign') || '').trim().toLowerCase()
    const paidOnly = req.nextUrl.searchParams.get('paidOnly') !== '0' // por defecto: solo tráfico pago

    // Nombre de cada campaña (para el filtro "contiene" sobre la serie diaria).
    const { data: campRows } = await sb.from('campaigns').select('id, name').eq('tenant_id', t.tenantId)
    const nameById = new Map<string, string>(
      (campRows || []).map((c: { id: string; name: string | null }) => [c.id, (c.name || '').toLowerCase()])
    )
    const campaignMatch = (name: string | undefined) => !campaignQ || (name || '').includes(campaignQ)

    // 1) Métricas de ads por día (campaign_daily). select('*') para tolerar bases sin las
    //    columnas nuevas (link_clicks / landing_views) hasta que se aplique la migración v33.
    type AdAgg = { spend: number; impressions: number; reach: number; clicsSalientes: number; visitas: number; registros: number }
    const adByDate = new Map<string, AdAgg>()
    const PAGE = 1000
    let offset = 0
    for (let guard = 0; guard < 200; guard++) {
      let q = sb.from('campaign_daily').select('*').eq('tenant_id', t.tenantId)
      if (from) q = q.gte('date', from)
      if (to) q = q.lte('date', to)
      const { data, error } = await q.range(offset, offset + PAGE - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const rows = (data ?? []) as Array<Record<string, unknown>>
      for (const r of rows) {
        const cid = String(r.campaign_id ?? '')
        if (!campaignMatch(nameById.get(cid))) continue
        const date = String(r.date ?? '').slice(0, 10)
        if (!date) continue
        const acc = adByDate.get(date) || { spend: 0, impressions: 0, reach: 0, clicsSalientes: 0, visitas: 0, registros: 0 }
        acc.spend += Number(r.spend) || 0
        acc.impressions += Number(r.impressions) || 0
        acc.reach += Number(r.reach) || 0
        acc.clicsSalientes += Number(r.link_clicks) || 0
        acc.visitas += Number(r.landing_views) || 0
        acc.registros += Number(r.leads) || 0
        adByDate.set(date, acc)
      }
      if (rows.length < PAGE) break
      offset += PAGE
    }

    // 2) Agendas por día (appointments). Solo tráfico pago (UTM de Meta) si paidOnly.
    const apptByDate = new Map<string, number>()
    offset = 0
    for (let guard = 0; guard < 200; guard++) {
      let q = sb.from('appointments').select('appointment_datetime, source, utm_source, utm_campaign').eq('tenant_id', t.tenantId)
      if (from) q = q.gte('appointment_datetime', `${from}T00:00:00`)
      if (to) q = q.lte('appointment_datetime', `${to}T23:59:59`)
      const { data, error } = await q.range(offset, offset + PAGE - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const rows = (data ?? []) as Array<Record<string, unknown>>
      for (const r of rows) {
        if (paidOnly && !isPaidSource(r.utm_source as string, r.source as string)) continue
        if (campaignQ && !String(r.utm_campaign ?? '').toLowerCase().includes(campaignQ)) continue
        const date = String(r.appointment_datetime ?? '').slice(0, 10)
        if (!date) continue
        apptByDate.set(date, (apptByDate.get(date) || 0) + 1)
      }
      if (rows.length < PAGE) break
      offset += PAGE
    }

    // 3) Unión de fechas → fila diaria con métricas derivadas, ordenadas por fecha ascendente.
    const dateSet = new Set<string>()
    adByDate.forEach((_v, k) => dateSet.add(k))
    apptByDate.forEach((_v, k) => dateSet.add(k))
    const dates = Array.from(dateSet).sort()
    const rows: DailyFunnelRow[] = dates.map((date) => {
      const a = adByDate.get(date)
      const input: DailyFunnelInput = {
        date,
        inversion: a?.spend || 0,
        impresiones: a?.impressions || 0,
        alcance: a?.reach || 0,
        clicsSalientes: a?.clicsSalientes || 0,
        visitas: a?.visitas || 0,
        registros: a?.registros || 0,
        agendas: apptByDate.get(date) || 0,
      }
      return deriveDailyRow(input)
    })

    return NextResponse.json({ ok: true, rows })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
