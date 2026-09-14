import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCloserEventType, getAvailableTimes, requireCalendlyToken, CalendlyError } from '@/lib/calendly'
import { getTenantConfigWithFallback } from '@/lib/config'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// GET /api/${tenant}/evergreen/calendly/availability?closerId=...&date=YYYY-MM-DD
// Devuelve el event type del closer y sus huecos disponibles ese día.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const closerId = req.nextUrl.searchParams.get('closerId')
    const date = req.nextUrl.searchParams.get('date') // YYYY-MM-DD
    if (!closerId) return NextResponse.json({ error: 'Falta closerId' }, { status: 400 })
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    // `users` no tiene tenant_id: comprobamos que el closer pertenece a esta
    // subcuenta vía tenant_members para no filtrar disponibilidad entre tenants.
    const { data: membership } = await sb
      .from('tenant_members')
      .select('id')
      .eq('tenant_id', t.tenantId)
      .eq('user_id', closerId)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Closer no encontrado' }, { status: 404 })
    const { data: closer } = await sb
      .from('users')
      .select('email, calendly_email, full_name')
      .eq('id', closerId)
      .maybeSingle()
    if (!closer?.email) return NextResponse.json({ error: 'El closer no tiene email' }, { status: 400 })

    // Token de Calendly de ESTA subcuenta (Configuración › Integraciones). Antes lib/calendly.ts lo
    // leía de process.env, así que el token guardado en el panel no se usaba nunca.
    const calendlyToken = requireCalendlyToken((await getTenantConfigWithFallback(t.tenantId)).CALENDLY_API_TOKEN)
    const et = await resolveCloserEventType(calendlyToken, closer.calendly_email || closer.email)
    if (!et) {
      return NextResponse.json({
        hasCalendly: false,
        reason: 'Este closer no tiene un event type en la cuenta madre de Calendly',
      })
    }

    // Ventana del día seleccionado. Calendly exige start_time futuro y rango ≤ 7 días.
    const now = new Date()
    const dayStart = new Date(`${date}T00:00:00.000Z`)
    const dayEnd = new Date(`${date}T23:59:59.000Z`)
    // start debe ser estrictamente futuro (+1 min de margen)
    const startDate = dayStart.getTime() > now.getTime() + 60000 ? dayStart : new Date(now.getTime() + 60000)
    if (startDate.getTime() >= dayEnd.getTime()) {
      return NextResponse.json({
        hasCalendly: true,
        eventType: { uri: et.uri, name: et.name, duration: et.duration, scheduling_url: et.scheduling_url },
        slots: [],
      })
    }

    const slots = await getAvailableTimes(calendlyToken, et.uri, startDate.toISOString(), dayEnd.toISOString())
    return NextResponse.json({
      hasCalendly: true,
      eventType: { uri: et.uri, name: et.name, duration: et.duration, scheduling_url: et.scheduling_url },
      slots,
    })
  } catch (err) {
    if (err instanceof CalendlyError) {
      return NextResponse.json(
        { error: 'Calendly: ' + err.message, status: err.status, detail: err.body },
        { status: 502 }
      )
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
