import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Borra una agenda DUPLICADA de la plataforma. Solo admin: es la única acción que hace que la
// agenda deje de contar en los KPIs (shows, no-shows, ratios), porque todas las métricas leen de
// la tabla appointments. Antes de borrar se guarda un snapshot en deleted_appointments_log.
//
// Salvaguardas:
//   · Se niega si la agenda tiene una VENTA enlazada (ahí no es un duplicado: hay dinero detrás).
//   · Desenlaza las agendas que la referencian como origen (origin_appointment_id) para no romper
//     la integridad referencial.
//   · NO toca Calendly: esto limpia el duplicado en la plataforma, no cancela la cita real.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { appointmentId, reason } = await req.json()
    if (!appointmentId) return NextResponse.json({ error: 'Falta appointmentId' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: urow } = await sb.from('users').select('roles(key)').eq('id', t.userId).single()
    const role = (urow?.roles as { key?: string } | null)?.key
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Solo un admin puede borrar agendas' }, { status: 403 })
    }

    const { data: appt } = await sb.from('appointments').select('*').eq('id', appointmentId).eq('tenant_id', t.tenantId).single()
    if (!appt) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 })

    // ¿Hay una venta colgando de esta agenda? Entonces no es un duplicado limpio.
    const { data: linkedSales } = await sb.from('sales').select('id, status').eq('appointment_id', appointmentId).eq('tenant_id', t.tenantId)
    if (linkedSales && linkedSales.length > 0) {
      return NextResponse.json({
        error: 'Esta agenda tiene una venta enlazada. Desenlaza o corrige la venta antes de borrarla.',
      }, { status: 409 })
    }

    // Guarda el snapshot ANTES de borrar, para poder recuperarla si el borrado fue un error.
    const { error: logErr } = await sb.from('deleted_appointments_log').insert({
      tenant_id: t.tenantId,
      appointment_id: appt.id,
      contact_id: appt.contact_id,
      snapshot: appt,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
      deleted_by: t.userId,
    })
    if (logErr) {
      return NextResponse.json({ error: `No se pudo registrar el borrado: ${logErr.message}` }, { status: 500 })
    }

    // Desenlaza las reagendas que apuntan a esta como origen.
    await sb.from('appointments').update({ origin_appointment_id: null }).eq('origin_appointment_id', appointmentId).eq('tenant_id', t.tenantId)

    const { error: delErr } = await sb.from('appointments').delete().eq('id', appointmentId).eq('tenant_id', t.tenantId)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
