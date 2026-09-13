import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { analyzeCall } from '@/lib/ai/claude'
import { tenantAiEnv } from '@/lib/ai/provider'

export const runtime = 'nodejs'
// 60s es un valor conservador, no un techo verificado: el límite efectivo depende del plan y de si
// Fluid Compute está activo, y no he podido comprobarlo con las herramientas disponibles. Da igual
// cuál sea: el bucle se autolimita por presupuesto de tiempo y reporta cuántas llamadas quedan, así
// que subir este número solo haría que cada pasada avance más, nunca que se corte a medias.
export const maxDuration = 60

// Analiza llamadas con transcripción pero sin análisis estructurado y guarda el resultado en
// appointments.ai_analysis/ai_summary/ai_call_score/ai_lead_score/ai_suggested_stage. Es el
// prerrequisito de las tools de Voice of Customer/Sales Intelligence del agente.
//
// Dos superficies con alcances DELIBERADAMENTE distintos:
//   GET  → proceso de plataforma (Vercel Cron / pg_cron). SOLO Bearer CRON_SECRET. Recorre todas
//          las subcuentas activas. Nunca acepta sesión: una sesión no debe poder mover datos de
//          otras subcuentas aunque su rol sea admin.
//   POST → disparo manual desde la UI. Sesión + requireTenant(slug de la URL). Ejecuta ÚNICAMENTE
//          la subcuenta de la URL y su respuesta no menciona ninguna otra.
const BATCH_SIZE = 15
// Margen sobre maxDuration para responder con el recuento en vez de que la función muera a medias.
const TIME_BUDGET_MS = 45_000

type TenantResult = { analyzed: number; errors: number; pendientes_restantes: number }

async function analyzeTenant(sb: SupabaseClient, tenantId: string, deadline: number): Promise<TenantResult> {
  // Una sola lectura de la configuración de IA por subcuenta: dentro del bucle sería una consulta por
  // llamada analizada.
  const aiEnv = await tenantAiEnv(tenantId)
  // Recuento total de pendientes, independiente del lote: con el presupuesto de tiempo casi nunca
  // se vacía la cola de una pasada, y omitirlo haría creer que ya está todo analizado.
  const { count: pendingTotal, error: countError } = await sb
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .not('transcript', 'is', null)
    .is('ai_analysis', null)
  if (countError) throw new Error(`No se pudo contar las llamadas pendientes: ${countError.message}`)

  const { data: pending, error: selectError } = await sb
    .from('appointments')
    .select('id,contact_id,transcript,contacts(full_name)')
    .eq('tenant_id', tenantId)
    .not('transcript', 'is', null)
    .is('ai_analysis', null)
    .order('appointment_datetime', { ascending: false })
    .limit(BATCH_SIZE)
  if (selectError) throw new Error(`No se pudieron leer las llamadas pendientes: ${selectError.message}`)

  let analyzed = 0
  let errors = 0
  for (const row of pending || []) {
    if (Date.now() > deadline) break
    const r = row as unknown as { id: string; transcript: string; contacts: { full_name: string } | null }
    try {
      const analysis = await analyzeCall(r.transcript, { leadName: r.contacts?.full_name }, aiEnv)
      // .select() para confirmar que la fila se actualizó de verdad: un UPDATE que no afecta a
      // ninguna fila no da error, y contarlo como analizado dejaría la cola "avanzando" sin que
      // nada cambie en la base.
      const { data: updated, error: updateError } = await sb
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
        .eq('tenant_id', tenantId)
        .select('id')
      if (updateError || !updated || updated.length === 0) errors++
      else analyzed++
    } catch {
      errors++
    }
  }
  return { analyzed, errors, pendientes_restantes: Math.max((pendingTotal ?? 0) - analyzed, 0) }
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

  // El presupuesto se reparte entre subcuentas: con un único deadline global la primera se lo
  // comía entero y las demás no se analizaban nunca.
  const targets = tenants || []
  const perTenantBudget = TIME_BUDGET_MS / Math.max(targets.length, 1)
  const perTenant: Record<string, TenantResult | { error: string }> = {}
  for (const t of targets) {
    try {
      perTenant[t.slug] = await analyzeTenant(sb, t.id, Date.now() + perTenantBudget)
    } catch (e) {
      // Un fallo en una subcuenta no debe abortar el barrido de las demás, pero sí constar.
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

  // Alcance: exclusivamente la subcuenta de la URL, ya validada por requireTenant. El tenant NUNCA
  // sale del body. La respuesta solo habla de esta subcuenta: ni slugs, ni contadores, ni errores
  // de las demás.
  try {
    const result = await analyzeTenant(serviceClient(), session.tenantId, Date.now() + TIME_BUDGET_MS)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error al analizar llamadas' }, { status: 500 })
  }
}
