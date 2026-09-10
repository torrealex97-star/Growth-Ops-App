import { NextRequest, NextResponse } from "next/server"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { createProjectFromTemplate } from "@/lib/carruseles/store"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { id } = await params
  const project = await createProjectFromTemplate(id)
  if (!project) return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 })
  return NextResponse.json(project)
}
