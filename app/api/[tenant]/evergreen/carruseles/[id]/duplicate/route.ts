import { NextRequest, NextResponse } from "next/server"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { duplicateProject } from "@/lib/carruseles/store"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const { id } = await params
  const dup = await duplicateProject(id)
  if (!dup) return NextResponse.json({ error: "No encontrado" }, { status: 404 })
  return NextResponse.json(dup)
}
