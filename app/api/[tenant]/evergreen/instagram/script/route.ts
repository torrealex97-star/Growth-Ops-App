import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { generateScript, type ReelAnalysis } from '@/lib/ai/claude'
import { readStylePrompt, readBusinessContext } from '@/lib/app-settings'
import { ctasForPrompt, CTA_CODES } from '@/lib/ctas'
import { getTestimonio, listTestimonios, testimonioForPrompt } from '@/lib/testimonios'

export const runtime = 'nodejs'
export const maxDuration = 120

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing', 'editor']

// Resuelve la prueba social pedida desde la UI:
//   ''      → guión sin testimonio
//   'auto'  → se le pasa el catálogo y la IA elige el caso que mejor encaje
//   <id>    → ese testimonio concreto
//
// Devuelve el bloque para el prompt, el id ya resuelto (si se pidió uno concreto) y los
// candidatos, para poder deducir a posteriori cuál eligió la IA en modo 'auto'.
async function resolveTestimonio(testimonio: unknown): Promise<{
  block: string | null
  id: string | null
  candidates: { id: string; name: string }[]
}> {
  const value = typeof testimonio === 'string' ? testimonio.trim() : ''
  if (!value) return { block: null, id: null, candidates: [] }

  if (value === 'auto') {
    const all = await listTestimonios()
    if (!all.length) return { block: null, id: null, candidates: [] }
    const catalogo = all.map((t) => `### ${t.name}\n${testimonioForPrompt(t)}`).join('\n\n')
    return {
      block: `TIENES QUE INCLUIR PRUEBA SOCIAL. Elige UN SOLO caso del catálogo siguiente: el que mejor encaje con el tema del reel y el avatar. Usa únicamente los datos del caso elegido e ignora el resto.\n\n${catalogo}`,
      id: null,
      candidates: all.map((t) => ({ id: t.id, name: t.name })),
    }
  }

  const t = await getTestimonio(value)
  if (!t || !t.active) return { block: null, id: null, candidates: [] }
  return { block: testimonioForPrompt(t), id: t.id, candidates: [{ id: t.id, name: t.name }] }
}

// En modo 'auto' la IA devuelve el NOMBRE del caso que usó; lo mapeamos a su id para
// poder guardarlo en la pieza de contenido.
function matchTestimonioId(
  used: string | undefined,
  candidates: { id: string; name: string }[]
): string | null {
  const needle = (used || '').trim().toLowerCase()
  if (!needle) return null
  const exact = candidates.find((c) => c.name.toLowerCase() === needle)
  if (exact) return exact.id
  return candidates.find((c) => needle.includes(c.name.toLowerCase()))?.id ?? null
}

// Genera un guión NUEVO "parecido o mejor" a partir de un reel que ya funcionó.
// Si saveAsIdea=true, lo guarda como idea en el kanban de Contenido (content_items).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { mediaId, competitorMediaId, instruction, cta, testimonio, saveAsIdea, transcript: transcriptOverride } = await req.json()
    if (!mediaId && !competitorMediaId) return NextResponse.json({ error: 'Falta mediaId o competitorMediaId' }, { status: 400 })
    const forcedCta = cta && CTA_CODES.includes(String(cta).toUpperCase()) ? String(cta).toUpperCase() : undefined

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: urow } = await sb.from('users').select('roles(key)').eq('id', t.userId).single()
    const role = (urow?.roles as { key?: string } | null)?.key
    if (!role || !ALLOWED_ROLES.includes(role)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    // Origen: reel propio (ig_media) o de competencia (ig_competitor_media)
    const source = mediaId
      ? await sb.from('ig_media').select('caption, transcript, ai_analysis, permalink').eq('id', mediaId).eq('tenant_id', t.tenantId).single()
      : await sb.from('ig_competitor_media').select('caption, transcript, ai_analysis, permalink').eq('id', competitorMediaId).eq('tenant_id', t.tenantId).single()
    const media = source.data
    if (source.error || !media) return NextResponse.json({ error: 'Reel no encontrado' }, { status: 404 })

    // Transcripción efectiva: la editada por el usuario tiene prioridad sobre la de BBDD.
    const transcript = (typeof transcriptOverride === 'string' && transcriptOverride.trim())
      ? transcriptOverride.trim()
      : (media.transcript || undefined)

    // Estilo + contexto de negocio + CTAs alimentan la generación nichada.
    const [styleBlock, businessContext] = await Promise.all([readStylePrompt(), readBusinessContext()])

    // Prueba social opcional: "auto" deja que la IA elija el caso que mejor encaje con
    // el tema del reel; un id concreto fuerza ese testimonio. Vacío = guión sin testimonio.
    const testimonioPick = await resolveTestimonio(testimonio)

    const draft = await generateScript(
      {
        transcript,
        caption: media.caption || undefined,
        analysis: (media.ai_analysis as ReelAnalysis | null) || null,
      },
      instruction,
      {
        businessContext,
        ctasBlock: ctasForPrompt(),
        forcedCta,
        styleBlock: styleBlock || undefined,
        testimonioBlock: testimonioPick.block || undefined,
      }
    )

    // Testimonio que acabó en el guión: el pedido, o el que eligió la IA en modo 'auto'.
    const testimonioId =
      testimonioPick.id ?? matchTestimonioId(draft.testimonio_used, testimonioPick.candidates)

    let ideaId: string | null = null
    if (saveAsIdea) {
      const notes = `GUION IA (inspirado en ${media.permalink || 'un reel top'})${draft.cta_used ? ` · CTA: ${draft.cta_used}` : ''}:\n\nHOOK: ${draft.hook}\n\nCAPTION: ${draft.caption}\n\nNOTAS: ${draft.notes}`
      const { data: idea, error: insErr } = await sb
        .from('content_items')
        .insert({
          tenant_id: t.tenantId,
          title: draft.title,
          content_type: 'reel',
          status: 'idea',
          notes,
          script: `HOOK: ${draft.hook}\n\n${draft.script}\n\nCAPTION: ${draft.caption}`,
          reference_reel_url: media.permalink || null,
          reference_transcript: transcript || null,
          testimonio_id: testimonioId,
          created_by: t.userId,
        })
        .select('id')
        .single()
      if (insErr) return NextResponse.json({ error: `No se pudo guardar en Contenido: ${insErr.message}`, draft }, { status: 500 })
      ideaId = idea?.id ?? null
    }

    return NextResponse.json({ ok: true, draft, ideaId, testimonioId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
