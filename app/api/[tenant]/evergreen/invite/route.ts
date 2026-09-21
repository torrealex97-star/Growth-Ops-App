import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateUniqueTrackingCode } from '@/lib/tracking'
import { getCompanyProfile } from '@/lib/contracts/company'
import { sendInviteEmail, resendConfigured } from '@/lib/email/resend'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'

// Roles que necesitan un tracking_code para generar enlaces con UTM
const TRACKING_ROLES = ['setter', 'closer', 'cold_caller', 'affiliate']
const ADMIN_ROLES = ['admin', 'director']

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  try {
    const {
      email: rawEmail,
      roleId,
      fullName,
      deptOverrides,
      pageOverrides,
      personalEmail: rawPersonalEmail,
    } = await req.json()
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

    // Verificar que quien llama está autenticado y administra ESTA subcuenta. Sin esto,
    // cualquier usuario con sesión podría auto-invitarse con role_id de admin, o un
    // admin/director de OTRA subcuenta podría invitar gente a esta.
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const callerRole = t.role
    if (!t.isSuperAdmin && callerRole !== 'admin' && callerRole !== 'director') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
    const redirectTo = `${siteUrl}/api/${tenant}/evergreen/auth/callback?next=/${tenant}/settings/password`

    // El roleId llega del navegador, así que no se usa hasta comprobar que existe. Además de evitar
    // perfiles con una FK inválida, necesitamos la key canónica para poner el techo de membresía
    // correcto: un admin/director invitado como `member` quedaría recortado a manager por diseño.
    const { data: role, error: roleError } = await supabase.from('roles').select('key').eq('id', roleId).maybeSingle()
    if (roleError) return NextResponse.json({ error: 'No se pudo validar el rol' }, { status: 500 })
    const roleKey = (role as { key?: string } | null)?.key
    if (!roleKey) return NextResponse.json({ error: 'El rol seleccionado no existe' }, { status: 400 })

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
      `${siteUrl}/api/${tenant}/evergreen/auth/callback` +
      `?token_hash=${encodeURIComponent(hashedToken)}&type=${linkType}&next=/${tenant}/settings/password`

    // 2) Perfil en la tabla users (idempotente).
    const userId = gen.data.user?.id
    if (userId) {
      let trackingCode: string | null = null
      if (TRACKING_ROLES.includes(roleKey)) {
        trackingCode = await generateUniqueTrackingCode(supabase)
      }

      // Lee primero el acceso actual: si esta comprobación falla no debemos modificar el perfil
      // global de un usuario existente y dejar la operación completada solo a medias.
      const desiredMembershipRole = ADMIN_ROLES.includes(roleKey) ? 'admin' : 'member'
      const { data: currentMembership, error: currentMembershipError } = await supabase
        .from('tenant_members')
        .select('role')
        .eq('tenant_id', t.tenantId)
        .eq('user_id', userId)
        .maybeSingle()
      if (currentMembershipError) {
        if (linkType === 'invite') await supabase.auth.admin.deleteUser(userId)
        return NextResponse.json({ error: 'No se pudo comprobar el acceso actual a la subcuenta' }, { status: 500 })
      }
      const previousMembershipRole = (currentMembership as { role?: string } | null)?.role
      const membershipRole =
        previousMembershipRole === 'super_admin' || previousMembershipRole === 'admin'
          ? previousMembershipRole
          : desiredMembershipRole

      const { error: profileError } = await supabase.from('users').upsert(
        {
          id: userId,
          email,
          ...(personalEmail ? { personal_email: personalEmail } : {}),
          full_name: fullName || email,
          role_id: roleId,
          is_active: true,
          dept_overrides: Array.isArray(deptOverrides) && deptOverrides.length ? deptOverrides : null,
          page_overrides: Array.isArray(pageOverrides) && pageOverrides.length ? pageOverrides : null,
          ...(trackingCode ? { tracking_code: trackingCode } : {}),
        },
        { onConflict: 'id' }
      )
      if (profileError) {
        // generateLink(invite) acaba de crear esta identidad y todavía no se ha enviado el correo.
        // Se revierte para no dejar una cuenta huérfana. En recovery la identidad era previa y jamás
        // se borra: el error se informa para que un reintento pueda completar el perfil.
        if (linkType === 'invite') await supabase.auth.admin.deleteUser(userId)
        return NextResponse.json({ error: `No se pudo crear el perfil: ${profileError.message}` }, { status: 500 })
      }

      // Alta en la subcuenta: sin esta fila, el usuario tendría perfil pero
      // no podría entrar a NINGÚN tenant (el layout exige una fila en
      // tenant_members o super_admin). Un rol funcional elevado necesita membresía admin en ESTA
      // subcuenta; los demás son member. Antes de escribir se conserva cualquier techo administrativo
      // previo: reinvitar a alguien como closer no puede degradar sin aviso un admin ya existente.
      const { error: membershipError } = await supabase
        .from('tenant_members')
        .upsert({ tenant_id: t.tenantId, user_id: userId, role: membershipRole }, { onConflict: 'tenant_id,user_id' })
      if (membershipError) {
        if (linkType === 'invite') await supabase.auth.admin.deleteUser(userId)
        return NextResponse.json(
          { error: `No se pudo dar acceso a la subcuenta: ${membershipError.message}` },
          { status: 500 }
        )
      }

      // ALTA DESDE USUARIOS CON ROL COLABORADOR (hallazgo 21-sep): si el admin
      // invita/edita con el rol affiliate, el perfil de colaborador nace AQUÍ —
      // con el MISMO tracking_code del usuario como código público (así sus
      // enlaces existentes con ?ref= siguen funcionando sin re-generar nada).
      // Idempotente: si ya hay perfil, no se toca (el % y el estado son del
      // panel de Colaboradores). El alta admin de Colaboradores (POST
      // /colaboradores) sigue siendo la otra vía, para dar de alta sin invitar.
      if (roleKey === 'affiliate' && t.tenantId) {
        const { data: perfilPrevio } = await supabase
          .from('collaborator_profiles')
          .select('id')
          .eq('tenant_id', t.tenantId)
          .eq('user_id', userId)
          .limit(1)
        if (!perfilPrevio || perfilPrevio.length === 0) {
          await supabase.from('collaborator_profiles').insert({
            tenant_id: t.tenantId,
            user_id: userId,
            code: (trackingCode ?? (await generateUniqueTrackingCode(supabase))).toUpperCase(),
            name: fullName || email,
            status: 'invited',
            // El % de comisión y el estado real (pending_contract/active) los fija
            // el admin desde el panel de Colaboradores; aquí solo nace la ficha.
            default_commission_percent: null,
          })
        }
      }
    }

    // 3) Enviar el email de "crea tu contraseña" con nuestra plantilla (si Resend está configurado).
    const company = await getCompanyProfile(supabase, t.tenantId)
    let emailed = false
    let emailError: string | null = null
    const mail = await getTenantConfigWithFallback(t.tenantId)
    const r = await sendInviteEmail({ mail, to: email, fullName: fullName || email, company, url: inviteUrl })
    emailed = r.ok
    emailError = r.ok ? null : (r.error ?? null)

    return NextResponse.json({
      ok: true,
      userId: userId ?? null,
      inviteUrl,
      emailed,
      emailError,
      resendConfigured: resendConfigured(await getTenantConfigWithFallback(t.tenantId)),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
