import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getTenantConfigWithFallback } from '@/lib/config'
import { businessToday } from '@/lib/dates/business'

export const runtime = 'nodejs'
export const maxDuration = 60

// PRESUPUESTO DE TIEMPO: maxDuration=60 NO es presupuesto de trabajo (calendly-ghl murió con 504
// gastando 35+25=60 s exactos: antes del primer fetch ya se van cold start, middleware y la
// lectura de tenants). El run se autolimita a 45 s repartidos entre subcuentas; el paso caro
// (reintentos de cancelación en Calendly) es el que se corta, y un corte NO es un fallo: el
// reintento queda pendiente para la pasada siguiente. Lo que SÍ es un fallo y responde 500
// aunque el barrido haya terminado es una escritura o lectura que no se pudo aplicar:
// supabase-js no lanza, devuelve `{ error }`, y tragarlo aquí aprobaba comisiones y marcaba
// vencidas "con éxito" sin que nada cambiara en la base.

const TIME_BUDGET_MS = 45_000 // deja margen sobre maxDuration=60 para responder siempre

// supabase-js no lanza en fallo: devuelve `{ error }`. Un fallo tratado como "lista vacía" o
// "cero aprobadas" silencia el paso entero (mismo criterio que #231/#236: fail ruidoso).
function errorDe(fallback: string, err: { message: string } | null): Error {
  return new Error(err?.message ? `${fallback}: ${err.message}` : fallback)
}

type TenantResult = {
  markedOverdue: number
  approvedCommissions: number
  calendlyCleanedUp: number
  /** true si se agotó el presupuesto: los reintentos de Calendly restantes quedan para la pasada siguiente. */
  cortado?: boolean
}

// Corre los tres pasos del cron de recordatorios para UNA subcuenta (todas las
// lecturas/escrituras van filtradas por tenant_id). `deadline` acota el reintento de Calendly,
// el único paso con latencia externa.
async function runForTenant(sb: SupabaseClient, tenantId: string, deadline: number): Promise<TenantResult> {
  // Hoy EN HORA DEL NEGOCIO: con la fecha UTC, una cuota que vence hoy en España se marcaba
  // vencida (o no) según la hora a la que corriera el cron.
  const today = businessToday()
  const { data, error } = await sb
    .from('sale_expected_installments')
    .update({ status: 'overdue' })
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .lt('due_date', today)
    .select('id')
  if (error) throw errorDe('No se pudieron marcar las cuotas vencidas', error)

  // Aprobación AUTOMÁTICA de comisiones: pasada la ventana de devolución (refund_deadline_at) y
  // sin devolución marcada, las comisiones pendientes se aprueban solas. El equipo se encarga de
  // marcar las devoluciones; si no hay ninguna, se aprueba automáticamente.
  let approvedCommissions = 0
  const { data: eligibleSales, error: eligibleErr } = await sb
    .from('sales')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .lt('refund_deadline_at', today)
  if (eligibleErr) throw errorDe('No se pudieron leer las ventas fuera de ventana de devolución', eligibleErr)
  const eligibleIds = (eligibleSales ?? []).map((s: { id: string }) => s.id)
  if (eligibleIds.length) {
    const { data: approved, error: approvedErr } = await sb
      .from('commissions')
      .update({ status: 'approved' })
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .eq('direction', 'positive')
      .is('refund_id', null)
      .in('sale_id', eligibleIds)
      .select('id')
    if (approvedErr) throw errorDe('No se pudieron aprobar las comisiones fuera de ventana', approvedErr)
    approvedCommissions = approved?.length ?? 0
  }

  // Reintenta cancelar en Calendly los eventos antiguos que quedaron huérfanos tras una
  // reprogramación cuya cancelación falló (ver app/api/${tenant}/evergreen/appointments/reschedule).
  // Sin esto, un fallo transitorio de Calendly deja un duplicado permanente en Google Calendar.
  // Token de ESTA subcuenta: el cron recorre todas, y cada una tiene (o no) su propia cuenta de
  // Calendly. Con el token del entorno se reintentaba cancelar en la cuenta equivocada.
  const calendlyToken = (await getTenantConfigWithFallback(tenantId)).CALENDLY_API_TOKEN
  let calendlyCleanedUp = 0
  let cortado = false
  if (calendlyToken) {
    const { data: pending, error: pendingErr } = await sb
      .from('appointments')
      .select('id, calendly_cleanup_event_uuid')
      .eq('tenant_id', tenantId)
      .eq('calendly_cleanup_pending', true)
      .not('calendly_cleanup_event_uuid', 'is', null)
      .limit(50)
    if (pendingErr) throw errorDe('No se pudieron leer los reintentos de cancelación de Calendly', pendingErr)
    for (const appt of pending ?? []) {
      // Corte por presupuesto: los reintentos restantes siguen pendientes y la pasada siguiente
      // los recoge (la fila solo se limpia cuando la cancelación se confirma).
      if (Date.now() > deadline) {
        cortado = true
        break
      }
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
          const { error: flagErr } = await sb
            .from('appointments')
            .update({ calendly_cleanup_pending: false })
            .eq('id', appt.id)
            .eq('tenant_id', tenantId)
          // El flag NO se baja fire-and-forget: si no se guarda, el reintento se repetiría contra
          // Calendly para siempre (y la 2ª llamada ya es 404/409, así que nunca se enteraría de
          // que algo va mal). No se cuenta como resuelto: la pasada siguiente lo reintenta.
          if (flagErr) {
            console.error(
              `[cron/reminders] No se pudo cerrar el reintento de Calendly de la cita ${appt.id}:`,
              flagErr.message
            )
          } else {
            calendlyCleanedUp++
          }
        }
      } catch (e) {
        console.error(
          `[cron/reminders] Error reintentando cancelar evento Calendly ${appt.calendly_cleanup_event_uuid}:`,
          e
        )
      }
    }
  }

  return { markedOverdue: data?.length ?? 0, approvedCommissions, calendlyCleanedUp, ...(cortado ? { cortado } : {}) }
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
    if (tenantsErr) throw errorDe('No se pudieron leer las subcuentas activas', tenantsErr)

    // El presupuesto se reparte entre subcuentas: con un único deadline global la primera se lo
    // comería entero y las demás no corrían nunca (mismo reparto que analyze-calls).
    const targets = tenants || []
    const perTenantBudget = TIME_BUDGET_MS / Math.max(targets.length, 1)
    const perTenant: Record<string, TenantResult | { error: string }> = {}
    let huboFallos = false
    for (const tn of targets) {
      try {
        perTenant[tn.slug] = await runForTenant(sb, tn.id, Date.now() + perTenantBudget)
      } catch (e) {
        // Un fallo en una subcuenta no aborta el barrido de las demás, pero SI constar.
        huboFallos = true
        perTenant[tn.slug] = { error: e instanceof Error ? e.message : String(e) }
      }
    }

    // 500 aunque el barrido haya terminado: el run de Vercel Cron en rojo es el único aviso que
    // alguien va a ver, y repetir el cron es seguro (los tres pasos son idempotentes).
    if (huboFallos) return NextResponse.json({ ok: false, tenants: perTenant }, { status: 500 })
    return NextResponse.json({ ok: true, tenants: perTenant })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
