import { NextRequest, NextResponse } from 'next/server'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { requireTenant } from '@/lib/auth/requireTenant'
import { undoSlide } from '@/lib/carruseles/store'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ tenant: string; id: string; slideId: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { tenant, id, slideId } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const slide = await undoSlide(t.tenantId, id, slideId)
  if (!slide) return NextResponse.json({ error: 'Sin versión anterior' }, { status: 400 })
  return NextResponse.json(slide)
}
