import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { analyzeCall } from '@/lib/ai/claude'

export const runtime = 'nodejs'
export const maxDuration = 120

// Cron: analiza llamadas con transcripción pero SIN análisis estructurado todavía y guarda el
// resultado en appointments.ai_analysis/ai_summary/ai_call_score/ai_lead_score/ai_suggested_stage.
// Es el prerrequisito real de las tools de Sales Intelligence/Voice of Customer del agente de
// IA (getTopObjections, compareClosers): sin este análisis por llamada ya guardado, esas tools
// no tendrían nada que agregar. Reutiliza analyzeCall() (lib/ai/claude.ts), que ya existía y no
// se estaba llamando desde ningún sitio del pipeline — no es una función nueva.
const BATCH_SIZE = 15 // limita coste/latencia por ejecución del cron, no todo el histórico de golpe

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
  if (tenantsErr) return NextResponse.json({ error: tenantsErr.message }, { status: 500 })

  const perTenant: Record<string, { analyzed: number; errors: number }> = {}

  for (const t of tenants || []) {
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
    perTenant[t.slug] = { analyzed, errors }
  }

  return NextResponse.json({ ok: true, tenants: perTenant })
}
