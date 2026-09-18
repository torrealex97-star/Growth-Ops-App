import { NextRequest, NextResponse } from 'next/server'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { requireTenant } from '@/lib/auth/requireTenant'
import { updateProject } from '@/lib/carruseles/store'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ tenant: string; id: string }> }

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const { tenant, id } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const user = await getCarruselUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    const updated = await updateProject(t.tenantId, id, {
      caption: typeof body.caption === 'string' ? body.caption : undefined,
      hashtags: Array.isArray(body.hashtags) ? body.hashtags : undefined,
    })
    if (!updated) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (err) {
    console.error('[api/carruseles/id/caption PUT]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
