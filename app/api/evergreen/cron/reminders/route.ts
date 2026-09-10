import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Marca como vencidas (overdue) las cuotas pendientes cuya fecha ya pasó.
// La vista de Morosidad las muestra para gestión/aviso mensual.
// Auth: Bearer CRON_SECRET.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await sb
      .from('sale_expected_installments')
      .update({ status: 'overdue' })
      .eq('status', 'pending')
      .lt('due_date', today)
      .select('id')
    if (error) throw new Error(error.message)

    // Aprobación AUTOMÁTICA de comisiones: pasada la ventana de devolución (refund_deadline_at) y
    // sin devolución marcada, las comisiones pendientes se aprueban solas. El equipo se encarga de
    // marcar las devoluciones; si no hay ninguna, se aprueba automáticamente.
    let approvedCommissions = 0
    const { data: eligibleSales } = await sb
      .from('sales')
      .select('id')
      .eq('status', 'active')
      .lt('refund_deadline_at', today)
    const eligibleIds = (eligibleSales ?? []).map((s: { id: string }) => s.id)
    if (eligibleIds.length) {
      const { data: approved } = await sb
        .from('commissions')
        .update({ status: 'approved' })
        .eq('status', 'pending')
        .eq('direction', 'positive')
        .is('refund_id', null)
        .in('sale_id', eligibleIds)
        .select('id')
      approvedCommissions = approved?.length ?? 0
    }

    // Reintenta cancelar en Calendly los eventos antiguos que quedaron huérfanos tras una
    // reprogramación cuya cancelación falló (ver app/api/evergreen/appointments/reschedule).
    // Sin esto, un fallo transitorio de Calendly deja un duplicado permanente en Google Calendar.
    let calendlyCleanedUp = 0
    if (process.env.CALENDLY_API_TOKEN) {
      const { data: pending } = await sb
        .from('appointments')
        .select('id, calendly_cleanup_event_uuid')
        .eq('calendly_cleanup_pending', true)
        .not('calendly_cleanup_event_uuid', 'is', null)
        .limit(50)
      for (const appt of pending ?? []) {
        try {
          const r = await fetch(`https://api.calendly.com/scheduled_events/${appt.calendly_cleanup_event_uuid}/cancellation`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.CALENDLY_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Reprogramada desde la app (reintento automático)' }),
          })
          // 404/409: el evento ya no existe o ya está cancelado — se da por resuelto igualmente.
          if (r.ok || r.status === 404 || r.status === 409) {
            await sb.from('appointments').update({ calendly_cleanup_pending: false }).eq('id', appt.id)
            calendlyCleanedUp++
          }
        } catch (e) {
          console.error(`[cron/reminders] Error reintentando cancelar evento Calendly ${appt.calendly_cleanup_event_uuid}:`, e)
        }
      }
    }

    return NextResponse.json({ ok: true, markedOverdue: data?.length ?? 0, approvedCommissions, calendlyCleanedUp })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
