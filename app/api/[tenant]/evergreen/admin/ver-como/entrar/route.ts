import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { abrirTicket } from '@/lib/auth/ver-como'

export const runtime = 'nodejs'

// GET ?token_hash=&type=magiclink — terminal del enlace mágico de "Ver como".
// El action_link de Supabase redirige aquí con el OTP del OBJETIVO: canjearlo AQUÍ (verifyOtp con
// las cookies del navegador) es lo que CAMBIA la sesión de la pestaña — antes de esto las cookies
// siguen siendo las del super admin. Después: verifico que la sesión puesta es la del objetivo del
// ticket, audito el acceso y mando al panel.
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const ticket = abrirTicket(request.cookies.get('vc-ticket')?.value)
  if (!ticket.ok) {
    return NextResponse.redirect(
      new URL(`/${tenant}/login?error=ver_como_ticket_${ticket.motivo}`, request.nextUrl.origin)
    )
  }
  if (ticket.ticket.tenant !== tenant) {
    return NextResponse.redirect(new URL(`/${ticket.ticket.tenant}/dashboard`, request.nextUrl.origin))
  }

  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type')
  if (!tokenHash || type !== 'magiclink') {
    return NextResponse.redirect(new URL(`/${tenant}/login?error=ver_como_otp_ausente`, request.nextUrl.origin))
  }

  // Canje del OTP del objetivo CON LAS COOKIES del navegador (como hace /auth/callback): es este
  // paso el que sustituye la sesión del super admin por la del colaborador en esta pestaña.
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    }
  )
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
  if (error) {
    return NextResponse.redirect(new URL(`/${tenant}/login?error=ver_como_otp_invalido`, request.nextUrl.origin))
  }

  // ¿La sesión que queda puesta es la del objetivo del ticket? (protección: un ticket robado sin
  // el OTP no sirve, y un OTP de otro usuario no entra por este ticket)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user?.id !== ticket.ticket.objetivo.userId) {
    return NextResponse.redirect(new URL(`/${tenant}/login?error=ver_como_desajuste`, request.nextUrl.origin))
  }

  // AUDITORÍA. Queda registrado quién entró como quién, en qué subcuenta y cuándo. Sin esto,
  // "ver como" sería indistinguible de una sesión normal en los logs.
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    await sb.from('audit_logs').insert({
      actor_user_id: ticket.ticket.superAdmin.user_id,
      entity_type: 'ver_como',
      entity_id: ticket.ticket.objetivo.userId,
      action: 'entrar',
      new_values: {
        tenant,
        objetivo_email: ticket.ticket.objetivo.email,
        objetivo_nombre: ticket.ticket.objetivo.nombre,
        expira: new Date(ticket.ticket.exp).toISOString(),
      },
    })
  } catch {
    // La auditoría no debe impedir la sesión, pero su fallo queda en los logs del servidor.
    console.error('[ver-como/entrar] no se pudo registrar en audit_logs')
  }

  return NextResponse.redirect(new URL(`/${tenant}/dashboard`, request.nextUrl.origin))
}
