import { NextRequest, NextResponse } from 'next/server'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { requireTenant } from '@/lib/auth/requireTenant'
import { updateSlide, deleteSlide } from '@/lib/carruseles/store'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ tenant: string; id: string; slideId: string }> }

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { tenant, id, slideId } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const slide = await updateSlide(id, slideId, { html: body.html, notes: body.notes })
  if (!slide) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  return NextResponse.json(slide)
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { tenant, id, slideId } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const ok = await deleteSlide(id, slideId)
  if (!ok) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
