import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

// OVERRIDE ADMINISTRATIVO DE ATRIBUCIÓN DE COLABORADOR (§12-§13 del brief).
//
// La regla por defecto es FIRST VALID COLLABORATOR ATTRIBUTION WINS (registrarToque
// nunca roba un colaborador ya asignado). La ÚNICA vía para cambiarlo es esta ruta:
// un admin/director, con MOTIVO OBLIGATORIO, actor y timestamp registrados en
// audit_logs (old → new). Nada en la app modifica atribución financiera en silencio.
//
// Cuerpo: { contactId, collaboratorId | null, reason }
//   collaboratorId = null → "Directo / Sin colaborador" (estado válido, §14; NULL
//   estructural, nunca un colaborador fake).

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  // Solo administración. El colaborador jamás toca su atribución (§63).
  if (!['admin', 'director'].includes(t.role ?? '')) {
    return NextResponse.json({ error: 'Solo administración puede cambiar la atribución' }, { status: 403 })
  }

  try {
    const body = (await req.json()) as { contactId?: string; collaboratorId?: string | null; reason?: string }
    const contactId = body.contactId
    const collaboratorId = body.collaboratorId ?? null
    const reason = (body.reason ?? '').trim()

    if (!contactId) return NextResponse.json({ error: 'Falta contactId' }, { status: 400 })
    if (!reason) return NextResponse.json({ error: 'El motivo es obligatorio' }, { status: 400 })

    const sb = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // El contacto tiene que existir EN ESTA subcuenta (no se aceptan ids cross-tenant).
    const { data: contacto } = await sb
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()
    if (!contacto) return NextResponse.json({ error: 'Contacto no encontrado' }, { status: 404 })

    // Si se asigna colaborador, tiene que ser un perfil ACTIVO de esta subcuenta.
    if (collaboratorId) {
      const { data: perfil } = await sb
        .from('collaborator_profiles')
        .select('id, status')
        .eq('id', collaboratorId)
        .eq('tenant_id', t.tenantId)
        .maybeSingle()
      const p = perfil as { id: string; status: string } | null
      if (!p) return NextResponse.json({ error: 'Colaborador no encontrado en esta subcuenta' }, { status: 404 })
      if (!['active', 'pending_contract'].includes(p.status)) {
        return NextResponse.json({ error: 'El colaborador no está activo' }, { status: 400 })
      }
    }

    // Valor ANTERIOR (para el histórico). La fila is_primary es la canónica.
    const { data: attr } = await sb
      .from('contact_attributions')
      .select('id, collaborator_id')
      .eq('contact_id', contactId)
      .eq('tenant_id', t.tenantId)
      .eq('is_primary', true)
      .maybeSingle()
    const anterior = (attr as { id: string; collaborator_id: string | null } | null)?.collaborator_id ?? null

    const ahora = new Date().toISOString()
    if (attr) {
      const { error } = await sb
        .from('contact_attributions')
        .update({ collaborator_id: collaboratorId, updated_at: ahora })
        .eq('id', (attr as { id: string }).id)
        .eq('tenant_id', t.tenantId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      // Contacto sin fila de atribución (creado a mano): se crea la canónica.
      const { error } = await sb.from('contact_attributions').insert({
        tenant_id: t.tenantId,
        contact_id: contactId,
        is_primary: true,
        collaborator_id: collaboratorId,
        source: 'admin_override',
        first_touch_at: ahora,
        last_touch_at: ahora,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // AUDITORÍA (§64): quién, qué, cuándo, anterior, nuevo y por qué.
    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'contact_attribution',
      entity_id: contactId,
      action: 'collaborator_attribution_override',
      old_values: { collaborator_id: anterior },
      new_values: { collaborator_id: collaboratorId, reason },
    })

    return NextResponse.json({ ok: true, from: anterior, to: collaboratorId })
  } catch (err) {
    console.error('[api/colaboradores/attribution]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
