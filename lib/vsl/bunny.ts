import { createHash } from 'node:crypto'

// BUNNY STREAM — alojamiento de los vídeos de VSL.
//
// POR QUÉ BUNNY Y NO VERCEL BLOB. Un VSL se reproduce miles de veces: servir un .mp4 de 500 MB desde
// un almacén de ficheros cobra cada byte y no adapta la calidad a la conexión. Bunny Stream recodifica
// el vídeo a HLS (varias calidades, la del espectador se elige sola) y lo sirve desde su CDN.
//
// CÓMO SE SUBE SIN EXPONER LA CLAVE. La API key de Bunny da control total sobre la biblioteca, así que
// nunca sale del servidor. El flujo que documenta Bunny (bunny.net/docs/stream/tus-resumable-uploads):
//   1. El servidor crea el objeto vídeo (POST /library/{id}/videos) y obtiene su id.
//   2. El servidor firma una subida: SHA256(libraryId + apiKey + expiración + videoId).
//   3. El navegador sube el fichero DIRECTO a Bunny por TUS con esa firma. Se salta así el límite de
//      4,5 MB de las funciones de Vercel, y la subida se reanuda sola si se corta la conexión.
// La firma solo vale para ESE vídeo y caduca: si se filtra, no sirve para nada más.
//
// Este módulo separa lo puro (firma, URLs, validación) de las dos llamadas de red, para probar lo
// primero sin red ni credenciales.

export const BUNNY_API = 'https://video.bunnycdn.com'
export const BUNNY_TUS_ENDPOINT = `${BUNNY_API}/tusupload`

/** Cuánto vale una firma de subida. Un VSL grande con mala conexión tarda: margen de sobra. */
export const FIRMA_VALIDEZ_S = 6 * 60 * 60

export type BunnyConfig = { libraryId: string; apiKey: string; cdnHostname: string }

/** Firma de subida TUS, en el orden exacto que exige Bunny. */
export function firmaSubidaBunny(libraryId: string, apiKey: string, expiraEn: number, videoId: string): string {
  return createHash('sha256').update(`${libraryId}${apiKey}${expiraEn}${videoId}`).digest('hex')
}

/**
 * El hostname de la zona de vídeo, limpio. La gente lo pega de mil formas —con `https://`, con la
 * barra final, con una ruta de ejemplo detrás— y cualquiera de ellas rompería las URLs en silencio.
 * Devuelve null si lo que queda no parece un hostname.
 */
export function normalizarHostBunny(entrada: string | undefined | null): string | null {
  const limpio = (entrada ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase()
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(limpio) ? limpio : null
}

/** Las URLs con las que el reproductor carga un vídeo ya procesado. */
export function urlsVideoBunny(cdnHostname: string, videoId: string, thumbnailFileName = 'thumbnail.jpg') {
  const base = `https://${cdnHostname}/${videoId}`
  return { playlist: `${base}/playlist.m3u8`, miniatura: `${base}/${thumbnailFileName}` }
}

/** Qué falta para poder subir, en palabras de la pantalla. Vacío = configurada. */
export function faltaEnConfigBunny(cfg: Record<string, string | undefined>): string[] {
  const falta: string[] = []
  if (!cfg.BUNNY_STREAM_LIBRARY_ID?.trim()) falta.push('el ID de la biblioteca')
  if (!cfg.BUNNY_STREAM_API_KEY?.trim()) falta.push('la API key de la biblioteca')
  if (!normalizarHostBunny(cfg.BUNNY_STREAM_CDN_HOSTNAME)) falta.push('el hostname de la CDN')
  return falta
}

export function configBunny(cfg: Record<string, string | undefined>): BunnyConfig | null {
  if (faltaEnConfigBunny(cfg).length) return null
  return {
    libraryId: cfg.BUNNY_STREAM_LIBRARY_ID!.trim(),
    apiKey: cfg.BUNNY_STREAM_API_KEY!.trim(),
    cdnHostname: normalizarHostBunny(cfg.BUNNY_STREAM_CDN_HOSTNAME)!,
  }
}

/** Traduce el estado HTTP de Bunny a una causa que se pueda arreglar. */
export function causaErrorBunny(status: number): string {
  if (status === 401 || status === 403) {
    return 'Bunny rechaza la API key. Tiene que ser la de la BIBLIOTECA (Stream › tu biblioteca › API), no la de la cuenta.'
  }
  if (status === 404) return 'Bunny no encuentra esa biblioteca: revisa el ID de la biblioteca.'
  if (status === 429) return 'Bunny está limitando las peticiones. Espera un minuto y vuelve a probar.'
  return `Bunny respondió con un error (${status}).`
}

const TIMEOUT_MS = 10_000

/** Crea el objeto vídeo en la biblioteca. Es el paso previo obligatorio a la subida TUS. */
export async function crearVideoBunny(
  c: BunnyConfig,
  titulo: string
): Promise<{ videoId: string } | { error: string }> {
  const r = await fetch(`${BUNNY_API}/library/${encodeURIComponent(c.libraryId)}/videos`, {
    method: 'POST',
    headers: { AccessKey: c.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ title: titulo.slice(0, 200) || 'VSL' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!r.ok) return { error: causaErrorBunny(r.status) }
  const j = (await r.json().catch(() => ({}))) as { guid?: string }
  return j.guid ? { videoId: j.guid } : { error: 'Bunny no devolvió el identificador del vídeo.' }
}

/** Comprobación de conexión: lista un vídeo de la biblioteca. Solo lee. */
export async function probarBunny(c: BunnyConfig): Promise<{ ok: boolean; message: string; status?: number }> {
  const r = await fetch(`${BUNNY_API}/library/${encodeURIComponent(c.libraryId)}/videos?page=1&itemsPerPage=1`, {
    headers: { AccessKey: c.apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!r.ok) return { ok: false, message: causaErrorBunny(r.status), status: r.status }
  const j = (await r.json().catch(() => ({}))) as { totalItems?: number }
  const n = j.totalItems ?? 0
  return { ok: true, message: `Biblioteca conectada: ${n} ${n === 1 ? 'vídeo' : 'vídeos'}.` }
}
