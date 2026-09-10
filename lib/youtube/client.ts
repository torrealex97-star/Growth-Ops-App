// Cliente de la YouTube Data API v3 para espejar reels propios de Instagram como Shorts.
// Requiere credenciales OAuth de un canal de YouTube (no API key: subir vídeo exige un usuario
// autorizado). Ver README de configuración en el mensaje de setup — variables:
//   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
import { google } from 'googleapis'
import { Readable } from 'stream'

export function isYoutubeConfigured(): boolean {
  return !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN)
}

function getAuthClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground' // redirect_uri: solo se usa para el refresh, no hace falta que sea real
  )
  oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN })
  return oauth2Client
}

export type YoutubeUploadResult = { videoId: string; url: string }

// Descarga el vídeo (media_url de Instagram, con expiración) y lo sube a YouTube como Short.
export async function uploadReelToYoutube(
  videoUrl: string,
  title: string,
  description: string
): Promise<YoutubeUploadResult> {
  if (!isYoutubeConfigured()) throw new Error('Faltan credenciales de YouTube (YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN)')

  const videoRes = await fetch(videoUrl)
  if (!videoRes.ok || !videoRes.body) throw new Error(`No se pudo descargar el vídeo de Instagram (${videoRes.status})`)
  const buffer = Buffer.from(await videoRes.arrayBuffer())

  const youtube = google.youtube({ version: 'v3', auth: getAuthClient() })
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
export async function fetchVideoStats(videoIds: string[]): Promise<YoutubeVideoStats[]> {
  if (!isYoutubeConfigured() || videoIds.length === 0) return []
  const youtube = google.youtube({ version: 'v3', auth: getAuthClient() })
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
