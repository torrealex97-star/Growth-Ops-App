import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getInstagramConfig, resolveIgUserId, fetchBusinessDiscovery } from '@/lib/instagram/client'

export const runtime = 'nodejs'
export const maxDuration = 60
const VIDEO_BUCKET = 'ig-competitor-reels'

// Descarga el vídeo del reel y lo guarda en Storage propio, devolviendo su URL
// pública. Así este reel concreto (añadido a mano por su enlace) no depende de
// la URL firmada de Meta ni de seguir estando entre los 50 más recientes.
// Best-effort: si falla, se sigue usando la media_url de Meta tal cual.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function persistReelVideo(sb: any, mediaUrl: string | null | undefined, competitorMediaExternalId: string): Promise<string | null> {
  if (!mediaUrl) return null
  try {
    const res = await fetch(mediaUrl)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const mime = res.headers.get('content-type') || 'video/mp4'
    const ext = mime.includes('mp4') || mime.includes('video') ? 'mp4' : 'bin'
    const path = `ig_competitor_media/${competitorMediaExternalId}.${ext}`
    let up = await sb.storage.from(VIDEO_BUCKET).upload(path, buf, { contentType: mime, upsert: true })
    if (up.error && /bucket.*not.*found|not found/i.test(up.error.message)) {
      await sb.storage.createBucket(VIDEO_BUCKET, { public: true })
      up = await sb.storage.from(VIDEO_BUCKET).upload(path, buf, { contentType: mime, upsert: true })
    }
    if (up.error) return null
    return sb.storage.from(VIDEO_BUCKET).getPublicUrl(path).data.publicUrl
  } catch {
    return null
  }
}

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing']

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

// GET → lista de competidores con sus reels (ordenados por engagement).
export async function GET() {
  const auth = await requireRole()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const sb = svc()
  const { data: competitors } = await sb.from('ig_competitors').select('*').order('followers_count', { ascending: false })
  const { data: media } = await sb
    .from('ig_competitor_media')
    .select('*')
    .order('engagement_proxy', { ascending: false })
  return NextResponse.json({ competitors: competitors || [], media: media || [] })
}

type CMedia = Awaited<ReturnType<typeof fetchBusinessDiscovery>>['media'][number]

// Extrae username y shortcode de una URL de reel/post de Instagram.
// Soporta /reel/CODE, /p/CODE, /USER/reel/CODE, /USER/p/CODE.
function parseReelUrl(url: string): { username?: string; shortcode?: string } {
  try {
    const u = new URL(url.trim())
    const parts = u.pathname.split('/').filter(Boolean) // ['user','reel','code'] o ['reel','code']
    const i = parts.findIndex((p) => p === 'reel' || p === 'p' || p === 'reels' || p === 'tv')
    if (i === -1) return {}
    return { username: i > 0 ? parts[i - 1] : undefined, shortcode: parts[i + 1] }
  } catch { return {} }
}

// `existingMediaUrl` preserva la media_url ya guardada (a menudo persistida en
// nuestro Storage) cuando este sync no trae una nueva: Meta devuelve media_url
// para muy pocos reels en cada llamada a business_discovery (limitación de la
// API, no es intermitencia nuestra), así que sin esto un simple "Actualizar"
// borraría vídeos ya descargados y usables.
const mapRow = (competitorId: string, m: CMedia, at: string, existingMediaUrl?: string | null) => ({
  competitor_id: competitorId,
  external_id: m.external_id,
  caption: m.caption ?? null,
  media_type: m.media_type ?? null,
  media_product_type: m.media_product_type ?? null,
  like_count: m.like_count,
  comments_count: m.comments_count,
  engagement_proxy: m.like_count + m.comments_count,
  permalink: m.permalink ?? null,
  media_url: m.media_url ?? existingMediaUrl ?? null,
  thumbnail_url: m.thumbnail_url ?? null,
  published_at: m.timestamp ?? null,
  synced_at: at,
})

// POST { username } → añade/sincroniza un competidor (sus 50 reels recientes).
// POST { reelUrl, username? } → resuelve UN reel concreto por su enlace.
export async function POST(req: NextRequest) {
  const auth = await requireRole()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json()
  const reelUrl: string | undefined = body?.reelUrl
  let username: string | undefined = body?.username

  let shortcode: string | undefined
  if (reelUrl) {
    const parsed = parseReelUrl(String(reelUrl))
    shortcode = parsed.shortcode
    username = username || parsed.username
    if (!shortcode) return NextResponse.json({ error: 'Enlace de reel no válido' }, { status: 400 })
    if (!username) return NextResponse.json({ error: 'El enlace no incluye el usuario. Añade el @usuario del reel.' }, { status: 400 })
  }
  if (!username || !String(username).trim()) return NextResponse.json({ error: 'Falta el usuario' }, { status: 400 })

  const cfg = getInstagramConfig()
  if (!cfg) return NextResponse.json({ error: 'Faltan credenciales de Instagram' }, { status: 500 })

  try {
    const { id: igUserId } = await resolveIgUserId(cfg)
    const { profile, media } = await fetchBusinessDiscovery(cfg, igUserId, String(username), 50)
    const at = new Date().toISOString()
    const sb = svc()

    // competidor: select → insert/update (el único es funcional lower(username))
    const { data: existing } = await sb.from('ig_competitors').select('id').ilike('username', profile.username).maybeSingle()
    let competitorId = existing?.id as string | undefined
    if (competitorId) {
      await sb.from('ig_competitors').update({ followers_count: profile.followers_count, media_count: profile.media_count, last_synced_at: at }).eq('id', competitorId)
    } else {
      const { data: inserted, error: insErr } = await sb
        .from('ig_competitors')
        .insert({ username: profile.username, followers_count: profile.followers_count, media_count: profile.media_count, last_synced_at: at, created_by: auth.user!.id })
        .select('id')
        .single()
      if (insErr || !inserted) return NextResponse.json({ error: insErr?.message || 'No se pudo guardar el competidor' }, { status: 500 })
      competitorId = inserted.id
    }

    // Modo "reel por enlace": localiza ese reel entre los recientes por shortcode.
    if (shortcode) {
      const hit = media.find((m) => (m.permalink || '').includes(`/${shortcode}`))
      if (!hit) return NextResponse.json({ error: `No encontré ese reel entre los 50 más recientes de @${profile.username}. Debe ser reciente y público.` }, { status: 404 })
      const { data: prev } = await sb.from('ig_competitor_media').select('media_url').eq('external_id', hit.external_id).maybeSingle()
      const persistedUrl = await persistReelVideo(sb, hit.media_url, hit.external_id)
      const row_ = mapRow(competitorId!, hit, at, prev?.media_url)
      if (persistedUrl) row_.media_url = persistedUrl
      const { data: row, error } = await sb.from('ig_competitor_media').upsert(row_, { onConflict: 'external_id', ignoreDuplicates: false }).select('id').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, competitorId, username: profile.username, competitorMediaId: row?.id, single: true })
    }

    // Modo perfil: upsert de todos los reels recientes.
    let synced = 0
    const { data: prevRows } = await sb.from('ig_competitor_media').select('external_id, media_url').eq('competitor_id', competitorId!)
    const prevMediaUrl = new Map((prevRows || []).map((r) => [r.external_id, r.media_url]))
    const rows = media.filter((m) => (m.media_product_type || m.media_type || '').toString().length > 0).map((m) => mapRow(competitorId!, m, at, prevMediaUrl.get(m.external_id)))
    if (rows.length) {
      const { error } = await sb.from('ig_competitor_media').upsert(rows, { onConflict: 'external_id', ignoreDuplicates: false })
      if (!error) synced = rows.length
    }

    // Limpieza: reels que ya no están entre los 50 más recientes de Instagram se
    // quedan con media_url caducada y sin forma de recuperarla (limitación de la
    // API). Los borramos si aún no tienen transcripción, para que no se acumulen
    // dando error "no recuperable" en la parrilla.
    const freshIds = rows.map((r) => r.external_id)
    await sb.from('ig_competitor_media').delete().eq('competitor_id', competitorId!).is('transcript', null).not('external_id', 'in', `(${freshIds.map((id) => `"${id}"`).join(',') || '""'})`)

    return NextResponse.json({ ok: true, competitorId, username: profile.username, followers: profile.followers_count, reelsSynced: synced })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error al analizar el perfil' }, { status: 500 })
  }
}

// DELETE ?id= → elimina un competidor (y sus reels por cascade).
export async function DELETE(req: NextRequest) {
  const auth = await requireRole()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })
  const { error } = await svc().from('ig_competitors').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
