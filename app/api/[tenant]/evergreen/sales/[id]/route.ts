import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'csm']

// Actualización parcial ligera de campos NO monetarios de una venta (fechas de onboarding/
// coaching/graduación desde Alumnos, estado desde Devoluciones). La tabla `sales` en RLS solo
// tiene políticas de SELECT e INSERT — NINGÚN rol, ni siquiera admin, puede hacer UPDATE directo
// desde el cliente: Supabase no devuelve error, actualiza 0 filas en silencio. Por eso
// `students/page.tsx` (marcar onboarding) y `refunds/page.tsx` (marcar venta como devuelta)
// nunca guardaban nada de verdad pese a no mostrar ningún error.
// Para ediciones que tocan importes/reps/comisiones, usa /api/${tenant}/evergreen/sales/update (admin/director).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (urow?.roles as { key?: string } | null)?.key || ''
    if (!ALLOWED_ROLES.includes(role)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const EDITABLE_FIELDS = ['onboarding_date', 'first_coaching_date', 'graduation_date', 'status'] as const
    const patch: Record<string, unknown> = {}
    for (const field of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, field)) patch[field] = body[field] === '' ? null : body[field]
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: updated, error } = await sb.from('sales').update(patch).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await sb.from('audit_logs').insert({
      actor_user_id: user.id,
      entity_type: 'sale',
      entity_id: id,
      action: 'update',
      new_values: patch,
    })

    return NextResponse.json({ ok: true, sale: updated })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
