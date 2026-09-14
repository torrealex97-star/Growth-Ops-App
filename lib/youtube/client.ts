// Cliente de la YouTube Data API v3 para espejar reels propios de Instagram como Shorts.
// Requiere credenciales OAuth de un canal de YouTube (no API key: subir vídeo exige un usuario
// autorizado). Ver README de configuración en el mensaje de setup — variables:
//   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
import { google } from 'googleapis'
import { Readable } from 'stream'

/**
 * Credenciales de YouTube de UNA subcuenta. Explícitas, como en Meta e Instagram: leerlas de
 * `process.env` significaba subir los reels de una subcuenta al canal de otra (lo que hubiera dejado
 * ahí la última llamada a `ensureConfig`), o no subir nada en una lambda recién arrancada aunque las
 * credenciales estuvieran guardadas en Integraciones.
 */
export type YoutubeEnv = {
  YOUTUBE_CLIENT_ID?: string
  YOUTUBE_CLIENT_SECRET?: string
  YOUTUBE_REFRESH_TOKEN?: string
}

export function isYoutubeConfigured(env: YoutubeEnv): boolean {
  return !!(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && env.YOUTUBE_REFRESH_TOKEN)
}

function getAuthClient(env: YoutubeEnv) {
  const oauth2Client = new google.auth.OAuth2(
    env.YOUTUBE_CLIENT_ID,
    env.YOUTUBE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground' // redirect_uri: solo se usa para el refresh, no hace falta que sea real
  )
  oauth2Client.setCredentials({ refresh_token: env.YOUTUBE_REFRESH_TOKEN })
  return oauth2Client
}

export type YoutubeUploadResult = { videoId: string; url: string }

// Descarga el vídeo (media_url de Instagram, con expiración) y lo sube a YouTube como Short.
export async function uploadReelToYoutube(
  videoUrl: string,
  title: string,
  description: string,
  env: YoutubeEnv
): Promise<YoutubeUploadResult> {
  if (!isYoutubeConfigured(env))
    throw new Error('Faltan credenciales de YouTube (YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN)')

  // Timeout: es una descarga de vídeo, así que es holgado — pero sin ninguno, un CDN colgado
  // bloquea la subida y el backfill se queda a medias sin decir por qué.
  const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) })
  if (!videoRes.ok || !videoRes.body) throw new Error(`No se pudo descargar el vídeo de Instagram (${videoRes.status})`)
  const buffer = Buffer.from(await videoRes.arrayBuffer())

  const youtube = google.youtube({ version: 'v3', auth: getAuthClient(env) })
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title.slice(0, 100),
        description: `${description}\n\n#Shorts`.slice(0, 4900),
        categoryId: '22', // People & Blogs
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    },
    media: { body: Readable.from(buffer) },
  })

  const videoId = res.data.id
  if (!videoId) throw new Error('YouTube no devolvió el id del vídeo subido')
  return { videoId, url: `https://youtube.com/shorts/${videoId}` }
}

export type YoutubeVideoStats = { videoId: string; views: number; likes: number; comments: number }

// Estadísticas actuales de vídeos ya subidos, para reflejarlas en la app junto a las de Instagram.
// La API acepta hasta 50 ids por llamada.
export async function fetchVideoStats(videoIds: string[], env: YoutubeEnv): Promise<YoutubeVideoStats[]> {
  if (!isYoutubeConfigured(env) || videoIds.length === 0) return []
  const youtube = google.youtube({ version: 'v3', auth: getAuthClient(env) })
  const out: YoutubeVideoStats[] = []
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    const res = await youtube.videos.list({ part: ['statistics'], id: batch })
    for (const item of res.data.items ?? []) {
      if (!item.id) continue
      out.push({
        videoId: item.id,
        views: Number(item.statistics?.viewCount ?? 0),
        likes: Number(item.statistics?.likeCount ?? 0),
        comments: Number(item.statistics?.commentCount ?? 0),
      })
    }
  }
  return out
}
