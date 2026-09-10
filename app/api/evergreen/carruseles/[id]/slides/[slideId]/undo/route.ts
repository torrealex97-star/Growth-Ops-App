import { NextRequest, NextResponse } from "next/server"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { undoSlide } from "@/lib/carruseles/store"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; slideId: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { id, slideId } = await params
  const slide = await undoSlide(id, slideId)
  if (!slide) return NextResponse.json({ error: "Sin versión anterior" }, { status: 400 })
  return NextResponse.json(slide)
}
