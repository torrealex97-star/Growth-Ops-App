import { NextRequest, NextResponse } from "next/server"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { getBrand, updateBrand } from "@/lib/carruseles/store"

export const runtime = "nodejs"

export async function GET() {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const brand = await getBrand()
  return NextResponse.json(brand)
}

export async function PUT(req: NextRequest) {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const brand = await updateBrand({
    name: body.name,
    colors: body.colors,
    fonts: body.fonts,
    logoUrl: body.logoUrl,
    styleKeywords: body.styleKeywords,
  })
  return NextResponse.json(brand)
}
