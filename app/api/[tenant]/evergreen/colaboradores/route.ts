import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { generateUniqueTrackingCode } from '@/lib/tracking'
import { crearContratoEquipo } from '@/lib/contracts/team-contract'

// GESTIÓN DE COLABORADORES (§40-A, §41, §76).
//
// Dos vías de alta: (A) el admin crea el colaborador aquí — datos mínimos +
// % + estado — y el sistema reutiliza la invitación existente; (B) el formulario
// público de afiliados/registro (que sigue funcionando y ahora además crea el
// perfil de colaborador vía backfill/compat). El colaborador es SIEMPRE un
// usuario normal: mismo login, mismo callback, misma recuperación de contraseña.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!['admin', 'director', 'manager'].includes(t.role ?? '')) {
    return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })
  }

  const sb = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data, error } = await sb
    .from('collaborator_profiles')
    .select('*, users(full_name, email, is_active)')
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ colaboradores: data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!['admin', 'director'].includes(t.role ?? '')) {
    return NextResponse.json({ error: 'Solo administración puede dar de alta colaboradores' }, { status: 403 })
  }

  try {
    const body = (await req.json()) as {
      userId?: string
      email?: string
      fullName?: string
      code?: string
      defaultCommissionPercent?: number
      status?: string
      notes?: string
    }

    const sb = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const ESTADOS = ['invited', 'pending_contract', 'active', 'suspended', 'inactive']
    // El alta encadena el contrato de equipo: el estado efectivo de un
    // colaborador nuevo es 'pending_contract' (contrato enviado, pendiente de
    // firma), no 'invited' — la activación definitiva ocurre al FIRMAR.

    let userId = body.userId ?? null

    // Alta SIN usuario existente: se reutiliza la invitación del sistema (mismo
    // login/callback que cualquier miembro). El rol 'affiliate' es el que el
    // modelo ya tenía para este colectivo; el perfil de colaborador es lo que
    // estructura el resto (código, estado, contrato, %).
    if (!userId && body.email) {
      const email = body.email.toLowerCase().trim()
      const { data: existente } = await sb.from('users').select('id').eq('email', email).maybeSingle()
      if (existente) {
        userId = (existente as { id: string }).id
      } else {
        const { data: role } = await sb.from('roles').select('id').eq('key', 'affiliate').maybeSingle()
        const roleId = (role as { id?: string } | null)?.id
        if (!roleId) return NextResponse.json({ error: 'No existe el rol de colaborador' }, { status: 500 })

        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
        const { data: invited, error: inviteError } = await sb.auth.admin.inviteUserByEmail(email, {
          data: { role_id: roleId, full_name: body.fullName ?? '' },
          redirectTo: `${siteUrl}/api/${tenant}/evergreen/auth/callback?next=/${tenant}/settings/password`,
        })
        if (inviteError || !invited.user) {
          return NextResponse.json({ error: inviteError?.message || 'No se pudo invitar' }, { status: 400 })
        }
        const { error: userErr } = await sb.from('users').upsert(
          {
            id: invited.user.id,
            email,
            full_name: body.fullName ?? null,
            role_id: roleId,
            is_active: true,
            // Dominio canónico de users.member_status: 'activo' | 'inactivo' | 'prueba'.
            // El estado 'invited' del colaborador vive en collaborator_profiles.status.
            member_status: 'activo',
          },
          { onConflict: 'id' }
        )
        if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 })
        userId = invited.user.id
      }
    }
    if (!userId) return NextResponse.json({ error: 'Falta userId o email' }, { status: 400 })

    // Membership del tenant: sin ella el layout no deja entrar (reutilizado tal cual).
    await sb
      .from('tenant_members')
      .upsert(
        { tenant_id: t.tenantId, user_id: userId, role: 'member' },
        { onConflict: 'tenant_id,user_id', ignoreDuplicates: true }
      )

    // Código público: el que pida el admin (normalizado) o uno generado único.
    // Es identificador de presentación, no identidad: la PK/FK es el UUID.
    let code = (body.code ?? '').trim().toUpperCase()
    if (!code) {
      code = await generateUniqueTrackingCode(sb)
    } else {
      const { data: chocan } = await sb
        .from('collaborator_profiles')
        .select('id')
        .eq('tenant_id', t.tenantId)
        .eq('code', code)
        .limit(1)
      if (chocan && chocan.length) {
        return NextResponse.json({ error: `El código ${code} ya está en uso en esta subcuenta` }, { status: 409 })
      }
    }

    const { data: creado, error: crearErr } = await sb
      .from('collaborator_profiles')
      .upsert(
        {
          tenant_id: t.tenantId,
          user_id: userId,
          code,
          name: body.fullName ?? null,
          status,
          default_commission_percent: body.defaultCommissionPercent ?? null,
          notes: body.notes ?? null,
        },
        { onConflict: 'tenant_id,user_id' }
      )
      .select('id, code, status')
      .single()
    if (crearErr || !creado)
      return NextResponse.json({ error: crearErr?.message ?? 'No se pudo crear el colaborador' }, { status: 500 })

    // CADENA AUTOMÁTICA DEL CONTRATO (hallazgo E2E 19-sep): el alta deja al
    // colaborador con su contrato de equipo creado y enviado por email — el
    // estado pasa a 'pending_contract' y la activación definitiva ocurre al
    // FIRMAR (public-contracts/sign). No bloquea el alta: si el envío falla,
    // queda 'invited' y el admin puede enviar el contrato manualmente desde
    // Contratos › Equipo (o repetir el alta, que es idempotente).
    let contrato: Awaited<ReturnType<typeof crearContratoEquipo>> | null = null
    let estadoFinal = status
    if (status === 'invited') {
      contrato = await crearContratoEquipo({
        sb,
        tenantId: t.tenantId,
        userId,
        createdBy: t.userId,
        baseUrl: process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin,
        roleKey: 'affiliate',
        affiliatePercent: body.defaultCommissionPercent ?? null,
      })
      if (contrato.ok) {
        // Contrato en firme (recién enviado o ya enviado antes) → pendiente de
        // firma. Si ya hay uno FIRMADO (re-alta de un usuario existente), nace
        // directamente activo.
        estadoFinal = contrato.estado === 'ya_firmado' ? 'active' : 'pending_contract'
        await sb
          .from('collaborator_profiles')
          .update({ status: estadoFinal, updated_at: new Date().toISOString() })
          .eq('id', creado.id)
          .eq('tenant_id', t.tenantId)
      }
    }

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'collaborator_profile',
      entity_id: creado.id,
      action: 'collaborator_created',
      new_values: {
        code,
        status: estadoFinal,
        user_id: userId,
        contrato: contrato?.ok
          ? { estado: contrato.estado, emailed: contrato.emailed, contract_id: contrato.contractId ?? null }
          : null,
      },
    })

    return NextResponse.json({
      ok: true,
      colaborador: { ...creado, status: estadoFinal },
      contrato: contrato ?? undefined,
    })
  } catch (err) {
    console.error('[api/colaboradores]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!['admin', 'director'].includes(t.role ?? '')) {
    return NextResponse.json({ error: 'Solo administración puede editar colaboradores' }, { status: 403 })
  }

  try {
    const body = (await req.json()) as {
      id?: string
      status?: string
      defaultCommissionPercent?: number | null
      notes?: string
    }
    if (!body.id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })

    const sb = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const ESTADOS = ['invited', 'pending_contract', 'active', 'suspended', 'inactive']
    if (body.status && !ESTADOS.includes(body.status)) {
      return NextResponse.json({ error: 'Estado no válido' }, { status: 400 })
    }

    const { data: previo } = await sb
      .from('collaborator_profiles')
      .select('id, status, default_commission_percent')
      .eq('id', body.id)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()
    if (!previo) return NextResponse.json({ error: 'Colaborador no encontrado' }, { status: 404 })

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.status) patch.status = body.status
    if (body.defaultCommissionPercent !== undefined) patch.default_commission_percent = body.defaultCommissionPercent
    if (body.notes !== undefined) patch.notes = body.notes

    const { error } = await sb.from('collaborator_profiles').update(patch).eq('id', body.id).eq('tenant_id', t.tenantId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'collaborator_profile',
      entity_id: body.id,
      action: 'collaborator_updated',
      old_values: previo,
      new_values: patch,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/colaboradores]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
