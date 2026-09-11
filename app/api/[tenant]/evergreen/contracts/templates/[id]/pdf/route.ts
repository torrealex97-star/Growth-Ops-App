import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { buildTemplatePreviewPdf } from '@/lib/contracts/pdf-template'
import { getCompanyProfile } from '@/lib/contracts/company'

export const runtime = 'nodejs'

// Descarga en PDF de una plantilla de contrato de PRODUCTO (alumno/tomador) para que
// el closer se la enseñe al cliente. Nunca sirve plantillas de equipo/colaborador.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
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
    const { data: tpl } = await sb
      .from('contract_templates')
      .select('id, name, kind, body, welcome_message')
      .eq('id', id)
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
