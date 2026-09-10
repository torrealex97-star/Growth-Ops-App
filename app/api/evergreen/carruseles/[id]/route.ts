import { NextRequest, NextResponse } from "next/server"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { getProject, updateProject, deleteProject } from "@/lib/carruseles/store"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { id } = await params
  const project = await getProject(id)
  if (!project) return NextResponse.json({ error: "No encontrado" }, { status: 404 })
  return NextResponse.json(project)
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { id } = await params
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
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { id } = await params
  await deleteProject(id)
  return NextResponse.json({ ok: true })
}
