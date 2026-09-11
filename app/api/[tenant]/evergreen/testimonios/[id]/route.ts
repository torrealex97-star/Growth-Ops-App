import { NextRequest, NextResponse } from "next/server"
import { getTestimonioUser } from "@/lib/testimonios-auth"
import { deleteTestimonio, getTestimonio, updateTestimonio } from "@/lib/testimonios"
import { parseTestimonioBody } from "@/lib/testimonios-payload"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getTestimonioUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { id } = await ctx.params
  const testimonio = await getTestimonio(id)
  if (!testimonio) return NextResponse.json({ error: "Testimonio no encontrado" }, { status: 404 })
  return NextResponse.json({ testimonio, canWrite: user.canWrite })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getTestimonioUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  if (!user.canWrite) return NextResponse.json({ error: "Sin permiso para editar" }, { status: 403 })

  const { id } = await ctx.params
  const parsed = parseTestimonioBody(await req.json().catch(() => ({})))
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (!Object.keys(parsed.patch).length)
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 })

  const testimonio = await updateTestimonio(id, parsed.patch)
  if (!testimonio) return NextResponse.json({ error: "Testimonio no encontrado" }, { status: 404 })
  return NextResponse.json({ testimonio })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getTestimonioUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  if (!user.canWrite) return NextResponse.json({ error: "Sin permiso para eliminar" }, { status: 403 })
  const { id } = await ctx.params
  await deleteTestimonio(id)
  return NextResponse.json({ ok: true })
}
