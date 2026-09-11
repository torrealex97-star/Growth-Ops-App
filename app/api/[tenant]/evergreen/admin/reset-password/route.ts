import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// El admin/director restablece la contraseña de un usuario del equipo.
// Devuelve una contraseña temporal para dársela a la persona (sin depender del email).
export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'Falta userId' }, { status: 400 })

    // 1) Autenticar al que llama por su sesión
    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    // 2) Comprobar rol admin/director
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: me } = await admin.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (me as { roles?: { key?: string } })?.roles?.key
    if (!role || !['admin', 'director'].includes(role)) {
      return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })
    }

    // 3) Generar contraseña temporal y aplicarla
    const tempPassword = `IAW-${globalThis.crypto.randomUUID().slice(0, 8)}!`
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
