import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { findDuplicateContactGroups, findDuplicateAppointmentGroups } from '@/lib/data-health'

export const runtime = 'nodejs'

// Fusionar contactos y limpiar agendas duplicadas es una acción que reescribe datos reales de
// clientes — se restringe a admin/director (mismo nivel que collections/refunds), no al set más
// amplio que puede solo leer Data Health.
const MERGE_ROLES = ['admin', 'director']

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// GET — propone grupos de fusión: contactos con mismo email/teléfono normalizado, y agendas
// duplicadas exactas (misma fuente + id externo, reingesta del mismo webhook).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireTenant(tenant)
    if ('error' in auth) return auth.error
    if (!auth.isSuperAdmin && !MERGE_ROLES.includes(auth.role ?? '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const sb = svc()
    const [contactsRes, appointmentsRes] = await Promise.all([
      sb
        .from('contacts')
        .select('id,full_name,email,phone,created_at')
        .eq('tenant_id', auth.tenantId)
        .is('merged_into', null)
        .limit(10000),
      sb
        .from('appointments')
        .select('id,external_source,external_id,appointment_datetime,created_at')
        .eq('tenant_id', auth.tenantId)
        .limit(10000),
    ])
    if (contactsRes.error) return NextResponse.json({ error: contactsRes.error.message }, { status: 500 })
    if (appointmentsRes.error) return NextResponse.json({ error: appointmentsRes.error.message }, { status: 500 })

    const contactGroups = findDuplicateContactGroups(contactsRes.data ?? [])
    const appointmentGroups = findDuplicateAppointmentGroups(appointmentsRes.data ?? [])
    return NextResponse.json({ contactGroups, appointmentGroups })
  } catch (err) {
    console.error('[api/settings/data-health/dedupe GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

type MergeBody =
  | { type: 'contacts'; primaryId: string; duplicateIds: string[] }
  | { type: 'appointments'; keepId: string; duplicateIds: string[] }

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireTenant(tenant)
    if ('error' in auth) return auth.error
    if (!auth.isSuperAdmin && !MERGE_ROLES.includes(auth.role ?? '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const body = (await req.json().catch(() => null)) as MergeBody | null
    if (!body || !Array.isArray(body.duplicateIds) || body.duplicateIds.length === 0) {
      return NextResponse.json({ error: 'Petición inválida' }, { status: 400 })
    }

    const sb = svc()

    if (body.type === 'contacts') {
      if (!body.primaryId) return NextResponse.json({ error: 'Falta el contacto primario' }, { status: 400 })
      for (const duplicateId of body.duplicateIds) {
        const { error } = await sb.rpc('merge_contacts', {
          p_tenant_id: auth.tenantId,
          p_primary_id: body.primaryId,
          p_duplicate_id: duplicateId,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      }
      await sb.from('audit_logs').insert({
        tenant_id: auth.tenantId,
        actor_user_id: auth.userId,
        entity_type: 'contact',
        entity_id: body.primaryId,
        action: 'merge_duplicates',
        new_values: { duplicateIds: body.duplicateIds },
      })
      return NextResponse.json({ ok: true, merged: body.duplicateIds.length })
    }

    if (body.type === 'appointments') {
      const { error } = await sb
        .from('appointments')
        .delete()
        .eq('tenant_id', auth.tenantId)
        .in('id', body.duplicateIds)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await sb.from('audit_logs').insert({
        tenant_id: auth.tenantId,
        actor_user_id: auth.userId,
        entity_type: 'appointment',
        entity_id: body.keepId,
        action: 'delete_duplicates',
        new_values: { duplicateIds: body.duplicateIds },
      })
      return NextResponse.json({ ok: true, deleted: body.duplicateIds.length })
    }

    return NextResponse.json({ error: 'Tipo de fusión no soportado' }, { status: 400 })
  } catch (err) {
    console.error('[api/settings/data-health/dedupe POST]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
