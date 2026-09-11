import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const BUCKET = 'pagos'

// Sube el justificante/captura del pago a Supabase Storage (bucket privado) y
// devuelve una URL firmada de larga duración para descargarlo desde la venta.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { filename, contentType, dataBase64 } = (await req.json()) as {
      filename?: string
      contentType?: string
      dataBase64?: string
    }
    if (!dataBase64) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })

    const bytes = Buffer.from(dataBase64, 'base64')
    // Límite defensivo (~8 MB) para evitar payloads enormes por JSON.
    if (bytes.length > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'Archivo demasiado grande (máx. 8 MB)' }, { status: 413 })
    }

    const ext = (filename?.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${tenant}/${new Date().toISOString().slice(0, 10)}/${randomBytes(12).toString('hex')}.${ext}`

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    let up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: contentType || 'application/octet-stream', upsert: false })
    if (up.error && /bucket.*not.*found|not found/i.test(up.error.message)) {
      await sb.storage.createBucket(BUCKET, { public: false })
      up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: contentType || 'application/octet-stream', upsert: false })
    }
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })

    // URL firmada larga (10 años) — el bucket es privado.
    const signed = await sb.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 3650)
    const url = signed.data?.signedUrl || sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

    return NextResponse.json({ ok: true, url, path })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
