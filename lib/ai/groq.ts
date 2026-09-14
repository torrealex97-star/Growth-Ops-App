// Transcripción de audio/vídeo con Groq Whisper — implementación ÚNICA.
//
// POR QUÉ EXISTE. Esta misma función estaba copiada tres veces (borradores de reels, análisis de
// llamadas y transcripción de reels propios) con tres variantes distintas: una con timeout y dos
// sin él, y dos listas de extensiones diferentes. Tres copias de una operación es tres sitios donde
// arreglar el mismo bug y dos que se olvidan.
//
// La clave llega como argumento (la de la subcuenta): leerla de `process.env` significaba que la
// GROQ_API_KEY guardada en Configuración › Integraciones no se usaba nunca, y que el gasto de una
// subcuenta podía cargarse a la cuenta de otra.

/** 25 MB: tope del tier gratuito de Groq. */
export const GROQ_LIMIT_BYTES = 25 * 1024 * 1024

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3-turbo'

function extensionFor(mime: string): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('mp4') || m.includes('video')) return 'mp4'
  if (m.includes('wav')) return 'wav'
  if (m.includes('m4a')) return 'm4a'
  return 'mp3'
}

export async function transcribeAudio(
  buf: Buffer,
  mime: string,
  apiKey: string | undefined,
  opts: { filename?: string; language?: string; timeoutMs?: number } = {}
): Promise<string> {
  const key = apiKey?.trim()
  if (!key) throw new Error('Falta la API Key de Groq en Configuración › Integraciones')
  if (buf.byteLength > GROQ_LIMIT_BYTES) {
    throw new Error(`El archivo pesa ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB y supera el límite de 25MB`)
  }
  const form = new FormData()
  const base = opts.filename || 'audio'
  form.append('file', new Blob([new Uint8Array(buf)], { type: mime || 'video/mp4' }), `${base}.${extensionFor(mime)}`)
  form.append('model', MODEL)
  form.append('language', opts.language || 'es')
  form.append('response_format', 'json')
  // Timeout generoso (transcribir tarda) pero acotado: sin él, un Groq colgado se come la ventana
  // entera de la función y no se genera nada.
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  })
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { text?: string }
  return data.text || ''
}
