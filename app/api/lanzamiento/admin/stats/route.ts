import { NextRequest, NextResponse } from 'next/server'
import { getAdminLaunchStats, getSales } from '@/lib/db-lanzamiento'

export const maxDuration = 60

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const [stats, sales] = await Promise.all([
      getAdminLaunchStats(),
      getSales(),
    ])
    return NextResponse.json({ ...stats, sales })
  } catch (e) {
    const err = e as Error
    console.error('[lanzamiento/admin/stats]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
