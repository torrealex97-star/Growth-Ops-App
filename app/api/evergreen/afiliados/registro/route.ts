import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateUniqueTrackingCode } from '@/lib/tracking'
import type { AffiliateFormField } from '@/lib/types/database'

// Columnas propias de affiliate_profiles; cualquier otro campo del formulario va a `extra`.
const PROFILE_KEYS = ['instagram', 'audience_size', 'niche', 'source', 'motivation'] as const

// Registro PÚBLICO de afiliados con ALTA AUTOMÁTICA.
// Crea el usuario (rol affiliate) con su código de tracking = affiliate_code, aplica el % de
// comisión por defecto del programa y le envía invitación por email para crear su contraseña.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>

    // Honeypot anti-spam: si viene relleno, hacemos como que fue bien pero no creamos nada.
    if (typeof body.company === 'string' && body.company.trim() !== '') {
      return NextResponse.json({ ok: true })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 1) Config del programa (campos + % por defecto + mensaje)
    const { data: settings } = await supabase
      .from('affiliate_program_settings')
      .select('default_commission_percent, success_message, form_fields')
      .eq('id', 1)
      .maybeSingle()

    const fields = ((settings?.form_fields as AffiliateFormField[] | null) ?? []).filter((f) => f.enabled)
    const commissionPct = Number(settings?.default_commission_percent ?? 20)

    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')
    const fullName = str('full_name')
    const email = str('email').toLowerCase()

    // Campaña opcional: el admin comparte un enlace con ?c=<slug>. Si la campaña existe y está
    // activa, al registrarse el afiliado queda asignado automáticamente a ella.
    const campaignSlug = str('campaign_slug')
    let campaign: { id: string; name: string } | null = null
    if (campaignSlug) {
      const { data: camp } = await supabase
        .from('affiliate_campaigns')
        .select('id, name, is_active')
        .eq('registration_slug', campaignSlug)
        .maybeSingle()
      const c = camp as { id: string; name: string; is_active: boolean } | null
      if (c?.is_active) campaign = { id: c.id, name: c.name }
    }

    // Añade (idempotente) un afiliado a la campaña resuelta. `created_by` = null: alta pública.
    const assignToCampaign = async (affiliateId: string, createdBy: string | null = null) => {
      if (!campaign) return
      await supabase
        .from('affiliate_campaign_members')
        .upsert(
          { campaign_id: campaign.id, affiliate_id: affiliateId, created_by: createdBy },
          { onConflict: 'campaign_id,affiliate_id', ignoreDuplicates: true }
        )
    }

    // 2) Validaciones: obligatorios según config + email/nombre siempre
    if (!fullName || !email) {
      return NextResponse.json({ error: 'Nombre y email son obligatorios' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'El email no es válido' }, { status: 400 })
    }
    for (const f of fields) {
      if (f.required && !str(f.key)) {
        return NextResponse.json({ error: `El campo "${f.label}" es obligatorio` }, { status: 400 })
      }
    }

    // 3) Rol affiliate
    const { data: role } = await supabase.from('roles').select('id').eq('key', 'affiliate').maybeSingle()
    const roleId = (role as { id?: string } | null)?.id
    if (!roleId) {
      return NextResponse.json({ error: 'No existe el rol de afiliado en el sistema' }, { status: 500 })
    }

    // 4) Dedupe por email.
    //    - Si YA es usuario y venimos desde el enlace de una campaña → solo lo asignamos a ella.
    //    - Si YA es usuario sin campaña → mantenemos el aviso de "inicia sesión".
    const { data: existing } = await supabase.from('users').select('id').eq('email', email).maybeSingle()
    if (existing) {
      const existingId = (existing as { id: string }).id
      if (campaign) {
        await assignToCampaign(existingId)
        return NextResponse.json({
          ok: true,
          message: `Ya tenías cuenta con este email. Te hemos añadido a la campaña "${campaign.name}".`,
        })
      }
      return NextResponse.json(
        { error: 'Ya existe una cuenta con este email. Si ya eres afiliado, inicia sesión.' },
        { status: 409 }
      )
    }

    // 5) Invitación (crea el usuario en auth) → callback → crear contraseña
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://tu-dominio.com'
    const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { role_id: roleId, full_name: fullName },
      redirectTo: `${siteUrl}/api/evergreen/auth/callback?next=/evergreen/settings/password`,
    })
    if (inviteError || !invited.user) {
      return NextResponse.json({ error: inviteError?.message || 'No se pudo crear el afiliado' }, { status: 400 })
    }

    // 6) Código: affiliate_code == tracking_code para que enlace (utm_content) y atribución casen
    const code = await generateUniqueTrackingCode(supabase)

    await supabase.from('users').upsert(
      {
        id: invited.user.id,
        email,
        full_name: fullName,
        role_id: roleId,
        is_active: true,
        phone: str('phone') || null,
        tracking_code: code,
        affiliate_code: code,
        default_affiliate_commission_percent: commissionPct,
      },
      { onConflict: 'id' }
    )

    // 7) Perfil de afiliado (datos extra del formulario)
    const extra: Record<string, unknown> = {}
    for (const f of fields) {
      const k = f.key
      if (k === 'full_name' || k === 'email' || k === 'phone') continue
      if ((PROFILE_KEYS as readonly string[]).includes(k)) continue
      const v = str(k)
      if (v) extra[k] = v
    }
    await supabase.from('affiliate_profiles').upsert(
      {
        user_id: invited.user.id,
        instagram: str('instagram') || null,
        audience_size: str('audience_size') || null,
        niche: str('niche') || null,
        source: str('source') || null,
        motivation: str('motivation') || null,
        extra: Object.keys(extra).length ? extra : null,
      },
      { onConflict: 'user_id' }
    )

    // 8) Asignación a la campaña del enlace (si venía una)
    await assignToCampaign(invited.user.id)

    const baseMessage = settings?.success_message || '¡Listo! Revisa tu email para crear tu contraseña.'
    return NextResponse.json({
      ok: true,
      message: campaign
        ? `¡Listo! Te has dado de alta y quedas asignado a la campaña "${campaign.name}". Revisa tu email para crear tu contraseña.`
        : baseMessage,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
