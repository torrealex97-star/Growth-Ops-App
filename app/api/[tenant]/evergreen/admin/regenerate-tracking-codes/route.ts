import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
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

      const cookieStore = await cookies()
      const authed = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return cookieStore.getAll()
            },
            setAll() {},
          },
        }
      )
      const {
        data: { user },
      } = await authed.auth.getUser()
      if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
      const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
      const role = (urow?.roles as { key?: string } | null)?.key
      if (!t.isSuperAdmin && !['admin', 'director'].includes(role || '')) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
      }
    } else {
      const { data: tenantRow } = await sb.from('tenants').select('id').eq('slug', tenant).maybeSingle()
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
    const mapping: { id: string; name: string | null; old: string | null; new: string }[] = []
    let updated = 0
    for (const u of users ?? []) {
      let code = generateTrackingCode()
      while (used.has(code)) code = generateTrackingCode()
      used.add(code)
      const { error: upErr } = await sb.from('users').update({ tracking_code: code }).eq('id', u.id)
      if (upErr) continue
      mapping.push({ id: u.id, name: u.full_name, old: u.tracking_code, new: code })
      updated++
    }

    return NextResponse.json({ ok: true, total: users?.length ?? 0, updated, mapping })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
