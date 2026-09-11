import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/requireUser'

export const dynamic = 'force-dynamic'

// Token de subida directa a Vercel Blob (el cliente sube el fichero DIRECTO al blob,
// esquivando el límite de 4.5MB de las serverless functions). Necesita BLOB_READ_WRITE_TOKEN.
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireUser()
  if ('error' in auth) return auth.error

  const body = (await req.json()) as HandleUploadBody
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          'video/mp4',
          'video/webm',
          'video/quicktime',
          'image/jpeg',
          'image/png',
          'image/webp',
        ],
        addRandomSuffix: true,
        maximumSizeInBytes: 2 * 1024 * 1024 * 1024, // 2 GB
      }),
      onUploadCompleted: async () => {},
    })
    return NextResponse.json(json)
  } catch (e) {
    console.error('[vsl/upload]', e)
    return NextResponse.json(
      { error: (e as Error).message || 'Error de subida' },
      { status: 400 }
    )
  }
}
