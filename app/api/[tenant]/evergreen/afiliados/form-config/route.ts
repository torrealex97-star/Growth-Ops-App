import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { AffiliateFormField } from '@/lib/types/database'

// La config cambia desde el panel admin; no cachear la respuesta (evita servir campos vacíos/obsoletos).
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Config PÚBLICA del formulario de registro de afiliados (sin sesión).
// Devuelve solo lo necesario para pintar el formulario: nombre del programa, intro,
// mensaje de éxito y los campos habilitados. NO expone el % de comisión.
// Público (sin login): resolvemos el tenant por slug directamente en vez de
// requireTenant (que exige sesión) y acotamos cada lectura a su tenant_id.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: tenantRow } = await supabase.from('tenants').select('id, status').eq('slug', tenant).maybeSingle()
    if (!tenantRow || tenantRow.status !== 'active') {
      return NextResponse.json({ error: 'Subcuenta no encontrada' }, { status: 404 })
    }
    const tenantId = tenantRow.id

    const { data } = await supabase
      .from('affiliate_program_settings')
      .select('program_name, intro, success_message, form_fields')
      .eq('id', 1)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    const fields = ((data?.form_fields as AffiliateFormField[] | null) ?? []).filter((f) => f.enabled)

    // Enlace por campaña: ?c=<slug>. Si existe y está activa, devolvemos su nombre para mostrarlo.
    let campaign: { name: string } | null = null
    const slug = req.nextUrl.searchParams.get('c')?.trim()
    if (slug) {
      const { data: camp } = await supabase
        .from('affiliate_campaigns')
        .select('name, is_active')
        .eq('registration_slug', slug)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      const c = camp as { name: string; is_active: boolean } | null
      if (c?.is_active) campaign = { name: c.name }
    }

    return NextResponse.json({
      program_name: data?.program_name ?? 'Programa de Afiliados',
      intro: data?.intro ?? '',
      success_message: data?.success_message ?? '¡Listo! Revisa tu email.',
      fields,
      campaign,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
