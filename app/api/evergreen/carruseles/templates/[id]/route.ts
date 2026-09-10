import { NextRequest, NextResponse } from "next/server"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { deleteTemplate } from "@/lib/carruseles/store"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { id } = await params
  await deleteTemplate(id)
  return NextResponse.json({ ok: true })
}
