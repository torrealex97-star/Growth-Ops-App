import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { EmailOtpType } from '@supabase/supabase-js'

export const runtime = 'nodejs'

// Establece la contraseña a partir de un token de invitación/recuperación.
// Hace verifyOtp + updateUser ENTERAMENTE en el servidor, en la misma request,
// sin depender de que la cookie de sesión sobreviva al navegador incrustado del
// móvil (apps de correo abren el enlace en un webview y al cambiar de navegador
// se perdía la sesión → el botón "Guardar" no hacía nada). El token solo se
// consume aquí, en el POST del formulario, no al abrir el enlace.
export async function POST(req: NextRequest) {
  try {
    const { token_hash: tokenHash, type, password } = await req.json()
    if (!tokenHash || !type) {
      return NextResponse.json({ error: 'Enlace no válido o incompleto.' }, { status: 400 })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, { status: 400 })
    }

    // Cliente anónimo aislado (sin persistir sesión): la sesión de verifyOtp queda
    // en memoria de esta instancia y la usa updateUser en la misma request.
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { error: otpErr } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType })
    if (otpErr) {
      return NextResponse.json({ error: 'El enlace ha caducado o ya se usó. Pide uno nuevo.' }, { status: 400 })
    }

    const { error: updErr } = await sb.auth.updateUser({ password })
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
