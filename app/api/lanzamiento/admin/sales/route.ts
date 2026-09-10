import { NextRequest, NextResponse } from 'next/server'
import { getSales } from '@/lib/db-lanzamiento'

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const sales = await getSales()
  return NextResponse.json({ sales })
}
