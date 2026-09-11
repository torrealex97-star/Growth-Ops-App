import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { generateDraftForMedia } from '@/app/api/[tenant]/evergreen/cron/reels/route'

export const runtime = 'nodejs'
export const maxDuration = 120

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing', 'editor']
const ALLOWED_STATUS = ['pendiente', 'aprobado', 'descartado']

async function requireRole() {
  const cookieStore = await cookies()
  const authed = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await authed.auth.getUser()
  if (!user) return { error: 'No autenticado', status: 401 as const }
  const { data: row } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
  const role = (row?.roles as { key?: string } | null)?.key
  if (!role || !ALLOWED_ROLES.includes(role)) return { error: 'No autorizado', status: 403 as const }
  return { user }
}

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// PATCH { status? , adapted_script?, carousel_idea?, testimonio_id? } → aprueba/descarta/edita.
// PATCH { action: 'regenerate' } → re-transcribe + re-genera el guión de este borrador.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id } = await params
  const body = await req.json()
  const sb = svc()

  if (body?.action === 'regenerate') {
    const { data: draft, error } = await sb.from('reel_drafts').select('*').eq('id', id).single()
    if (error || !draft) return NextResponse.json({ error: 'Borrador no encontrado' }, { status: 404 })
    if (!draft.source_media_id) return NextResponse.json({ error: 'Este borrador no tiene un reel de origen asociado' }, { status: 400 })

    const { data: media, error: mediaErr } = await sb
      .from('ig_competitor_media')
      .select('id, competitor_id, caption, media_url, thumbnail_url, permalink, transcript, ai_analysis, published_at')
      .eq('id', draft.source_media_id)
      .single()
    if (mediaErr || !media) return NextResponse.json({ error: 'No se encontró el reel de origen (¿se eliminó de Competencia?)' }, { status: 404 })

    const { data: comp } = await sb.from('ig_competitors').select('username').eq('id', media.competitor_id).single()
    const result = await generateDraftForMedia(sb, media, comp?.username || draft.source_account || '', id)
    if (!result.ok) return NextResponse.json({ error: result.error || 'No se pudo regenerar' }, { status: 500 })

    const { data: updated } = await sb.from('reel_drafts').select('*').eq('id', id).single()
    return NextResponse.json({ ok: true, draft: updated })
  }

  const { status, adapted_script, carousel_idea, testimonio_id } = body as {
    status?: string; adapted_script?: string; carousel_idea?: string; testimonio_id?: string | null
  }
  const patch: Record<string, unknown> = {}
  if (status !== undefined) {
    if (!ALLOWED_STATUS.includes(status)) return NextResponse.json({ error: 'Estado no válido' }, { status: 400 })
    patch.status = status
  }
  if (adapted_script !== undefined) patch.adapted_script = adapted_script
  if (carousel_idea !== undefined) patch.carousel_idea = carousel_idea
  // Testimonio que lleva el reel: el editor lo marca para saber de qué caso coger material.
  // null / '' lo desvincula.
  if (testimonio_id !== undefined) {
    if (testimonio_id) {
      const { data: t } = await sb.from('testimonios').select('id').eq('id', testimonio_id).maybeSingle()
      if (!t) return NextResponse.json({ error: 'Ese testimonio no existe' }, { status: 400 })
      patch.testimonio_id = testimonio_id
    } else {
      patch.testimonio_id = null
    }
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })

  const { data, error } = await sb.from('reel_drafts').update(patch).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, draft: data })
}
