import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Devuelve SOLO las plantillas de contrato de producto (alumno/tomador) activas, en
// modo lectura, para que el closer pueda enseñar el contrato al cliente ANTES de la
// venta. Se usa service-role porque la RLS de contract_templates solo deja leer a
// admin/director/manager/gestoria/csm. Nunca expone plantillas de equipo.
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const role = t.role
    if (!role) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const { data, error } = await sb
      .from('contract_templates')
      .select('id, name, kind, payment_method, welcome_message, body')
      .in('kind', ['alumno', 'tomador'])
      .eq('is_active', true)
      .eq('tenant_id', t.tenantId)
      .order('kind', { ascending: true })
      .order('name', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ templates: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
