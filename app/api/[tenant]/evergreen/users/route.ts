import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Verifica que quien llama está autenticado y es admin/director de ESTA subcuenta (o super_admin).
// Devuelve el caller o una respuesta de error ya lista para retornar.
async function requireAdmin(
  tenantSlug: string,
  sb: SupabaseClient
): Promise<{ ok: true; callerId: string; tenantId: string; isSuperAdmin: boolean } | { ok: false; res: NextResponse }> {
  const t = await requireTenant(tenantSlug)
  if ('error' in t) return { ok: false, res: t.error }
  const callerRole = t.role
  if (!t.isSuperAdmin && callerRole !== 'admin' && callerRole !== 'director') {
    return { ok: false, res: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return { ok: true, callerId: t.userId, tenantId: t.tenantId, isSuperAdmin: t.isSuperAdmin }
}

// SEGURIDAD: `users` no tiene tenant_id (el rol de negocio es global), así que sin esta
// comprobación un admin de ESTA subcuenta podría editar/eliminar CUALQUIER usuario de la
// plataforma (de otra subcuenta) con solo conocer su userId. Verifica que el usuario objetivo
// sea miembro de esta subcuenta (los super_admin, con acceso a todas, se saltan la comprobación).
async function requireTargetInTenant(
  sb: SupabaseClient,
  tenantId: string,
  isSuperAdmin: boolean,
  userId: string
): Promise<NextResponse | null> {
  if (isSuperAdmin) return null
  const { data: membership } = await sb
    .from('tenant_members')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json({ error: 'El usuario no pertenece a esta subcuenta' }, { status: 403 })
  }
  return null
}

// PATCH — editar los correos de un usuario.
//   · companyEmail: es el correo de LOGIN. Se actualiza en Supabase Auth
//     (auth.users) y en public.users.email. Rompe la atribución de agendas de
//     Calendly/GHL (casan por este email) → el aviso se muestra en la UI.
//   · personalEmail: correo PERSONAL, solo para el contrato. Solo toca
//     public.users.personal_email (cadena vacía → se limpia).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const sb = serviceClient()
    const guard = await requireAdmin(tenant, sb)
    if (!guard.ok) return guard.res

    const body = (await req.json()) as {
      userId?: string
      companyEmail?: string
      personalEmail?: string | null
    }
    const userId = body.userId
    if (!userId) return NextResponse.json({ error: 'Falta userId' }, { status: 400 })

    const targetErr = await requireTargetInTenant(sb, guard.tenantId, guard.isSuperAdmin, userId)
    if (targetErr) return targetErr

    const updates: Record<string, string | null> = {}
    let authEmailChanged = false

    // Correo de empresa (login)
    if (typeof body.companyEmail === 'string') {
      const companyEmail = body.companyEmail.toLowerCase().trim()
      if (!companyEmail || !EMAIL_RE.test(companyEmail)) {
        return NextResponse.json({ error: 'El correo de empresa no es válido' }, { status: 400 })
      }
      const { data: current } = await sb.from('users').select('email').eq('id', userId).maybeSingle()
      if (current && current.email?.toLowerCase() !== companyEmail) {
        const { error: authErr } = await sb.auth.admin.updateUserById(userId, {
          email: companyEmail,
          email_confirm: true,
        })
        if (authErr)
          return NextResponse.json(
            { error: `No se pudo cambiar el correo de login: ${authErr.message}` },
            { status: 400 }
          )
        updates.email = companyEmail
        authEmailChanged = true
      }
    }

    // Correo personal (solo contrato). null / '' → limpiar.
    if ('personalEmail' in body) {
      const raw = body.personalEmail
      if (raw === null || raw === undefined || String(raw).trim() === '') {
        updates.personal_email = null
      } else {
        const personalEmail = String(raw).toLowerCase().trim()
        if (!EMAIL_RE.test(personalEmail)) {
          return NextResponse.json({ error: 'El correo personal no es válido' }, { status: 400 })
        }
        updates.personal_email = personalEmail
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await sb.from('users').update(updates).eq('id', userId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, authEmailChanged })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// Cuenta filas (head + count exact) de una tabla filtrando por una o varias
// columnas que referencien al usuario, dentro de ESTA subcuenta. Devuelve 0 si
// la tabla/columna no existe.
async function countRefs(
  sb: SupabaseClient,
  table: string,
  filter: string,
  userId: string,
  tenantId: string
): Promise<number> {
  const q = sb.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
  const res = filter.includes(',') ? await q.or(filter) : await q.eq(filter, userId)
  return res.error ? 0 : (res.count ?? 0)
}

// DELETE — borrado SEGURO. Si el usuario tiene actividad (ventas, agendas,
// comisiones, contratos) se bloquea y se avisa: hay que desactivarlo/reasignar
// antes. Nunca destruye registros financieros. Si no tiene referencias, se
// elimina de Auth (y por ON DELETE CASCADE se limpia public.users).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const sb = serviceClient()
    const guard = await requireAdmin(tenant, sb)
    if (!guard.ok) return guard.res

    const userId = new URL(req.url).searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'Falta userId' }, { status: 400 })
    if (userId === guard.callerId) {
      return NextResponse.json({ error: 'No puedes eliminar tu propia cuenta' }, { status: 400 })
    }

    const targetErr = await requireTargetInTenant(sb, guard.tenantId, guard.isSuperAdmin, userId)
    if (targetErr) return targetErr

    const [sales, appts, commissions, contracts] = await Promise.all([
      countRefs(
        sb,
        'sales',
        `setter_id.eq.${userId},closer_id.eq.${userId},affiliate_id.eq.${userId},created_by.eq.${userId}`,
        userId,
        guard.tenantId
      ),
      countRefs(
        sb,
        'appointments',
        `setter_id.eq.${userId},closer_id.eq.${userId},triager_id.eq.${userId},cold_caller_id.eq.${userId},affiliate_id.eq.${userId}`,
        userId,
        guard.tenantId
      ),
      countRefs(sb, 'commissions', 'user_id', userId, guard.tenantId),
      countRefs(sb, 'contracts', `user_id.eq.${userId},created_by.eq.${userId}`, userId, guard.tenantId),
    ])

    const blockers: string[] = []
    if (sales) blockers.push(`${sales} venta${sales === 1 ? '' : 's'}`)
    if (appts) blockers.push(`${appts} agenda${appts === 1 ? '' : 's'}`)
    if (commissions) blockers.push(`${commissions} comisión${commissions === 1 ? '' : 'es'}`)
    if (contracts) blockers.push(`${contracts} contrato${contracts === 1 ? '' : 's'}`)

    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: `No se puede eliminar: el usuario tiene ${blockers.join(', ')} asociada(s). Desactívalo (Estado → Inactivo) o reasigna esos registros primero.`,
          blockers,
        },
        { status: 409 }
      )
    }

    const { data: victim } = await sb.from('users').select('email, full_name').eq('id', userId).maybeSingle()

    const { error } = await sb.auth.admin.deleteUser(userId)
    if (error) {
      return NextResponse.json(
        {
          error: `No se pudo eliminar: ${error.message}. Si tiene datos asociados, desactívalo en su lugar.`,
        },
        { status: 400 }
      )
    }

    await sb.from('audit_logs').insert({
      tenant_id: guard.tenantId,
      entity_type: 'user',
      entity_id: userId,
      action: 'delete',
      actor_user_id: guard.callerId,
      old_values: victim ?? null,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
