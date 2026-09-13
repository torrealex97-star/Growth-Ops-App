import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { detectAnomalies } from '@/lib/ai/insights/detectors'
import { formatCurrency } from '@/lib/utils'

export const runtime = 'nodejs'
export const maxDuration = 60

// Proactive Intelligence Engine (determinista, sin LLM): compara los últimos 7 días contra los
// 7 anteriores por tenant y escribe un insight SOLO cuando un umbral fijo se cruza de verdad
// (ver lib/ai/insights/detectors.ts). El resumen se redacta con datos exactos, no con un LLM —
// más fiable y sin coste añadido para algo que una plantilla ya explica bien. Dedup por
// fingerprint (tenant+tipo+semana): reintentos del cron en la misma semana no duplican el aviso.

type Authorized = { mode: 'cron' } | { mode: 'user'; tenantId: string }

// Mismo criterio que cron/analyze-calls: el secreto de cron recorre todas las subcuentas (proceso
// de plataforma), pero una sesión solo puede lanzarlo sobre la SUYA. El job usa service role, así
// que sin este alcance un director de una subcuenta escribía insights en las demás.
async function authorize(req: NextRequest, tenantSlug: string): Promise<Authorized | NextResponse> {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return { mode: 'cron' }

  const session = await requireTenant(tenantSlug)
  if ('error' in session) return session.error
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 })
  }
  return { mode: 'user', tenantId: session.tenantId }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const authorized = await authorize(req, tenant)
  if (authorized instanceof NextResponse) return authorized

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  let targets: Array<{ id: string; slug: string }>
  if (authorized.mode === 'cron') {
    const { data, error } = await sb.from('tenants').select('id, slug').eq('status', 'active')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    targets = data || []
  } else {
    const { data, error } = await sb.from('tenants').select('id, slug').eq('id', authorized.tenantId).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    targets = [data]
  }

  const perTenant: Record<string, { detected: number; inserted: number }> = {}

  for (const t of targets) {
    const anomalies = await detectAnomalies(t.id, sb)
    let inserted = 0
    for (const a of anomalies) {
      const isCurrency = a.metric === 'CAC'
      const fmt = (n: number) => (isCurrency ? formatCurrency(n) : `${n.toFixed(1)}%`)
      const summary = `${a.metric} pasó de ${fmt(a.previous)} a ${fmt(a.current)} (${a.pct_change > 0 ? '+' : ''}${a.pct_change.toFixed(1)}%) en los últimos 7 días respecto a los 7 anteriores.`
      const { error } = await sb.from('ai_insights').upsert(
        {
          tenant_id: t.id,
          type: a.type,
          severity: a.severity,
          title: a.title,
          summary,
          evidence: { metric: a.metric, current: a.current, previous: a.previous, pct_change: a.pct_change },
          fingerprint: a.fingerprint,
          status: 'new',
        },
        { onConflict: 'tenant_id,fingerprint', ignoreDuplicates: true }
      )
      if (!error) inserted++
    }
    perTenant[t.slug] = { detected: anomalies.length, inserted }
  }

  return NextResponse.json({ ok: true, tenants: perTenant })
}
