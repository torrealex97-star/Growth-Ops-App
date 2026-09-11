import { NextRequest, NextResponse } from 'next/server'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { requireTenant } from '@/lib/auth/requireTenant'
import { listTemplates, createTemplateFromProject } from '@/lib/carruseles/store'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ tenant: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const templates = await listTemplates()
  return NextResponse.json({ templates })
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!body.projectId) return NextResponse.json({ error: 'projectId requerido' }, { status: 400 })
  const tpl = await createTemplateFromProject(body.projectId)
  if (!tpl) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
  return NextResponse.json(tpl)
}
