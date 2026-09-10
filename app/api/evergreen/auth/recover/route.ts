import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCompanyProfile } from '@/lib/contracts/company'
import { sendRecoveryEmail, resendConfigured } from '@/lib/email/resend'

export const runtime = 'nodejs'

// Recovery de contraseña robusto (público). Genera el enlace con token_hash
// (verifyOtp → funciona en cualquier dispositivo, sin PKCE) y lo envía con
// plantilla propia por Resend. Si Resend no está configurado, responde
// { fallback: true } para que la página use el método de Supabase.
// Nunca revela si el email existe (anti-enumeración) ni devuelve el enlace.
export async function POST(req: NextRequest) {
  try {
    const { email: rawEmail } = await req.json()
    const email = String(rawEmail || '').toLowerCase().trim()
    if (!email) return NextResponse.json({ error: 'Falta el email' }, { status: 400 })

    // Sin Resend no podemos enviar nosotros el correo → que la página use el flujo de Supabase.
    if (!resendConfigured()) {
      return NextResponse.json({ ok: true, fallback: true })
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://app.iawinners.com'
    const redirectTo = `${siteUrl}/api/evergreen/auth/callback?next=/evergreen/settings/password`

    // Si el usuario no existe, generateLink falla → no revelamos nada (ok igual).
    const { data, error } = await sb.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
    const hashedToken = error ? null : data.properties?.hashed_token
    if (!hashedToken) {
      // No existe el usuario (o error): respondemos ok sin filtrar. Sin fallback
      // (no queremos que Supabase mande nada a un email que quizá no es cuenta).
      return NextResponse.json({ ok: true, fallback: false })
    }

    const url = `${siteUrl}/api/evergreen/auth/callback?token_hash=${encodeURIComponent(hashedToken)}&type=recovery&next=/evergreen/settings/password`
    const company = await getCompanyProfile(sb)
    const sent = await sendRecoveryEmail({ to: email, company, url })
    // Si Resend falla (p.ej. dominio aún sin verificar), que la página use el
    // flujo estándar de Supabase para que el usuario reciba igualmente el correo.
    return NextResponse.json({ ok: true, fallback: !sent.ok })
  } catch {
    // Ante cualquier error, no filtramos detalles: la página caerá al fallback.
    return NextResponse.json({ ok: true, fallback: true })
  }
}
