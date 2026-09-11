import { NextRequest, NextResponse } from "next/server"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { listTemplates, createTemplateFromProject } from "@/lib/carruseles/store"

export const runtime = "nodejs"

export async function GET() {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const templates = await listTemplates()
  return NextResponse.json({ templates })
}

export async function POST(req: NextRequest) {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!body.projectId) return NextResponse.json({ error: "projectId requerido" }, { status: 400 })
  const tpl = await createTemplateFromProject(body.projectId)
  if (!tpl) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 })
  return NextResponse.json(tpl)
}
