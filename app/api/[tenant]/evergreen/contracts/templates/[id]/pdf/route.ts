import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { buildTemplatePreviewPdf } from '@/lib/contracts/pdf-template'
import { getCompanyProfile } from '@/lib/contracts/company'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Descarga en PDF de una plantilla de contrato de PRODUCTO (alumno/tomador) para que
// el closer se la enseñe al cliente. Nunca sirve plantillas de equipo/colaborador.
// Ruta de equipo (requiere sesión, no un token público de firmante): usa requireTenant.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  try {
    const { tenant, id } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: urow } = await sb.from('users').select('roles(key)').eq('id', t.userId).single()
    const role = (urow?.roles as { key?: string } | null)?.key
    if (!role) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const { data: tpl } = await sb
      .from('contract_templates')
      .select('id, name, kind, body, welcome_message')
      .eq('id', id)
      .eq('tenant_id', t.tenantId)
      .in('kind', ['alumno', 'tomador'])
      .maybeSingle()
    if (!tpl) return NextResponse.json({ error: 'Plantilla no encontrada' }, { status: 404 })

    const company = await getCompanyProfile(sb)
    const pdf = await buildTemplatePreviewPdf({
      title: tpl.name || 'Contrato',
      bodyText: tpl.body || '',
      welcome: tpl.welcome_message,
      company,
    })

    const filename = `plantilla-${(tpl.name || 'contrato').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}.pdf`
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
