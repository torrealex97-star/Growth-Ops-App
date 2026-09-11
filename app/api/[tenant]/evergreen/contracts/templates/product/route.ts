import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Devuelve SOLO las plantillas de contrato de producto (alumno/tomador) activas, en
// modo lectura, para que el closer pueda enseñar el contrato al cliente ANTES de la
// venta. Se usa service-role porque la RLS de contract_templates solo deja leer a
// admin/director/manager/gestoria/csm. Nunca expone plantillas de equipo.
export async function GET() {
  try {
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

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data, error } = await sb
      .from('contract_templates')
      .select('id, name, kind, payment_method, welcome_message, body')
      .in('kind', ['alumno', 'tomador'])
      .eq('is_active', true)
      .order('kind', { ascending: true })
      .order('name', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ templates: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
