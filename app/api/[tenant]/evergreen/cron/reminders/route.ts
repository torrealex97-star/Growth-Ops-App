import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'

// Corre los tres pasos del cron de recordatorios para UNA subcuenta (todas las
// lecturas/escrituras van filtradas por tenant_id).
async function runForTenant(sb: SupabaseClient, tenantId: string) {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await sb
    .from('sale_expected_installments')
    .update({ status: 'overdue' })
    .eq('tenant_id', tenantId)
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
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .lt('refund_deadline_at', today)
  const eligibleIds = (eligibleSales ?? []).map((s: { id: string }) => s.id)
  if (eligibleIds.length) {
    const { data: approved } = await sb
      .from('commissions')
      .update({ status: 'approved' })
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .eq('direction', 'positive')
      .is('refund_id', null)
      .in('sale_id', eligibleIds)
      .select('id')
    approvedCommissions = approved?.length ?? 0
  }

  // Reintenta cancelar en Calendly los eventos antiguos que quedaron huérfanos tras una
  // reprogramación cuya cancelación falló (ver app/api/${tenant}/evergreen/appointments/reschedule).
  // Sin esto, un fallo transitorio de Calendly deja un duplicado permanente en Google Calendar.
  // Token de ESTA subcuenta: el cron recorre todas, y cada una tiene (o no) su propia cuenta de
  // Calendly. Con el token del entorno se reintentaba cancelar en la cuenta equivocada.
  const calendlyToken = (await getTenantConfigWithFallback(tenantId)).CALENDLY_API_TOKEN
  let calendlyCleanedUp = 0
  if (calendlyToken) {
    const { data: pending } = await sb
      .from('appointments')
      .select('id, calendly_cleanup_event_uuid')
      .eq('tenant_id', tenantId)
      .eq('calendly_cleanup_pending', true)
      .not('calendly_cleanup_event_uuid', 'is', null)
      .limit(50)
    for (const appt of pending ?? []) {
      try {
        const r = await fetch(
          `https://api.calendly.com/scheduled_events/${appt.calendly_cleanup_event_uuid}/cancellation`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${calendlyToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Reprogramada desde la app (reintento automático)' }),
          }
        )
        // 404/409: el evento ya no existe o ya está cancelado — se da por resuelto igualmente.
        if (r.ok || r.status === 404 || r.status === 409) {
          await sb
            .from('appointments')
            .update({ calendly_cleanup_pending: false })
            .eq('id', appt.id)
            .eq('tenant_id', tenantId)
          calendlyCleanedUp++
        }
      } catch (e) {
        console.error(
          `[cron/reminders] Error reintentando cancelar evento Calendly ${appt.calendly_cleanup_event_uuid}:`,
          e
        )
      }
    }
  }

  return { markedOverdue: data?.length ?? 0, approvedCommissions, calendlyCleanedUp }
}

// Marca como vencidas (overdue) las cuotas pendientes cuya fecha ya pasó.
// La vista de Morosidad las muestra para gestión/aviso mensual.
// Vercel Cron pega a una única URL estática, así que este handler recorre TODAS las
// subcuentas activas y corre los tres pasos una vez por cada una.
// Auth: Bearer CRON_SECRET.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
    if (tenantsErr) throw new Error(tenantsErr.message)

    const perTenant: Record<string, { markedOverdue: number; approvedCommissions: number; calendlyCleanedUp: number }> =
      {}
    for (const tn of tenants || []) {
      perTenant[tn.slug] = await runForTenant(sb, tn.id)
    }

    return NextResponse.json({ ok: true, tenants: perTenant })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
