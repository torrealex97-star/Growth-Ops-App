import { NextRequest, NextResponse } from "next/server"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { requireTenant } from "@/lib/auth/requireTenant"
import { getProject, updateProject, deleteProject } from "@/lib/carruseles/store"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ tenant: string; id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { tenant, id } = await params
  const t = await requireTenant(tenant)
  if ("error" in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const project = await getProject(id)
  if (!project) return NextResponse.json({ error: "No encontrado" }, { status: 404 })
  return NextResponse.json(project)
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { tenant, id } = await params
  const t = await requireTenant(tenant)
  if ("error" in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const updated = await updateProject(id, {
    title: body.title,
    aspectRatio: body.aspectRatio,
    kind: body.kind,
    caption: body.caption,
    hashtags: body.hashtags,
  })
  if (!updated) return NextResponse.json({ error: "No encontrado" }, { status: 404 })
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { tenant, id } = await params
  const t = await requireTenant(tenant)
  if ("error" in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  await deleteProject(id)
  return NextResponse.json({ ok: true })
}
