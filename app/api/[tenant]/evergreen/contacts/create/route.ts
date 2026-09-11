import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { normalizePhoneE164, dialCodeForCountryISO } from '@/lib/phone'
import { toCountryISO } from '@/lib/ghl'

export const runtime = 'nodejs'

// Crea un contacto con service-role. La tabla contacts tiene RLS con solo política de
// SELECT, así que el insert desde el cliente lo bloquea RLS para roles no-admin
// (setter/closer/etc.). Este endpoint permite crear contactos a cualquier usuario
// autenticado con rol, evitando el fallo silencioso "no me deja crear contactos".
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (urow?.roles as { key?: string } | null)?.key
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

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: created, error } = await sb
      .from('contacts')
      .insert({
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
      actor_user_id: user.id,
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
