import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { analyzeReel } from '@/lib/ai/claude'
import { getInstagramConfig, resolveIgUserId, refreshOwnMediaUrl, fetchBusinessDiscovery } from '@/lib/instagram/client'

export const runtime = 'nodejs'
export const maxDuration = 300

const GROQ_LIMIT_BYTES = 25 * 1024 * 1024 // 25MB (tier gratuito Groq)
const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing', 'editor']
const VIDEO_BUCKET = 'ig-competitor-reels'

// Sube el vídeo ya descargado a Storage propio y devuelve su URL pública, para
// que deje de depender de la URL firmada de Meta (caduca / cae fuera de la
// ventana de los 50 posts más recientes). Best-effort: si falla, no rompe la
// transcripción, solo no queda protegido para el futuro.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function persistToStorage(sb: any, table: string, rowId: string, buf: Buffer, mime: string): Promise<string | null> {
  try {
    const ext = mime.includes('mp4') || mime.includes('video') ? 'mp4' : 'bin'
    const path = `${table}/${rowId}.${ext}`
    let up = await sb.storage.from(VIDEO_BUCKET).upload(path, buf, { contentType: mime || 'video/mp4', upsert: true })
    if (up.error && /bucket.*not.*found|not found/i.test(up.error.message)) {
      await sb.storage.createBucket(VIDEO_BUCKET, { public: true })
      up = await sb.storage.from(VIDEO_BUCKET).upload(path, buf, { contentType: mime || 'video/mp4', upsert: true })
    }
    if (up.error) { console.error('[transcribe] persistToStorage:', up.error.message); return null }
    return sb.storage.from(VIDEO_BUCKET).getPublicUrl(path).data.publicUrl
  } catch (e) {
    console.error('[transcribe] persistToStorage falló:', e instanceof Error ? e.message : e)
    return null
  }
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

// Transcribe un reel (baja su media_url → Groq Whisper) y lo analiza con Claude
// (hook / estructura / por qué funciona). Tres modos:
//   { mediaId }            → reel propio en ig_media (guarda transcript+ai_analysis)
//   { competitorMediaId }  → reel de competencia en ig_competitor_media
//   { mediaUrl, caption }  → URL suelta (no persiste; devuelve transcript+analysis)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { mediaId, competitorMediaId, mediaUrl, caption } = body as {
      mediaId?: string; competitorMediaId?: string; mediaUrl?: string; caption?: string
    }
    if (!mediaId && !competitorMediaId && !mediaUrl) {
      return NextResponse.json({ error: 'Falta mediaId, competitorMediaId o mediaUrl' }, { status: 400 })
    }

    // Auth por sesión (rol marketing/dirección/editor)
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
    if (!role || !ALLOWED_ROLES.includes(role)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    // Resuelve el origen: tabla, url del vídeo, transcript ya existente y contexto.
    let table: 'ig_media' | 'ig_competitor_media' | null = null
    let rowId = ''
    let url = mediaUrl || ''
    let existingTranscript = ''
    let ctx: { caption?: string; views?: number; saves?: number; engagement?: number } = { caption }
    let externalId = ''
    let competitorUsername = ''
    let competitorPermalink = ''

    if (mediaId) {
      table = 'ig_media'; rowId = mediaId
      const { data, error } = await sb.from('ig_media').select('id, external_id, media_url, caption, transcript, views, saved, engagement_rate').eq('id', mediaId).single()
      if (error || !data) return NextResponse.json({ error: 'Reel no encontrado' }, { status: 404 })
      url = data.media_url || ''
      externalId = data.external_id || ''
      existingTranscript = data.transcript || ''
      ctx = { caption: data.caption || undefined, views: data.views ?? undefined, saves: data.saved ?? undefined, engagement: data.engagement_rate ?? undefined }
    } else if (competitorMediaId) {
      table = 'ig_competitor_media'; rowId = competitorMediaId
      const { data, error } = await sb.from('ig_competitor_media').select('id, external_id, media_url, permalink, caption, transcript, like_count, comments_count, ig_competitors(username)').eq('id', competitorMediaId).single()
      if (error || !data) return NextResponse.json({ error: 'Reel de competencia no encontrado' }, { status: 404 })
      url = data.media_url || ''
      externalId = data.external_id || ''
      competitorPermalink = data.permalink || ''
      competitorUsername = (data.ig_competitors as { username?: string } | null)?.username || ''
      existingTranscript = data.transcript || ''
      ctx = { caption: data.caption || undefined }
    }

    const setStatus = async (status: string) => { if (table === 'ig_media') await sb.from('ig_media').update({ transcript_status: status }).eq('id', rowId) }

    // Pide a Meta una media_url fresca (las URLs firmadas de la CDN caducan a las
    // pocas horas, y si el sync guardó null en su momento la BD nunca la tuvo).
    // reason distingue dos causas MUY distintas de fallo:
    //  - 'not_in_recent': el post ya no está entre los últimos 50 del competidor.
    //  - 'no_media_url': el post SIGUE entre los 50 (mismo external_id/permalink),
    //    pero Business Discovery no devuelve su media_url. Comprobado empíricamente
    //    (2026-08-13, @nateherkai): es consistente y no depende de reintentar ni de
    //    la antigüedad del post — Meta simplemente no expone el vídeo para la mayoría
    //    de los Reels de terceros vía esta API. No es "recuperable" reintentando.
    const tryRefresh = async (): Promise<{ url: string | null; reason: 'not_in_recent' | 'no_media_url' | null }> => {
      if (!externalId) return { url: null, reason: null }
      try {
        const cfg = getInstagramConfig()
        if (!cfg) {
          console.error('[transcribe] refresh: sin credenciales de Instagram (getInstagramConfig null)')
          return { url: null, reason: null }
        }
        if (table === 'ig_media') {
          const fresh = await refreshOwnMediaUrl(cfg, externalId)
          if (fresh) {
            await sb.from(table).update({ media_url: fresh }).eq('id', rowId)
            return { url: fresh, reason: null }
          }
          console.error('[transcribe] refresh: Meta no devolvió media_url para el reel propio', { externalId })
          return { url: null, reason: null }
        }
        if (table === 'ig_competitor_media' && competitorUsername) {
          const { id: igUserId } = await resolveIgUserId(cfg)
          const { media: recent } = await fetchBusinessDiscovery(cfg, igUserId, competitorUsername, 50)
          // El id numérico que devuelve business_discovery no siempre es estable
          // entre llamadas para el mismo contenido, así que además de comparar por
          // external_id probamos por el shortcode del permalink (más fiable; es lo
          // que ya usa el endpoint de sync de competidores para el modo "por enlace").
          const shortcode = competitorPermalink.match(/\/(?:reel|p|reels|tv)\/([^/]+)/)?.[1]
          const hit = recent.find((m) => m.external_id === externalId)
            || (shortcode ? recent.find((m) => (m.permalink || '').includes(`/${shortcode}`)) : undefined)
          if (hit?.media_url) {
            // Si el id cambió respecto al guardado, actualizamos external_id también
            // para que futuras comparaciones directas ya no dependan del permalink.
            await sb.from(table).update({ media_url: hit.media_url, external_id: hit.external_id }).eq('id', rowId)
            return { url: hit.media_url, reason: null }
          }
          console.error('[transcribe] refresh: sin media_url para este reel de competencia', {
            externalId, competitorUsername, competitorPermalink, recentCount: recent.length,
            foundAmongRecent: !!hit,
            recentIds: recent.map((m) => ({ id: m.external_id, ts: m.timestamp, permalink: m.permalink })),
          })
          return { url: null, reason: hit ? 'no_media_url' : 'not_in_recent' }
        }
        console.error('[transcribe] refresh: sin competitorUsername o tabla no soportada', { table, competitorUsername, externalId })
        return { url: null, reason: null }
      } catch (e) {
        console.error('[transcribe] refresh media_url falló:', e instanceof Error ? e.message : e)
        return { url: null, reason: null }
      }
    }

    const refreshFailMessage = (reason: 'not_in_recent' | 'no_media_url' | null) =>
      reason === 'no_media_url'
        ? 'Instagram no entrega el vídeo de este reel a través de la API (pasa con muchos Reels de terceros, no es un fallo nuestro ni depende de reintentar). Prueba con otro reel del mismo competidor.'
        : 'Este reel ya no está entre los 50 más recientes del competidor: Instagram no permite recuperar su vídeo. Elige un reel más reciente.'

    let transcript = existingTranscript
    if (!transcript) {
      let refreshReason: 'not_in_recent' | 'no_media_url' | null = null
      if (!url) {
        // Antes de asumir "carrusel/imagen", intentamos refrescar: si Meta devuelve
        // media_url para este reel, sí es descargable y el problema era solo caché.
        const refreshed = await tryRefresh()
        if (refreshed.url) {
          url = refreshed.url
        } else if (refreshed.reason) {
          await setStatus('error')
          return NextResponse.json({ error: refreshFailMessage(refreshed.reason) }, { status: 410 })
        } else {
          await setStatus('no_aplica')
          return NextResponse.json({ error: 'Este contenido no tiene vídeo descargable (¿carrusel/imagen?).' }, { status: 400 })
        }
      }
      await setStatus('procesando')
      let r = await fetch(url)
      if (!r.ok) {
        const refreshed = await tryRefresh()
        if (refreshed.url) {
          url = refreshed.url
          r = await fetch(url)
        } else {
          refreshReason = refreshed.reason
        }
      }
      if (!r.ok) {
        await setStatus('error')
        const error = refreshReason
          ? refreshFailMessage(refreshReason)
          : 'El enlace del vídeo ha caducado y no se pudo renovar. Vuelve a sincronizar y reintenta.'
        return NextResponse.json({ error }, { status: 410 })
      }
      const buf = Buffer.from(await r.arrayBuffer())
      const mime = r.headers.get('content-type') || 'video/mp4'
      if (buf.byteLength > GROQ_LIMIT_BYTES) {
        await setStatus('error')
        return NextResponse.json({
          error: `El vídeo pesa ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB y supera el límite de 25MB de la transcripción gratuita.`,
        }, { status: 413 })
      }
      // Ya lo tenemos descargado: lo guardamos en Storage propio para que este
      // reel no vuelva a depender de la URL de Meta (evita el error "ya no está
      // entre los 50 más recientes" en futuras transcripciones/re-análisis).
      if (table) {
        const persisted = await persistToStorage(sb, table, rowId, buf, mime)
        if (persisted) await sb.from(table).update({ media_url: persisted }).eq('id', rowId)
      }
      transcript = await transcribeGroq(buf, mime)
    }

    if (!transcript || transcript.trim().length < 10) {
      await setStatus('error')
      return NextResponse.json({ error: 'No se pudo extraer texto del reel (¿sin voz?).' }, { status: 422 })
    }

    // La transcripción (Groq) ya está lista; si el análisis de Claude falla (p.ej.
    // "overloaded_error" 529 en picos de carga de Anthropic, ya reintentado varias
    // veces por el SDK), guardamos igualmente el transcript para no perder el
    // trabajo hecho: el usuario podrá pulsar "reintentar análisis" sin tener que
    // volver a descargar/transcribir el vídeo.
    let analysis: Awaited<ReturnType<typeof analyzeReel>>
    try {
      analysis = await analyzeReel(transcript, ctx)
    } catch (e) {
      if (table === 'ig_media') {
        await sb.from('ig_media').update({ transcript, transcript_status: 'listo' }).eq('id', rowId)
      } else if (table === 'ig_competitor_media') {
        await sb.from('ig_competitor_media').update({ transcript }).eq('id', rowId)
      }
      const raw = e instanceof Error ? e.message : String(e)
      const overloaded = /overloaded/i.test(raw)
      return NextResponse.json({
        error: overloaded
          ? 'Claude está saturado en este momento (alta demanda). La transcripción se ha guardado; vuelve a intentarlo en 1-2 minutos para generar el análisis.'
          : `La transcripción se ha guardado, pero el análisis con IA falló: ${raw}`,
        transcript,
      }, { status: 503 })
    }
    const analyzedAt = new Date().toISOString()

    if (table === 'ig_media') {
      await sb.from('ig_media').update({ transcript, transcript_status: 'listo', ai_analysis: analysis, ai_analyzed_at: analyzedAt }).eq('id', rowId)
    } else if (table === 'ig_competitor_media') {
      await sb.from('ig_competitor_media').update({ transcript, ai_analysis: analysis }).eq('id', rowId)
    }

    return NextResponse.json({ ok: true, transcript, analysis })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
