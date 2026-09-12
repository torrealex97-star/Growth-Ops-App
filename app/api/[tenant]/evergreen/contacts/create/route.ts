import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { normalizePhoneE164, dialCodeForCountryISO } from '@/lib/phone'
import { toCountryISO } from '@/lib/ghl'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Crea un contacto con service-role. La tabla contacts tiene RLS con solo política de
// SELECT, así que el insert desde el cliente lo bloquea RLS para roles no-admin
// (setter/closer/etc.). Este endpoint permite crear contactos a cualquier usuario
// autenticado con rol, evitando el fallo silencioso "no me deja crear contactos".
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const body = await req.json()

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const role = t.role
    if (!role) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const clean = (v: unknown) => {
      const s = typeof v === 'string' ? v.trim() : v
      return s === '' || s === undefined ? null : s
    }

    const firstName = clean(body.first_name)
    if (!firstName) return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 })

    const lastName = clean(body.last_name)
    const fullName = [firstName, lastName].filter(Boolean).join(' ')
    const nowIso = new Date().toISOString()

    // Normaliza el teléfono a E.164 para que GHL no asuma +1. Prefijo explícito si
    // llega (body.phone_prefix), si no se deduce del país del contacto.
    const rawPhone = clean(body.phone) as string | null
    const explicitPrefix = clean(body.phone_prefix) as string | null
    const countryPrefix = dialCodeForCountryISO(toCountryISO(clean(body.country) as string | null))
    const phone = rawPhone ? normalizePhoneE164(rawPhone, explicitPrefix || countryPrefix) : null

    const { data: created, error } = await sb
      .from('contacts')
      .insert({
        tenant_id: t.tenantId,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        email: clean(body.email),
        phone,
        country: clean(body.country),
        company_name: clean(body.company_name),
        instagram: clean(body.instagram),
        notes: clean(body.notes),
        first_seen_at: nowIso,
        last_seen_at: nowIso,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'contact',
      entity_id: created.id,
      action: 'create',
      new_values: { full_name: fullName, email: clean(body.email), phone: clean(body.phone) },
    })

    return NextResponse.json({ ok: true, id: created.id, contact: created })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
