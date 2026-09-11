import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import type { KpiAutoMetrics } from '@/lib/kpi/auto'

export const runtime = 'nodejs'

// Métricas del KPI diario calculadas automáticamente desde la app para un
// usuario y una fecha (agendas atribuidas por setter_id/closer_id + ventas +
// cash collected del closer). Usa service role para no depender de RLS.
// GET /api/${tenant}/evergreen/kpi/auto?date=YYYY-MM-DD[&userId=...(solo líderes)]
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const date = req.nextUrl.searchParams.get('date')
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Falta date (YYYY-MM-DD)' }, { status: 400 })
    }

    const sb = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Por defecto, el propio usuario. Un líder puede pedir el de otro.
    let targetId = t.userId
    const asked = req.nextUrl.searchParams.get('userId')
    if (asked && asked !== t.userId) {
      const { data: row } = await sb.from('users').select('roles(key)').eq('id', t.userId).maybeSingle()
      const role = (row?.roles as { key?: string } | null)?.key
      if (['admin', 'director', 'manager'].includes(role || '')) targetId = asked
    }

    const start = `${date}T00:00:00`
    const nextDay = new Date(`${date}T00:00:00Z`)
    nextDay.setUTCDate(nextDay.getUTCDate() + 1)
    const end = nextDay.toISOString()

    const SHOW = ['show', 'completed']

    const [setterAll, closerAll, salesRes, collRes] = await Promise.all([
      sb
        .from('appointments')
        .select('status')
        .eq('setter_id', targetId)
        .eq('tenant_id', t.tenantId)
        .gte('appointment_datetime', start)
        .lt('appointment_datetime', end),
      sb
        .from('appointments')
        .select('status')
        .eq('closer_id', targetId)
        .eq('tenant_id', t.tenantId)
        .gte('appointment_datetime', start)
        .lt('appointment_datetime', end),
      sb.from('sales').select('id').eq('closer_id', targetId).eq('tenant_id', t.tenantId).eq('sale_date', date),
      sb
        .from('collections')
        .select('gross_amount, sales!inner(closer_id)')
        .eq('sales.closer_id', targetId)
        .eq('tenant_id', t.tenantId)
        .gte('collected_at', start)
        .lt('collected_at', end),
    ])

    const setterAppts = setterAll.data ?? []
    const closerAppts = closerAll.data ?? []
    const metrics: KpiAutoMetrics = {
      setter_agendas: setterAppts.length,
      setter_shows: setterAppts.filter((a) => SHOW.includes(String(a.status))).length,
      closer_appointments: closerAppts.length,
      closer_shows: closerAppts.filter((a) => SHOW.includes(String(a.status))).length,
      closer_sales: (salesRes.data ?? []).length,
      closer_cash: (collRes.data ?? []).reduce(
        (s, c) => s + (Number((c as { gross_amount: number }).gross_amount) || 0),
        0
      ),
    }

    return NextResponse.json({ ok: true, date, userId: targetId, metrics })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
