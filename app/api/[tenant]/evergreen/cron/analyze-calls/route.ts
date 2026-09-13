import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { analyzeCall } from '@/lib/ai/claude'

export const runtime = 'nodejs'
// 60s es el techo real del plan Hobby de Vercel: declarar más no lo amplía, solo hace creer que
// cabe un lote que se cortaría a medias. El bucle de abajo se autolimita por tiempo para terminar
// dentro de la ventana y decir cuántas llamadas quedan pendientes.
export const maxDuration = 60

// Techo duro de filas leídas por tenant y ejecución; el presupuesto de tiempo suele cortar antes.
const BATCH_SIZE = 15
// Deja margen sobre maxDuration para responder con el recuento en vez de que la función muera:
// una llamada a analyzeCall tarda varios segundos, así que se comprueba el reloj antes de cada una.
const TIME_BUDGET_MS = 45_000

type Authorized = { mode: 'cron' } | { mode: 'user'; tenantId: string }

// Dos vías de entrada con alcances DISTINTOS a propósito:
//  - Bearer CRON_SECRET (Vercel Cron/pg_cron): proceso de plataforma, recorre todas las subcuentas.
//  - Sesión de admin/director: solo puede lanzarlo sobre SU propia subcuenta. Sin esto, un director
//    de la subcuenta B disparaba trabajo de IA (con coste real) sobre las transcripciones de A,
//    porque el job corre con service role y recorría todos los tenants.
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

async function analyzeTenant(
  sb: SupabaseClient,
  tenantId: string,
  deadline: number
): Promise<{ analyzed: number; errors: number; pendientes_restantes: number }> {
  // Recuento total de pendientes (independiente del lote) para poder decir cuánto queda: con el
  // presupuesto de tiempo casi nunca se vacía la cola de una sola pasada, y silenciarlo haría
  // creer que ya está todo analizado.
  const { count: pendingTotal } = await sb
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .not('transcript', 'is', null)
    .is('ai_analysis', null)

  const { data: pending } = await sb
    .from('appointments')
    .select('id,contact_id,transcript,contacts(full_name)')
    .eq('tenant_id', tenantId)
    .not('transcript', 'is', null)
    .is('ai_analysis', null)
    .order('appointment_datetime', { ascending: false })
    .limit(BATCH_SIZE)

  let analyzed = 0
  let errors = 0
  for (const row of pending || []) {
    if (Date.now() > deadline) break
    const r = row as unknown as { id: string; transcript: string; contacts: { full_name: string } | null }
    try {
      const analysis = await analyzeCall(r.transcript, { leadName: r.contacts?.full_name })
      await sb
        .from('appointments')
        .update({
          ai_analysis: analysis,
          ai_summary: analysis.summary,
          ai_call_score: analysis.call_score,
          ai_lead_score: analysis.lead_score,
          ai_suggested_stage: analysis.suggested_stage,
          ai_analyzed_at: new Date().toISOString(),
        })
        .eq('id', r.id)
      analyzed++
    } catch {
      errors++
    }
  }
  return { analyzed, errors, pendientes_restantes: Math.max((pendingTotal ?? 0) - analyzed, 0) }
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

  // El presupuesto se reparte entre las subcuentas a procesar. Con un único deadline global, la
  // primera subcuenta se lo comía entero y las demás no se analizaban NUNCA.
  const perTenantBudget = TIME_BUDGET_MS / Math.max(targets.length, 1)
  const perTenant: Record<string, { analyzed: number; errors: number; pendientes_restantes: number }> = {}
  for (const t of targets) {
    perTenant[t.slug] = await analyzeTenant(sb, t.id, Date.now() + perTenantBudget)
  }

  const totalRemaining = Object.values(perTenant).reduce((sum, t) => sum + t.pendientes_restantes, 0)
  return NextResponse.json({ ok: true, tenants: perTenant, pendientes_restantes: totalRemaining })
}
