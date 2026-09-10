import { NextRequest, NextResponse } from "next/server"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { removeReferenceImage } from "@/lib/carruseles/store"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { id } = await params
  const imageId = new URL(req.url).searchParams.get("imageId")
  if (!imageId) return NextResponse.json({ error: "imageId requerido" }, { status: 400 })
  await removeReferenceImage(id, imageId)
  return NextResponse.json({ ok: true })
}
