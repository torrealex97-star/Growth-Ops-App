import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

function serviceClient() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Seguimiento (notas) del pipeline de pagos: historial append-only por venta, para anotar
// llamadas de cobro, promesas de pago, acuerdos... Cualquier rol de la plataforma puede leer y
// añadir notas (igual que el resto del CRM); no se editan ni se borran una vez creadas.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  try {
    const { tenant, id: saleId } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const sb = serviceClient()
    const { data: sale } = await sb
      .from('sales')
      .select('id')
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()
    if (!sale) return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 })

    const { data, error } = await sb
      .from('payment_follow_ups')
      .select('id, note, created_at, created_by, users(full_name)')
      .eq('sale_id', saleId)
      .eq('tenant_id', t.tenantId)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const notes = (data || []).map((r) => ({
      id: r.id,
      note: r.note,
      created_at: r.created_at,
      author: (r.users as { full_name?: string } | null)?.full_name || 'Alguien',
    }))
    return NextResponse.json({ notes })
  } catch (err) {
    console.error('[api/sales/id/follow-ups GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  try {
    const { tenant, id: saleId } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { note } = await req.json()
    if (typeof note !== 'string' || !note.trim()) {
      return NextResponse.json({ error: 'La nota no puede estar vacía' }, { status: 400 })
    }

    const sb = serviceClient()
    const { data: sale } = await sb
      .from('sales')
      .select('id')
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()
    if (!sale) return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 })

    // tenant_id es NOT NULL desde la conversión multi-tenant (20260911150000) pero no tiene
    // DEFAULT — sin este campo el insert fallaba siempre con una violación NOT NULL.
    const { data, error } = await sb
      .from('payment_follow_ups')
      .insert({ tenant_id: t.tenantId, sale_id: saleId, note: note.trim(), created_by: t.userId })
      .select('id, note, created_at')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, followUp: data })
  } catch (err) {
    console.error('[api/sales/id/follow-ups POST]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
