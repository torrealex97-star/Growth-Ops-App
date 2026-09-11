import { NextRequest, NextResponse } from "next/server"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { requireTenant } from "@/lib/auth/requireTenant"
import { removeReferenceImage } from "@/lib/carruseles/store"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ tenant: string; id: string }> }

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { tenant, id } = await params
  const t = await requireTenant(tenant)
  if ("error" in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const imageId = new URL(req.url).searchParams.get("imageId")
  if (!imageId) return NextResponse.json({ error: "imageId requerido" }, { status: 400 })
  await removeReferenceImage(id, imageId)
  return NextResponse.json({ ok: true })
}
