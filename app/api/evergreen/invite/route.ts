import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { generateUniqueTrackingCode } from '@/lib/tracking'
import { getCompanyProfile } from '@/lib/contracts/company'
import { sendInviteEmail, resendConfigured } from '@/lib/email/resend'

export const runtime = 'nodejs'

// Roles que necesitan un tracking_code para generar enlaces con UTM
const TRACKING_ROLES = ['setter', 'closer', 'cold_caller', 'affiliate']

// Invitación de un nuevo miembro. En vez del email genérico de "invitación" de
// Supabase (que no llevaba bien a crear contraseña), generamos NOSOTROS el enlace
// de crear-contraseña con token_hash (flujo verifyOtp, funciona en cualquier
// dispositivo, sin PKCE) y lo enviamos con nuestra plantilla por Resend.
// Siempre devolvemos el enlace para poder compartirlo a mano como respaldo.
// Extrae el email si viene pegado como "Nombre <email@dominio.com>" (autocompletado
// del navegador/gestor de contraseñas); si no, devuelve el string recortado tal cual.
const extractEmail = (raw: string): string => {
  const angle = raw.match(/<([^>]+)>/)
  return (angle ? angle[1] : raw).trim().toLowerCase()
}

export async function POST(req: NextRequest) {
  try {
    const { email: rawEmail, roleId, fullName, deptOverrides, pageOverrides, personalEmail: rawPersonalEmail } = await req.json()
    if (!rawEmail || !roleId) {
      return NextResponse.json({ error: 'Email y rol son requeridos' }, { status: 400 })
    }
    const email = extractEmail(String(rawEmail))
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: `El correo de empresa "${email}" no es válido` }, { status: 400 })
    }
    const personalEmail = rawPersonalEmail ? extractEmail(String(rawPersonalEmail)) : null
    if (personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
      return NextResponse.json({ error: `El correo personal "${personalEmail}" no es válido` }, { status: 400 })
    }

    // Verificar que quien llama está autenticado y es admin/director. Sin esto,
    // cualquier usuario con sesión podría auto-invitarse con role_id de admin.
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

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://app.iawinners.com'
    const redirectTo = `${siteUrl}/api/evergreen/auth/callback?next=/evergreen/settings/password`

    // 1) Enlace de acceso. Para un usuario nuevo → 'invite' (crea el usuario);
    //    si ya existe → 'recovery' (crear/restablecer contraseña).
    let linkType: 'invite' | 'recovery' = 'invite'
    let gen = await supabase.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { data: { role_id: roleId, full_name: fullName || email }, redirectTo },
    })
    if (gen.error && /already|registered|exist/i.test(gen.error.message)) {
      linkType = 'recovery'
      gen = await supabase.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
    }
    if (gen.error) {
      console.error(`[invite] generateLink(${linkType}) falló para ${email}: ${gen.error.message}`)
      return NextResponse.json({ error: gen.error.message }, { status: 400 })
    }

    const hashedToken = gen.data.properties?.hashed_token
    if (!hashedToken) {
      return NextResponse.json({ error: 'No se pudo generar el enlace de acceso' }, { status: 500 })
    }
    // Enlace directo a NUESTRO callback con token_hash → verifyOtp → set-password.
    const inviteUrl =
      `${siteUrl}/api/evergreen/auth/callback` +
      `?token_hash=${encodeURIComponent(hashedToken)}&type=${linkType}&next=/evergreen/settings/password`

    // 2) Perfil en la tabla users (idempotente).
    const userId = gen.data.user?.id
    if (userId) {
      const { data: role } = await supabase.from('roles').select('key').eq('id', roleId).maybeSingle()
      const roleKey = (role as { key?: string } | null)?.key
      let trackingCode: string | null = null
      if (roleKey && TRACKING_ROLES.includes(roleKey)) {
        trackingCode = await generateUniqueTrackingCode(supabase)
      }
      await supabase.from('users').upsert({
        id: userId,
        email,
        ...(personalEmail ? { personal_email: personalEmail } : {}),
        full_name: fullName || email,
        role_id: roleId,
        is_active: true,
        dept_overrides: Array.isArray(deptOverrides) && deptOverrides.length ? deptOverrides : null,
        page_overrides: Array.isArray(pageOverrides) && pageOverrides.length ? pageOverrides : null,
        ...(trackingCode ? { tracking_code: trackingCode } : {}),
      }, { onConflict: 'id' })
    }

    // 3) Enviar el email de "crea tu contraseña" con nuestra plantilla (si Resend está configurado).
    const company = await getCompanyProfile(supabase)
    let emailed = false
    let emailError: string | null = null
    const r = await sendInviteEmail({ to: email, fullName: fullName || email, company, url: inviteUrl })
    emailed = r.ok
    emailError = r.ok ? null : r.error ?? null

    return NextResponse.json({
      ok: true,
      userId: userId ?? null,
      inviteUrl,
      emailed,
      emailError,
      resendConfigured: resendConfigured(),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
