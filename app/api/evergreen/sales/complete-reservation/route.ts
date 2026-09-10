import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import type { Sale } from '@/lib/types/database'

export const runtime = 'nodejs'

// Completa una RESERVA: promueve la venta (misma fila) al plan final y marca reservation_completed_at.
// Va por SERVICE ROLE porque `sales`/`sale_expected_installments` solo permiten UPDATE/INSERT a
// admin/director vía RLS. Un closer/setter que completaba el pago desde el cliente hacía un UPDATE
// que la RLS filtraba en silencio (0 filas, sin error): el cobro (server-side) sí quedaba, pero la
// venta seguía como reserva de 300 € (facturación mal, pipeline sin mover). Aquí se hace server-side.
export async function POST(req: NextRequest) {
  try {
    const { saleId, patch, installments } = await req.json()
    if (!saleId || !patch || typeof patch !== 'object') {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
    }

    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (urow?.roles as { key?: string } | null)?.key
    if (!['admin', 'director', 'manager', 'closer', 'setter', 'cobros'].includes(role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    const { data: prevData, error: prevErr } = await sb.from('sales').select('*').eq('id', saleId).single()
    if (prevErr || !prevData) return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 })
    const prev = prevData as Sale

    const payload = { ...patch, updated_by: user.id }
    const { error: updErr } = await sb.from('sales').update(payload).eq('id', saleId)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    // Regenera el calendario de cuotas (por si se recompleta): borra las previas e inserta las nuevas.
    await sb.from('sale_expected_installments').delete().eq('sale_id', saleId)
    if (Array.isArray(installments) && installments.length > 0) {
      const rows = installments.map((r: Record<string, unknown>) => ({ ...r, sale_id: saleId }))
      const { error: instErr } = await sb.from('sale_expected_installments').insert(rows)
      if (instErr) return NextResponse.json({ error: instErr.message }, { status: 500 })
    }

    await sb.from('audit_logs').insert({
      actor_user_id: user.id,
      entity_type: 'sale',
      entity_id: saleId,
      action: 'update',
      old_values: {
        gross_amount: prev.gross_amount,
        payment_plan_id: prev.payment_plan_id,
        payment_method: prev.payment_method,
        reservation_completed_at: prev.reservation_completed_at,
      },
      new_values: { ...payload, _accion: 'completar_reserva' },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
