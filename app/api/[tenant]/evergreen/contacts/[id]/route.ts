import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Actualiza un contacto con service-role. La tabla contacts tiene RLS con solo política de
// SELECT (ver app/api/${tenant}/evergreen/contacts/create/route.ts), así que el UPDATE desde el cliente
// lo bloquea RLS para roles no-admin: Supabase no devuelve error, simplemente actualiza 0 filas,
// y la app mostraba "Contacto actualizado" aunque nada se hubiera guardado de verdad.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  try {
    const { tenant, id } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const body = await req.json()
    const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const role = t.role
    if (!role) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const clean = (v: unknown) => {
      const s = typeof v === 'string' ? v.trim() : v
      return s === '' || s === undefined ? null : s
    }

    // Actualización PARCIAL: solo se tocan los campos que vienen en el body. Así un cambio
    // puntual (p.ej. lead_status desde el tablero de Leads) no pisa a null el resto de campos
    // del contacto (nombre, email...) que no se enviaron en esta llamada.
    const EDITABLE_FIELDS = [
      'first_name',
      'last_name',
      'email',
      'phone',
      'country',
      'company_name',
      'instagram',
      'notes',
      'lead_status',
      'lead_channel',
    ] as const
    const patch: Record<string, unknown> = {}
    for (const field of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, field)) patch[field] = clean(body[field])
    }
    if ('first_name' in patch || 'last_name' in patch) {
      const { data: current } = await sb
        .from('contacts')
        .select('first_name, last_name')
        .eq('id', id)
        .eq('tenant_id', t.tenantId)
        .single()
      const firstName = ('first_name' in patch ? patch.first_name : current?.first_name) as string | null
      const lastName = ('last_name' in patch ? patch.last_name : current?.last_name) as string | null
      patch.full_name = [firstName, lastName].filter(Boolean).join(' ') || null
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
    }

    let updateQuery = sb
      .from('contacts')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', t.tenantId)
    if (expectedUpdatedAt) updateQuery = updateQuery.eq('updated_at', expectedUpdatedAt)
    const { data: updated, error } = await updateQuery.select().maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!updated) {
      return NextResponse.json(
        { error: 'El contacto cambió mientras editabas. Recarga la ficha antes de deshacer.' },
        { status: 409 }
      )
    }

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'contact',
      entity_id: id,
      action: 'update',
      new_values: patch,
    })

    return NextResponse.json({ ok: true, contact: updated })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
