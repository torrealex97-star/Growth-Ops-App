import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { abrirTicket, cookieNombre } from '@/lib/auth/ver-como'

export const runtime = 'nodejs'

function svc(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// POST — salir del "ver como": canjea el refresh token GUARDADO del super admin (el ticket) por una
// sesión nueva y la escribe en las cookies. Después borra el ticket. Si el ticket caducó (30 min),
// la sesión original ya no se puede restaurar por este camino: el super admin vuelve a entrar por
// el login normal (es el mismo caso que una sesión caducada cualquiera).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const ticket = abrirTicket(req.cookies.get(cookieNombre())?.value)
  if (!ticket.ok) {
    const res = NextResponse.json(
      { error: `El ticket ya no sirve (${ticket.motivo}); entra de nuevo con tu usuario.`, motivo: ticket.motivo },
      { status: 400 }
    )
    res.cookies.delete(cookieNombre())
    return res
  }
  const t = ticket.ticket
  if (t.tenant !== tenant) {
    return NextResponse.json({ error: 'El ticket no corresponde a esta subcuenta' }, { status: 400 })
  }

  // Canje del refresh token guardado. Estando dentro "como otro", las cookies actuales SON del
  // objetivo: por eso el canje se hace con un cliente limpio (sin cookies) y el resultado se
  // escribe explícitamente.
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await anon.auth.refreshSession({ refresh_token: t.superAdmin.refresh_token })
  if (error || !data.session) {
    const res = NextResponse.json(
      { error: 'No se pudo restaurar tu sesión (caducó). Entra de nuevo con tu usuario.', motivo: 'refresh_fallido' },
      { status: 400 }
    )
    res.cookies.delete(cookieNombre())
    return res
  }
  const s = data.session

  // AUDITORÍA de la salida (quién entró como quién ya está registrado; esto cierra el círculo).
  try {
    await svc().from('audit_logs').insert({
      actor_user_id: t.superAdmin.user_id,
      entity_type: 'ver_como',
      entity_id: t.objetivo.userId,
      action: 'salir',
      new_values: { tenant },
    })
  } catch {
    console.error('[ver-como/salir] no se pudo registrar en audit_logs')
  }

  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/^https:\/\//, '').split('.')[0]
  const payload = {
    access_token: s.access_token,
    token_type: 'bearer',
    expires_in: s.expires_in ?? 3600,
    expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    refresh_token: s.refresh_token,
    user: s.user,
  }
  const valor = `base64-${Buffer.from(JSON.stringify(payload)).toString('base64')}`
  const res = NextResponse.json({ ok: true })
  // Las dos cookies que @supabase/ssr mira: la de sesión y la del code verifier (se deja vacía).
  res.cookies.set(`sb-${ref}-auth-token`, valor, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
  res.cookies.delete(cookieNombre())
  return res
}
