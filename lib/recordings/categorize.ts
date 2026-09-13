// Categoría de un archivo subido al banco, DERIVADA DEL TIPO MIME. No de la IA, y tampoco de la
// extensión del nombre: la extensión la escribe quien sube el archivo y se puede renombrar un .exe
// a .mp3. El MIME lo determina el navegador a partir del contenido.
//
// Lo pedía el brief explícitamente ("categoría por MIME, no IA") y tiene razón: para saber si un
// archivo es audio o vídeo no hace falta un modelo, y usar uno introduce un coste, una latencia y
// un error donde no había ninguno.

export type RecordingCategory = 'audio' | 'video' | 'transcripcion' | 'documento'

/** Tipos que el banco acepta. Cualquier otro se rechaza en la subida, no se guarda "por si acaso". */
const ALLOWED: Array<{ prefix?: string; exact?: string[]; category: RecordingCategory }> = [
  { prefix: 'audio/', category: 'audio' },
  { prefix: 'video/', category: 'video' },
  { exact: ['text/plain', 'text/vtt', 'application/x-subrip'], category: 'transcripcion' },
  { exact: ['application/pdf'], category: 'documento' },
]

export function categorizeByMime(mimeType: string | null | undefined): RecordingCategory | null {
  const mime = (mimeType || '').trim().toLowerCase().split(';')[0]
  if (!mime) return null
  for (const rule of ALLOWED) {
    if (rule.prefix && mime.startsWith(rule.prefix)) return rule.category
    if (rule.exact?.includes(mime)) return rule.category
  }
  return null
}

export function isAcceptedMime(mimeType: string | null | undefined): boolean {
  return categorizeByMime(mimeType) !== null
}

export const CATEGORY_LABELS: Record<RecordingCategory, string> = {
  audio: 'Audio',
  video: 'Vídeo',
  transcripcion: 'Transcripción',
  documento: 'Documento',
}
