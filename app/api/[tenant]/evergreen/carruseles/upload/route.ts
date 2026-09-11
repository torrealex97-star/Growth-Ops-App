import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { requireTenant } from '@/lib/auth/requireTenant'
import { addReferenceImage } from '@/lib/carruseles/store'

export const runtime = 'nodejs'

const BUCKET = 'carrusel-uploads'
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
const MAX = 15 * 1024 * 1024

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Form inválido' }, { status: 400 })
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file requerido' }, { status: 400 })
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'Formato no soportado' }, { status: 400 })
  if (file.size > MAX) return NextResponse.json({ error: 'Máx 15MB' }, { status: 400 })

  const projectId = (form.get('projectId') as string) || ''
  const purpose = (form.get('purpose') as string) || 'reference'

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const key = `${tenant}/${purpose}/${crypto.randomUUID()}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  const { error } = await sb.storage.from(BUCKET).upload(key, buf, {
    contentType: file.type,
    upsert: false,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(key)
  const url = pub.publicUrl

  if (purpose === 'reference' && projectId) {
    const image = { id: crypto.randomUUID(), url, name: file.name, addedAt: new Date().toISOString() }
    await addReferenceImage(projectId, image)
    return NextResponse.json(image)
  }

  return NextResponse.json({ url, name: file.name })
}
