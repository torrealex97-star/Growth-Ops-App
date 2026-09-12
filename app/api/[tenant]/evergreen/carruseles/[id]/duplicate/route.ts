import { NextRequest, NextResponse } from 'next/server'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { requireTenant } from '@/lib/auth/requireTenant'
import { duplicateProject } from '@/lib/carruseles/store'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ tenant: string; id: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { tenant, id } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const dup = await duplicateProject(t.tenantId, id)
  if (!dup) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  return NextResponse.json(dup)
}
