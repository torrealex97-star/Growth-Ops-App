import { NextRequest, NextResponse } from "next/server"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { addSlide, reorderSlides } from "@/lib/carruseles/store"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

// Añadir slide (usado también manualmente / por el agente vía tool)
export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (typeof body.html !== "string" || !body.html.trim())
    return NextResponse.json({ error: "html requerido" }, { status: 400 })
  const slide = await addSlide(id, body.html, body.notes || "")
  if (!slide) return NextResponse.json({ error: "No se pudo añadir (límite o proyecto inexistente)" }, { status: 400 })
  return NextResponse.json(slide)
}

// Reordenar slides
export async function PUT(req: NextRequest, { params }: Ctx) {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (!Array.isArray(body.slideIds)) return NextResponse.json({ error: "slideIds requerido" }, { status: 400 })
  const ok = await reorderSlides(id, body.slideIds)
  if (!ok) return NextResponse.json({ error: "Reordenación inválida" }, { status: 400 })
  return NextResponse.json({ ok: true })
}
