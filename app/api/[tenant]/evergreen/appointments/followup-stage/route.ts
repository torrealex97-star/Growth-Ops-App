import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const LEADERSHIP = ['admin', 'director', 'manager']

const FOLLOWUP_STAGES = [
  'pendiente_recontacto',
  'en_seguimiento_pago',
  'reagendado_pendiente',
  'cerrado',
  'descualificado',
] as const
type FollowupStage = (typeof FOLLOWUP_STAGES)[number]

// Actualiza la etapa del pipeline interno de seguimiento (independiente de `status` y del
// `pipeline_stage` de las integraciones externas — ver migration-v58). Mismo patrón de
// autorización que /appointments/follow-up.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { appointmentId, followupStage, reason } = await req.json()
    if (!appointmentId || typeof appointmentId !== 'string') {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 })
    }
    if (followupStage !== null && !FOLLOWUP_STAGES.includes(followupStage)) {
      return NextResponse.json({ error: 'Etapa de seguimiento no válida' }, { status: 400 })
    }
    const stage: FollowupStage | null = followupStage

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: urow } = await sb.from('users').select('data_scope, roles(key)').eq('id', t.userId).single()
    const role = (urow?.roles as { key?: string } | null)?.key || ''
    const scope = (urow as { data_scope?: string } | null)?.data_scope || 'own'
    if (!['admin', 'director', 'manager', 'closer', 'setter', 'cold_caller'].includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const { data: appt } = await sb
      .from('appointments')
      .select('id, setter_id, closer_id')
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)
      .single()
    if (!appt) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 })

    if (!LEADERSHIP.includes(role) && scope !== 'team' && appt.setter_id !== t.userId && appt.closer_id !== t.userId) {
      return NextResponse.json({ error: 'Solo puedes gestionar tus propias agendas' }, { status: 403 })
    }

    const update: Record<string, unknown> = { followup_stage: stage, last_contacted_at: new Date().toISOString() }
    // Motivo de descualificación (lead sin teléfono real, datos falsos, etc): se guarda en las
    // notas de la agenda, que ya son visibles en la columna "Notas" del pipeline de seguimiento.
    if (stage === 'descualificado' && typeof reason === 'string' && reason.trim()) {
      update.notes = reason.trim()
    }

    const { error } = await sb.from('appointments').update(update).eq('id', appointmentId).eq('tenant_id', t.tenantId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, notes: typeof update.notes === 'string' ? update.notes : undefined })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
