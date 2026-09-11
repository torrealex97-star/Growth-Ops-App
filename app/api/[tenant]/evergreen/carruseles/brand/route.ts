import { NextRequest, NextResponse } from 'next/server'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getBrand, updateBrand } from '@/lib/carruseles/store'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ tenant: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const brand = await getBrand()
  return NextResponse.json(brand)
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
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
