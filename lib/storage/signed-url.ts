import { createClient } from '@/lib/supabase/client'

// Los buckets de facturas y contratos son PRIVADOS: guardan datos fiscales y personales, así que
// nunca se sirven por URL pública permanente. En base de datos se guarda la RUTA del objeto y el
// enlace de descarga se firma en el momento de pulsar, con vida corta.
const DEFAULT_TTL_SECONDS = 60

// Compatibilidad con filas antiguas que guardaron una URL completa en vez de una ruta: se detecta
// y se devuelve tal cual, en vez de intentar firmarla como si fuera una ruta (que fallaría).
function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

export async function getSignedStorageUrl(
  bucket: string,
  pathOrUrl: string,
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<{ url: string | null; error: string | null }> {
  const value = pathOrUrl.trim()
  if (!value) return { url: null, error: 'No hay ningún archivo asociado' }
  if (isAbsoluteUrl(value)) return { url: value, error: null }

  const supabase = createClient()
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(value, ttlSeconds)
  if (error) return { url: null, error: error.message }
  return { url: data?.signedUrl ?? null, error: data?.signedUrl ? null : 'No se pudo firmar el enlace' }
}

// Abre el archivo en una pestaña nueva con un enlace firmado recién emitido. Se usa desde botones,
// no desde <a href>: firmar en la carga de la tabla generaría una petición por fila y dejaría
// enlaces válidos flotando en el DOM.
export async function openSignedStorageFile(
  bucket: string,
  pathOrUrl: string,
  onError?: (message: string) => void
): Promise<void> {
  const { url, error } = await getSignedStorageUrl(bucket, pathOrUrl)
  if (!url) {
    onError?.(error || 'No se pudo abrir el archivo')
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
