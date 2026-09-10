import { NextRequest, NextResponse } from 'next/server'
import { getCloserIdFromCookies } from '@/lib/lanzamiento-session'
import { lookupLead } from '@/lib/db-lanzamiento'

export async function GET(req: NextRequest) {
  const closerId = getCloserIdFromCookies()
  if (!closerId) return NextResponse.json({ error: 'No autenticada' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ error: 'Parámetro q requerido' }, { status: 400 })

  const result = await lookupLead(q)
  return NextResponse.json(result)
}
