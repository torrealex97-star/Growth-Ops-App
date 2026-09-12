import { NextRequest, NextResponse } from 'next/server'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { requireTenant } from '@/lib/auth/requireTenant'
import { listProjects, createProject } from '@/lib/carruseles/store'
import type { AspectRatio, ProjectKind } from '@/lib/carruseles/types'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ tenant: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const projects = await listProjects(t.tenantId)
  return NextResponse.json({ projects })
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const title = (body.title as string)?.trim() || 'Sin título'
  const kind = (body.kind === 'flyer' ? 'flyer' : 'carousel') as ProjectKind
  const validRatios: AspectRatio[] = ['1:1', '4:5', '9:16', '3:4', 'A4']
  const aspectRatio: AspectRatio = validRatios.includes(body.aspectRatio)
    ? body.aspectRatio
    : kind === 'flyer'
      ? 'A4'
      : '4:5'
  const project = await createProject(t.tenantId, title, kind, aspectRatio, user.id)
  return NextResponse.json(project)
}
