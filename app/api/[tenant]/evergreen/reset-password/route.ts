import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

// Reset de contraseña por admin: genera una contraseña temporal al instante
// (sin depender del email de Supabase). SOLO admin/director pueden llamarlo.

function genTempPassword(): string {
  // 3 grupos de 6 chars alfanuméricos legibles → p.ej. "k7f2ab-9qm4xz-3rt8wp"
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(18)
  let out = ''
  for (let i = 0; i < 18; i++) {
    if (i > 0 && i % 6 === 0) out += '-'
    out += alphabet[bytes[i] % alphabet.length]
  }
  return out
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json()
    if (!userId) {
      return NextResponse.json({ error: 'Falta userId' }, { status: 400 })
    }

    // 1) Verificar que quien llama está autenticado y es admin/director
    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll() { /* no-op: solo lectura */ },
        },
      }
    )
    const { data: { user: caller } } = await authed.auth.getUser()
    if (!caller) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }
    const { data: callerRow } = await authed
      .from('users')
      .select('roles(key)')
      .eq('id', caller.id)
      .single()
    const callerRole = (callerRow?.roles as { key?: string } | null)?.key
    if (callerRole !== 'admin' && callerRole !== 'director') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    // 2) Con service role: fijar la contraseña temporal
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const tempPassword = genTempPassword()
    const { error } = await admin.auth.admin.updateUserById(userId, { password: tempPassword })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true, tempPassword })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
