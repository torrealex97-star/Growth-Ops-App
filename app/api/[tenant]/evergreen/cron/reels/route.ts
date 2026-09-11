import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { generateScript, type ReelAnalysis } from '@/lib/ai/claude'
import { readStylePrompt, readBusinessContext } from '@/lib/app-settings'
import { ctasForPrompt } from '@/lib/ctas'

export const runtime = 'nodejs'
export const maxDuration = 300

// CTA por defecto para los borradores automáticos: el cierre de fondo de funnel
// (la "clase" / VSL), salvo que en el futuro se quiera variar por candidato.
const DEFAULT_CTA = 'CLASE'
const DAILY_CAP = 5
const GROQ_LIMIT_BYTES = 25 * 1024 * 1024 // 25MB (tier gratuito Groq)
const TIME_BUDGET_MS = 270_000 // deja margen sobre maxDuration=300s

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function transcribeGroq(buf: Buffer, mime: string): Promise<string> {
  if (!process.env.GROQ_API_KEY) throw new Error('Falta GROQ_API_KEY')
  const form = new FormData()
  const ext = mime.includes('mp4') || mime.includes('video') ? 'mp4' : mime.includes('m4a') ? 'm4a' : 'mp3'
  form.append('file', new Blob([new Uint8Array(buf)], { type: mime || 'video/mp4' }), `reel.${ext}`)
  form.append('model', 'whisper-large-v3-turbo')
  form.append('language', 'es')
  form.append('response_format', 'json')
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { text?: string }
  return data.text || ''
}

// Descarga el media_url y lo transcribe con Groq Whisper. Lanza si no hay vídeo
// o si supera el límite gratuito de 25MB.
async function transcribeMediaUrl(mediaUrl: string): Promise<string> {
  const r = await fetch(mediaUrl)
  if (!r.ok) throw new Error('El enlace del vídeo ha caducado (vuelve a sincronizar Competencia)')
  const buf = Buffer.from(await r.arrayBuffer())
  const mime = r.headers.get('content-type') || 'video/mp4'
  if (buf.byteLength > GROQ_LIMIT_BYTES) {
    throw new Error(`El vídeo pesa ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB y supera el límite de 25MB`)
  }
  const transcript = await transcribeGroq(buf, mime)
  if (!transcript || transcript.trim().length < 10) throw new Error('No se pudo extraer texto del reel (¿sin voz?)')
  return transcript
}

// Idea corta de carrusel/flyer (2-3 slides: portada / desarrollo / CTA) a partir
// del guión adaptado. Reutiliza el mismo modelo que generateScript vía un prompt
// ligero aparte (no hace falta tocar lib/ai/claude.ts).
async function generateCarouselIdea(adaptedScript: string, hook: string): Promise<string> {
  const { anthropic } = await import('@/lib/ai/claude')
  const msg = await anthropic().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: `Eres el diseñador de contenido de @adrian.martinez.s (IA WINNERS). A partir de un guión de reel, propones una idea CORTA de carrusel/flyer (2-3 slides) que transmita la misma idea en formato estático para Instagram.
Responde en español, en texto plano (sin JSON), con este formato exacto:
Slide 1 (portada): ...
Slide 2 (desarrollo): ...
Slide 3 (CTA): ...
Sé concreto y breve (una frase por slide).`,
    messages: [{ role: 'user', content: `Hook: ${hook}\n\nGuión adaptado:\n${adaptedScript.slice(0, 3000)}` }],
  })
  return msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim()
}

type CompetitorMediaRow = {
  id: string
  competitor_id: string
  caption: string | null
  media_url: string | null
  thumbnail_url: string | null
  permalink: string | null
  transcript: string | null
  ai_analysis: ReelAnalysis | null
  published_at: string | null
}

// Genera (transcripción + guión adaptado + idea de carrusel) para UN candidato de
// ig_competitor_media y hace upsert en reel_drafts. Nunca lanza: si algo falla,
// guarda la fila con gen_error para que se pueda regenerar luego.
// tenantId es opcional para no romper la firma del caller manual en
// app/api/${tenant}/evergreen/reels/[id]/route.ts (fuera del alcance de este lote); el cron de
// abajo SIEMPRE lo pasa, y con él estampa/filtra tenant_id en cada lectura/escritura.
export async function generateDraftForMedia(
  sb: SupabaseClient,
  media: CompetitorMediaRow,
  accountUsername: string,
  draftId?: string,
  tenantId?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    let transcript = media.transcript || ''
    if (!transcript) {
      if (!media.media_url) throw new Error('Este contenido no tiene vídeo descargable')
      transcript = await transcribeMediaUrl(media.media_url)
      let q = sb.from('ig_competitor_media').update({ transcript }).eq('id', media.id)
      if (tenantId) q = q.eq('tenant_id', tenantId)
      await q
    }

    const [styleBlock, businessContext] = await Promise.all([readStylePrompt(), readBusinessContext()])
    const draft = await generateScript(
      { transcript, caption: media.caption || undefined, analysis: media.ai_analysis || null },
      undefined,
      { businessContext, ctasBlock: ctasForPrompt(), forcedCta: DEFAULT_CTA, styleBlock: styleBlock || undefined }
    )
    const adaptedScript = `HOOK: ${draft.hook}\n\n${draft.script}\n\nCAPTION: ${draft.caption}`
    const carouselIdea = await generateCarouselIdea(adaptedScript, draft.hook).catch(() => '')

    const row = {
      ...(tenantId ? { tenant_id: tenantId } : {}),
      source_media_id: media.id,
      source_permalink: media.permalink,
      source_account: accountUsername,
      thumbnail_url: media.thumbnail_url,
      caption: media.caption,
      transcript,
      adapted_script: adaptedScript,
      carousel_idea: carouselIdea || null,
      status: 'pendiente' as const,
      gen_error: null,
      draft_day: new Date().toISOString().slice(0, 10),
    }

    if (draftId) {
      let q = sb.from('reel_drafts').update(row).eq('id', draftId)
      if (tenantId) q = q.eq('tenant_id', tenantId)
      await q
    } else {
      await sb.from('reel_drafts').upsert(row, { onConflict: 'source_media_id' })
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (draftId) {
      let q = sb.from('reel_drafts').update({ gen_error: msg }).eq('id', draftId)
      if (tenantId) q = q.eq('tenant_id', tenantId)
      await q
    } else {
      await sb.from('reel_drafts').upsert(
        {
          ...(tenantId ? { tenant_id: tenantId } : {}),
          source_media_id: media.id,
          source_permalink: media.permalink,
          source_account: accountUsername,
          thumbnail_url: media.thumbnail_url,
          caption: media.caption,
          status: 'pendiente' as const,
          gen_error: msg,
          draft_day: new Date().toISOString().slice(0, 10),
        },
        { onConflict: 'source_media_id' }
      )
    }
    return { ok: false, error: msg }
  }
}

// Genera hasta DAILY_CAP borradores para UNA subcuenta (todas las lecturas/escrituras
// van filtradas/estampadas por tenant_id). startedAt/deadline se comparten entre
// subcuentas para respetar el presupuesto de tiempo global de la ejecución.
async function runForTenant(
  sb: SupabaseClient,
  tenantId: string,
  startedAt: number
): Promise<{ created: number; skipped: number; errors: number; note?: string }> {
  const today = new Date().toISOString().slice(0, 10)

  const { count: todaysCount } = await sb
    .from('reel_drafts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('draft_day', today)

  const remaining = DAILY_CAP - (todaysCount || 0)
  if (remaining <= 0) {
    return { created: 0, skipped: 0, errors: 0, note: 'daily cap reached' }
  }

  // Candidatos: media de competencia (de esta subcuenta) que aún no tiene borrador, más reciente primero.
  const { data: existingIds } = await sb.from('reel_drafts').select('source_media_id').eq('tenant_id', tenantId)
  const excluded = (existingIds || []).map((r) => r.source_media_id).filter(Boolean) as string[]

  let query = sb
    .from('ig_competitor_media')
    .select('id, competitor_id, caption, media_url, thumbnail_url, permalink, transcript, ai_analysis, published_at')
    .eq('tenant_id', tenantId)
    .order('published_at', { ascending: false })
    .limit(remaining)
  if (excluded.length) query = query.not('id', 'in', `(${excluded.join(',')})`)

  const { data: candidates, error: candErr } = await query
  if (candErr) throw new Error(candErr.message)
  if (!candidates || candidates.length === 0) {
    return { created: 0, skipped: 0, errors: 0, note: 'no hay reels nuevos de competencia' }
  }

  // Mapa competitor_id → username, para etiquetar el origen.
  const compIds = Array.from(new Set(candidates.map((c) => c.competitor_id)))
  const { data: comps } = await sb.from('ig_competitors').select('id, username').eq('tenant_id', tenantId).in('id', compIds)
  const usernameOf = new Map((comps || []).map((c) => [c.id, c.username as string]))

  let created = 0
  let errors = 0
  let skipped = 0

  for (const candidate of candidates as CompetitorMediaRow[]) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      // Sin presupuesto de tiempo: deja un esqueleto para regenerar en la próxima pasada.
      await sb.from('reel_drafts').upsert(
        {
          tenant_id: tenantId,
          source_media_id: candidate.id,
          source_permalink: candidate.permalink,
          source_account: usernameOf.get(candidate.competitor_id) || null,
          thumbnail_url: candidate.thumbnail_url,
          caption: candidate.caption,
          status: 'pendiente' as const,
          gen_error: 'pendiente de generar',
          draft_day: today,
        },
        { onConflict: 'source_media_id' }
      )
      skipped++
      continue
    }
    const result = await generateDraftForMedia(sb, candidate, usernameOf.get(candidate.competitor_id) || '', undefined, tenantId)
    if (result.ok) created++
    else errors++
  }

  return { created, skipped, errors }
}

// Cron diario → mina ~5 reels/día de las cuentas de competencia ya vigiladas
// (ig_competitor_media) y genera un borrador adaptado por cada uno. "Todo y decido
// yo": no hay filtro de viral-score, se coge lo más reciente sin borrador aún.
// Inyecta Authorization: Bearer CRON_SECRET (igual que el resto de crons).
// Vercel Cron pega a una única URL estática, así que este handler recorre TODAS las
// subcuentas activas y corre la generación una vez por cada una, compartiendo el
// presupuesto de tiempo (TIME_BUDGET_MS) entre todas.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const startedAt = Date.now()
  const sb = svc()

  try {
    const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
    if (tenantsErr) return NextResponse.json({ error: tenantsErr.message }, { status: 500 })

    const perTenant: Record<string, { created: number; skipped: number; errors: number; note?: string }> = {}
    for (const tn of tenants || []) {
      perTenant[tn.slug] = await runForTenant(sb, tn.id, startedAt)
    }

    return NextResponse.json({ ok: true, tenants: perTenant })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error en el cron de Reels del día' }, { status: 500 })
  }
}
