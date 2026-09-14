// Generación de borradores de reel a partir de un vídeo de la competencia.
//
// POR QUÉ ESTÁ AQUÍ Y NO EN LA RUTA DE CRON. `generateDraftForMedia` vivía exportada desde
// `app/api/.../cron/reels/route.ts`, y otra ruta la importaba desde ahí. Next.js solo admite
// determinados exports en un `route.ts` (los verbos HTTP y su configuración), así que ese export
// rompía el build en cuanto la validación de rutas lo miraba. La lógica no era de la ruta: es de
// negocio, y las dos rutas la usan.
import type { SupabaseClient } from '@supabase/supabase-js'
import { transcribeAudio } from '@/lib/ai/groq'
import { generateScript, type ReelAnalysis } from '@/lib/ai/claude'
import { tenantAiEnv } from '@/lib/ai/provider'
import { readStylePrompt, readBusinessContext } from '@/lib/app-settings'
import { ctasForPrompt } from '@/lib/ctas'

export type CompetitorMediaRow = {
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

const DEFAULT_CTA = 'CLASE'
// Descarga el media_url y lo transcribe con Groq Whisper. Lanza si no hay vídeo
// o si supera el límite gratuito de 25MB.
async function transcribeMediaUrl(mediaUrl: string, groqKey: string | undefined): Promise<string> {
  const r = await fetch(mediaUrl, { signal: AbortSignal.timeout(45_000) })
  if (!r.ok) throw new Error('El enlace del vídeo ha caducado (vuelve a sincronizar Competencia)')
  const buf = Buffer.from(await r.arrayBuffer())
  const mime = r.headers.get('content-type') || 'video/mp4'
  const transcript = await transcribeAudio(buf, mime, groqKey, { filename: 'reel' })
  if (!transcript || transcript.trim().length < 10) throw new Error('No se pudo extraer texto del reel (¿sin voz?)')
  return transcript
}

// Idea corta de carrusel/flyer (2-3 slides: portada / desarrollo / CTA) a partir
// del guión adaptado. Va por el motor configurado, igual que generateScript: no tiene sentido que
// dos pasos del mismo flujo los atienda un motor distinto.
async function generateCarouselIdea(adaptedScript: string, hook: string, tenantId: string): Promise<string> {
  const { completeText } = await import('@/lib/ai/provider')
  const { text } = await completeText(
    {
      system: `Eres el diseñador de contenido de la marca. A partir de un guión de reel, propones una idea CORTA de carrusel/flyer (2-3 slides) que transmita la misma idea en formato estático para Instagram.
Responde en español, en texto plano (sin JSON), con este formato exacto:
Slide 1 (portada): ...
Slide 2 (desarrollo): ...
Slide 3 (CTA): ...
Sé concreto y breve (una frase por slide).`,
      user: `Hook: ${hook}\n\nGuión adaptado:\n${adaptedScript.slice(0, 3000)}`,
      maxTokens: 400,
    },
    await tenantAiEnv(tenantId)
  )
  return text.trim()
}

// Genera (transcripción + guión adaptado + idea de carrusel) para UN candidato de
// ig_competitor_media y hace upsert en reel_drafts. Nunca lanza: si algo falla,
// guarda la fila con gen_error para que se pueda regenerar luego.
export async function generateDraftForMedia(
  sb: SupabaseClient,
  media: CompetitorMediaRow,
  accountUsername: string,
  draftId: string | undefined,
  tenantId: string,
  /** Clave de Groq de ESTA subcuenta (Configuración › Integraciones). */
  groqKey: string | undefined
): Promise<{ ok: boolean; error?: string }> {
  try {
    let transcript = media.transcript || ''
    if (!transcript) {
      if (!media.media_url) throw new Error('Este contenido no tiene vídeo descargable')
      transcript = await transcribeMediaUrl(media.media_url, groqKey)
      await sb.from('ig_competitor_media').update({ transcript }).eq('id', media.id).eq('tenant_id', tenantId)
    }

    const [styleBlock, businessContext] = await Promise.all([readStylePrompt(tenantId), readBusinessContext(tenantId)])
    const draft = await generateScript(
      { transcript, caption: media.caption || undefined, analysis: media.ai_analysis || null },
      undefined,
      { businessContext, ctasBlock: ctasForPrompt(), forcedCta: DEFAULT_CTA, styleBlock: styleBlock || undefined },
      await tenantAiEnv(tenantId)
    )
    const adaptedScript = `HOOK: ${draft.hook}\n\n${draft.script}\n\nCAPTION: ${draft.caption}`
    const carouselIdea = await generateCarouselIdea(adaptedScript, draft.hook, tenantId).catch(() => '')

    const row = {
      tenant_id: tenantId,
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
      await sb.from('reel_drafts').update(row).eq('id', draftId).eq('tenant_id', tenantId)
    } else {
      await sb.from('reel_drafts').upsert(row, { onConflict: 'source_media_id' })
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (draftId) {
      await sb.from('reel_drafts').update({ gen_error: msg }).eq('id', draftId).eq('tenant_id', tenantId)
    } else {
      await sb.from('reel_drafts').upsert(
        {
          tenant_id: tenantId,
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
