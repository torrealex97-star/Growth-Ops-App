import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { analyzeCall } from '@/lib/ai/claude'

export const runtime = 'nodejs'
// 60s es el techo real del plan Hobby de Vercel: declarar más no lo amplía, solo hace creer que
// cabe un lote que se cortaría a medias. El bucle de abajo se autolimita por tiempo para terminar
// dentro de la ventana y decir cuántas llamadas quedan pendientes.
export const maxDuration = 60

// Cron: analiza llamadas con transcripción pero SIN análisis estructurado todavía y guarda el
// resultado en appointments.ai_analysis/ai_summary/ai_call_score/ai_lead_score/ai_suggested_stage.
// Es el prerrequisito real de las tools de Sales Intelligence/Voice of Customer del agente de
// IA (getTopObjections, compareClosers): sin este análisis por llamada ya guardado, esas tools
// no tendrían nada que agregar. Reutiliza analyzeCall() (lib/ai/claude.ts), que ya existía y no
// se estaba llamando desde ningún sitio del pipeline — no es una función nueva.
// Techo duro de filas leídas por ejecución; el presupuesto de tiempo suele cortar antes.
const BATCH_SIZE = 15
// Deja margen sobre maxDuration para responder con el recuento en vez de que la función muera:
// una llamada a analyzeCall tarda varios segundos, así que se comprueba el reloj antes de cada una.
const TIME_BUDGET_MS = 45_000

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

  const startedAt = Date.now()
  const perTenant: Record<string, { analyzed: number; errors: number; pendientes_restantes: number }> = {}

  for (const t of tenants || []) {
    // Recuento total de pendientes (independiente del lote) para poder decir cuánto queda: con el
    // presupuesto de 45s casi nunca se vacía la cola de una sola pasada, y silenciarlo haría creer
    // que ya está todo analizado.
    const { count: pendingTotal } = await sb
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.id)
      .not('transcript', 'is', null)
      .is('ai_analysis', null)

    const { data: pending } = await sb
      .from('appointments')
      .select('id,contact_id,transcript,contacts(full_name)')
      .eq('tenant_id', t.id)
      .not('transcript', 'is', null)
      .is('ai_analysis', null)
      .order('appointment_datetime', { ascending: false })
      .limit(BATCH_SIZE)

    let analyzed = 0
    let errors = 0
    for (const row of pending || []) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break
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
    perTenant[t.slug] = { analyzed, errors, pendientes_restantes: Math.max((pendingTotal ?? 0) - analyzed, 0) }
  }

  const totalRemaining = Object.values(perTenant).reduce((sum, t) => sum + t.pendientes_restantes, 0)
  return NextResponse.json({ ok: true, tenants: perTenant, pendientes_restantes: totalRemaining })
}
