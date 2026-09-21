import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const dynamic = 'force-dynamic'

// Token de subida directa a Vercel Blob (el cliente sube el fichero DIRECTO al blob,
// esquivando el límite de 4.5MB de las serverless functions). Necesita BLOB_READ_WRITE_TOKEN.
const MENSAJE_SIN_ALMACEN =
  'La subida de archivos todavía no está activada en esta instalación (falta conectar el almacenamiento de ' +
  'vídeos). Mientras tanto, sube el vídeo a tu plataforma habitual (Vimeo, YouTube, Wistia…) y pega su ' +
  'enlace en el campo de la URL del vídeo.'

export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }): Promise<NextResponse> {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  // Sin almacén conectado, @vercel/blob falla con un error técnico en inglés que llegaba tal cual a la
  // pantalla (ocurrió en producción el 15-sep). Se detecta antes y se dice qué pasa y qué hacer.
  // 503 y no 400: no es culpa de lo que ha enviado el usuario, es que el servicio no está activado.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: MENSAJE_SIN_ALMACEN }, { status: 503 })
  }

  const body = (await req.json()) as HandleUploadBody
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp'],
        addRandomSuffix: true,
        maximumSizeInBytes: 2 * 1024 * 1024 * 1024, // 2 GB
      }),
      onUploadCompleted: async () => {},
    })
    return NextResponse.json(json)
  } catch (e) {
    console.error('[vsl/upload]', e)
    return NextResponse.json({ error: (e as Error).message || 'Error de subida' }, { status: 400 })
  }
}
