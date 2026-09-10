import { NextResponse } from 'next/server'
import { getCloserIdFromCookies } from '@/lib/lanzamiento-session'
import { getCloserById, getCloserStats, getSales } from '@/lib/db-lanzamiento'

export async function GET() {
  const closerId = getCloserIdFromCookies()
  if (!closerId) return NextResponse.json({ error: 'No autenticada' }, { status: 401 })

  const closer = await getCloserById(closerId)
  if (!closer) return NextResponse.json({ error: 'Closer no encontrada' }, { status: 401 })

  const [stats, sales] = await Promise.all([
    getCloserStats(closerId),
    getSales({ closerId }),
  ])

  return NextResponse.json({ closer, stats, sales })
}
