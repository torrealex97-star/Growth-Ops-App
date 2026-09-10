import { NextRequest, NextResponse } from "next/server"
import { getTestimonioUser } from "@/lib/testimonios-auth"
import { createTestimonio, listTestimonios } from "@/lib/testimonios"
import { parseTestimonioBody } from "@/lib/testimonios-payload"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const user = await getTestimonioUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  // Los que pueden editar ven también los desactivados, para poder reactivarlos.
  const testimonios = await listTestimonios(user.canWrite)
  return NextResponse.json({ testimonios, canWrite: user.canWrite })
}

export async function POST(req: NextRequest) {
  const user = await getTestimonioUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  if (!user.canWrite) return NextResponse.json({ error: "Sin permiso para crear testimonios" }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 })

  const parsed = parseTestimonioBody(body)
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const testimonio = await createTestimonio({ ...parsed.patch, name })
  return NextResponse.json({ testimonio })
}
