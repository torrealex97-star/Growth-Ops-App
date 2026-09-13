import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { detectAnomalies } from '@/lib/ai/insights/detectors'
import { formatCurrency } from '@/lib/utils'

export const runtime = 'nodejs'
export const maxDuration = 60

// Proactive Intelligence Engine (determinista, sin LLM): compara los últimos 7 días contra los 7
// anteriores y escribe un insight SOLO cuando un umbral fijo se cruza de verdad. El resumen se
// redacta con datos exactos, no con un LLM. Dedup por fingerprint (tenant+tipo+semana).
//
// Igual que cron/analyze-calls:
//   GET  → solo Bearer CRON_SECRET, recorre todas las subcuentas activas.
//   POST → sesión admin/director + requireTenant, ejecuta SOLO la subcuenta de la URL y no revela
//          nada de las demás.

type TenantResult = { detected: number; inserted: number; duplicados_ignorados: number }

async function detectForTenant(sb: SupabaseClient, tenantId: string): Promise<TenantResult> {
  const anomalies = await detectAnomalies(tenantId, sb)
  let inserted = 0
  let ignored = 0
  for (const a of anomalies) {
    const isCurrency = a.metric === 'CAC'
    const fmt = (n: number) => (isCurrency ? formatCurrency(n) : `${n.toFixed(1)}%`)
    const summary = `${a.metric} pasó de ${fmt(a.previous)} a ${fmt(a.current)} (${a.pct_change > 0 ? '+' : ''}${a.pct_change.toFixed(1)}%) en los últimos 7 días respecto a los 7 anteriores.`
    // Con ignoreDuplicates, un fingerprint ya existente NO devuelve fila. Sin pedir las filas
    // insertadas, cada pasada contaba como "inserted" avisos que ya estaban y no se han creado.
    const { data, error } = await sb
      .from('ai_insights')
      .upsert(
        {
          tenant_id: tenantId,
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
      .select('id')
    if (error) throw new Error(`No se pudo guardar el insight "${a.type}": ${error.message}`)
    if (data && data.length > 0) inserted++
    else ignored++
  }
  return { detected: anomalies.length, inserted, duplicados_ignorados: ignored }
}

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const sb = serviceClient()
  const { data: tenants, error } = await sb.from('tenants').select('id, slug').eq('status', 'active')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const perTenant: Record<string, TenantResult | { error: string }> = {}
  for (const t of tenants || []) {
    try {
      perTenant[t.slug] = await detectForTenant(sb, t.id)
    } catch (e) {
      perTenant[t.slug] = { error: e instanceof Error ? e.message : String(e) }
    }
  }
  return NextResponse.json({ ok: true, tenants: perTenant })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 })
  }

  try {
    const result = await detectForTenant(serviceClient(), session.tenantId)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error al detectar anomalías' }, { status: 500 })
  }
}
