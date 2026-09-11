import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { resolveCloserEventType, getAvailableTimes, CalendlyError } from '@/lib/calendly'

export const runtime = 'nodejs'

// Verifica que quien llama está autenticado (cualquier usuario del panel).
async function requireAuth(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const cookieStore = await cookies()
  const authed = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await authed.auth.getUser()
  if (!user) return { ok: false, res: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  return { ok: true }
}

// GET /api/${tenant}/evergreen/calendly/availability?closerId=...&date=YYYY-MM-DD
// Devuelve el event type del closer y sus huecos disponibles ese día.
export async function GET(req: NextRequest) {
  try {
    const guard = await requireAuth()
    if (!guard.ok) return guard.res

    const closerId = req.nextUrl.searchParams.get('closerId')
    const date = req.nextUrl.searchParams.get('date') // YYYY-MM-DD
    if (!closerId) return NextResponse.json({ error: 'Falta closerId' }, { status: 400 })
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: closer } = await sb.from('users').select('email, calendly_email, full_name').eq('id', closerId).maybeSingle()
    if (!closer?.email) return NextResponse.json({ error: 'El closer no tiene email' }, { status: 400 })

    const et = await resolveCloserEventType(closer.calendly_email || closer.email)
    if (!et) {
      return NextResponse.json({ hasCalendly: false, reason: 'Este closer no tiene un event type en la cuenta madre de Calendly' })
    }

    // Ventana del día seleccionado. Calendly exige start_time futuro y rango ≤ 7 días.
    const now = new Date()
    const dayStart = new Date(`${date}T00:00:00.000Z`)
    const dayEnd = new Date(`${date}T23:59:59.000Z`)
    // start debe ser estrictamente futuro (+1 min de margen)
    const startDate = dayStart.getTime() > now.getTime() + 60000 ? dayStart : new Date(now.getTime() + 60000)
    if (startDate.getTime() >= dayEnd.getTime()) {
      return NextResponse.json({ hasCalendly: true, eventType: { uri: et.uri, name: et.name, duration: et.duration, scheduling_url: et.scheduling_url }, slots: [] })
    }

    const slots = await getAvailableTimes(et.uri, startDate.toISOString(), dayEnd.toISOString())
    return NextResponse.json({
      hasCalendly: true,
      eventType: { uri: et.uri, name: et.name, duration: et.duration, scheduling_url: et.scheduling_url },
      slots,
    })
  } catch (err) {
    if (err instanceof CalendlyError) {
      return NextResponse.json({ error: 'Calendly: ' + err.message, status: err.status, detail: err.body }, { status: 502 })
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
