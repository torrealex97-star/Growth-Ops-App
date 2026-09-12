import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { detectAnomalies } from '@/lib/ai/insights/detectors'
import { formatCurrency } from '@/lib/utils'

export const runtime = 'nodejs'
export const maxDuration = 60

// Proactive Intelligence Engine (determinista, sin LLM): compara los últimos 7 días contra los
// 7 anteriores por tenant y escribe un insight SOLO cuando un umbral fijo se cruza de verdad
// (ver lib/ai/insights/detectors.ts). El resumen se redacta con datos exactos, no con un LLM —
// más fiable y sin coste añadido para algo que una plantilla ya explica bien. Dedup por
// fingerprint (tenant+tipo+semana): reintentos del cron en la misma semana no duplican el aviso.

// Auth: header Bearer CRON_SECRET (Vercel Cron/pg_cron) o sesión de admin/director (botón manual)
// — mismo patrón que cron/monthly y cron/sequra-morosos. Sin esto no había NINGUNA forma de
// disparar este cron en producción (no está en vercel.json ni hay pg_cron configurado).
async function isAuthorized(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true
  try {
    const cookieStore = await cookies()
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {},
      },
    })
    const {
      data: { user },
    } = await sb.auth.getUser()
    if (!user) return false
    const { data } = await sb.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (data?.roles as { key?: string } | null)?.key
    return role === 'admin' || role === 'director'
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
  if (tenantsErr) return NextResponse.json({ error: tenantsErr.message }, { status: 500 })

  const perTenant: Record<string, { detected: number; inserted: number }> = {}

  for (const t of tenants || []) {
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
