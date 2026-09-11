import { NextRequest, NextResponse } from "next/server"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { updateProject } from "@/lib/carruseles/store"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Ctx) {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const updated = await updateProject(id, {
    caption: typeof body.caption === "string" ? body.caption : undefined,
    hashtags: Array.isArray(body.hashtags) ? body.hashtags : undefined,
  })
  if (!updated) return NextResponse.json({ error: "No encontrado" }, { status: 404 })
  return NextResponse.json(updated)
}
