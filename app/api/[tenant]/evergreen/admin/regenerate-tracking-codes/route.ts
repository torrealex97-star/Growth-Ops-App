import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { generateTrackingCode } from '@/lib/tracking'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Regenera el tracking_code de los usuarios de ESTA subcuenta que ya tengan uno, sustituyéndolo
// por un código opaco y privado (no derivado del nombre). Los enlaces antiguos con el utm_term
// viejo dejan de atribuir: cada rep debe recopiar su enlace desde la sección Enlaces.
// Acceso: sesión admin/director de esta subcuenta (o super_admin) O cabecera
// Authorization: Bearer <CRON_SECRET> (en cuyo caso, dado que `users` no tiene tenant_id, se
// procesan solo los usuarios que son miembros de esta subcuenta vía tenant_members). Idempotente por uso.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = req.headers.get('authorization')
    const viaCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    let tenantId: string
    if (!viaCron) {
      const t = await requireTenant(tenant)
      if ('error' in t) return t.error
      tenantId = t.tenantId

      if (!t.isSuperAdmin && !['admin', 'director'].includes(t.role || '')) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
      }
    } else {
      // El camino sin sesión (CRON_SECRET) tampoco debe regenerar códigos de una subcuenta que ya
      // no está activa: sus sites quedan congelados tal como estaban.
      const { data: tenantRow } = await sb
        .from('tenants')
        .select('id')
        .eq('slug', tenant)
        .eq('status', 'active')
        .maybeSingle()
      if (!tenantRow) return NextResponse.json({ error: 'Subcuenta no encontrada' }, { status: 404 })
      tenantId = tenantRow.id
    }

    // `users` no tiene tenant_id (el rol de negocio es global por usuario) — resolvemos los
    // miembros de ESTA subcuenta vía tenant_members para no tocar usuarios de otras subcuentas.
    const { data: members, error: membersErr } = await sb
      .from('tenant_members')
      .select('user_id')
      .eq('tenant_id', tenantId)
    if (membersErr) return NextResponse.json({ error: membersErr.message }, { status: 500 })
    const memberIds = (members ?? []).map((m) => m.user_id)
    if (memberIds.length === 0) {
      return NextResponse.json({ ok: true, total: 0, updated: 0, mapping: [] })
    }

    const { data: users, error } = await sb
      .from('users')
      .select('id, full_name, tracking_code')
      .not('tracking_code', 'is', null)
      .in('id', memberIds)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const used = new Set<string>()
    const toUpdate: { id: string; name: string | null; old: string | null; new: string }[] = []
    for (const u of users ?? []) {
      let code = generateTrackingCode()
      while (used.has(code)) code = generateTrackingCode()
      used.add(code)
      toUpdate.push({ id: u.id, name: u.full_name, old: u.tracking_code, new: code })
    }

    // Un solo upsert por PK en vez de un UPDATE individual por usuario — es un endpoint
    // admin de uso ocasional, pero no cuesta nada batchearlo igual. Si falla, no hay
    // actualizaciones parciales que reportar como si hubieran ocurrido.
    let mapping: typeof toUpdate = []
    if (toUpdate.length) {
      const { error: upErr } = await sb
        .from('users')
        .upsert(toUpdate.map(({ id, new: code }) => ({ id, tracking_code: code })))
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
      mapping = toUpdate
    }

    return NextResponse.json({ ok: true, total: users?.length ?? 0, updated: mapping.length, mapping })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
