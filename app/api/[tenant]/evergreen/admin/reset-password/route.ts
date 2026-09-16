import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

// El admin/director restablece la contraseña de un usuario del equipo.
// Devuelve una contraseña temporal para dársela a la persona (sin depender del email).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'Falta userId' }, { status: 400 })

    // 1) Autenticar al que llama y comprobar que administra ESTA subcuenta
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    // 2) Comprobar rol admin/director
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const role = t.role
    if (!t.isSuperAdmin && (!role || !['admin', 'director'].includes(role))) {
      return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })
    }

    // 3) SEGURIDAD: `users` no tiene tenant_id (el rol de negocio es global), así que sin esta
    // comprobación un admin de ESTA subcuenta podría resetear la contraseña de CUALQUIER usuario
    // de la plataforma (de otra subcuenta) con solo conocer su userId. Verificamos que el
    // objetivo sea miembro de esta subcuenta (o que el que llama sea super_admin).
    if (!t.isSuperAdmin) {
      const { data: targetMembership } = await admin
        .from('tenant_members')
        .select('id')
        .eq('tenant_id', t.tenantId)
        .eq('user_id', userId)
        .maybeSingle()
      if (!targetMembership) {
        return NextResponse.json({ error: 'El usuario no pertenece a esta subcuenta' }, { status: 403 })
      }
    }

    // 4) Generar contraseña temporal y aplicarla
    const tempPassword = `GOP-${globalThis.crypto.randomUUID().slice(0, 8)}!`
    const { data: target, error } = await admin.auth.admin.updateUserById(userId, {
      password: tempPassword,
      email_confirm: true,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, email: target.user?.email, tempPassword })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
