import { NextRequest, NextResponse } from 'next/server'
import { getCallStats, getAllAssignments } from '@/lib/db-coldcalling'

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const [stats, assignments] = await Promise.all([getCallStats(), getAllAssignments()])
  return NextResponse.json({ stats, assignments })
}
