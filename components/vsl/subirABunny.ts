import { Upload } from 'tus-js-client'

// Subida de un VSL a Bunny Stream desde el navegador. El servidor crea el vídeo y firma la subida
// (app/api/[tenant]/evergreen/vsl/bunny); aquí solo se sube el fichero con esa firma, por TUS: si la
// conexión se corta, la subida se reanuda desde donde iba en vez de empezar de cero.

type Preparada = {
  videoId: string
  libraryId: string
  firma: string
  expiraEn: number
  tusEndpoint: string
  playlist: string
  miniatura: string
}

/** ¿Tiene esta subcuenta Bunny configurado? Si la consulta falla, se responde que no. */
export async function bunnyConfigurado(tenant: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/${tenant}/evergreen/vsl/bunny`)
    if (!r.ok) return false
    const j = (await r.json()) as { configurado?: boolean }
    return j.configurado === true
  } catch {
    return false
  }
}

export async function subirVideoABunny(
  tenant: string,
  file: File,
  alProgresar: (porcentaje: number) => void
): Promise<{ playlist: string; miniatura: string }> {
  const r = await fetch(`/api/${tenant}/evergreen/vsl/bunny`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titulo: file.name.replace(/\.[^.]+$/, '') }),
  })
  const prep = (await r.json().catch(() => ({}))) as Partial<Preparada> & { error?: string }
  if (!r.ok || !prep.videoId) throw new Error(prep.error || 'No se pudo preparar la subida a Bunny.')

  await new Promise<void>((resolve, reject) => {
    const subida = new Upload(file, {
      endpoint: prep.tusEndpoint!,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        AuthorizationSignature: prep.firma!,
        AuthorizationExpire: String(prep.expiraEn),
        VideoId: prep.videoId!,
        LibraryId: prep.libraryId!,
      },
      metadata: { filetype: file.type || 'video/mp4', title: file.name },
      onProgress: (subidos: number, total: number) => alProgresar(total ? Math.round((subidos / total) * 100) : 0),
      onError: (e: Error) => reject(new Error(`La subida a Bunny falló: ${e.message}`)),
      onSuccess: () => resolve(),
    })
    subida.start()
  })

  return { playlist: prep.playlist!, miniatura: prep.miniatura! }
}
