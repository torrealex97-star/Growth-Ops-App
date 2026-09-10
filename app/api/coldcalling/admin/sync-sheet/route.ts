import { NextRequest, NextResponse } from 'next/server'
import { getAllAssignments } from '@/lib/db-coldcalling'
import { syncAssignmentsToSheet } from '@/lib/sheets-write'

export const maxDuration = 60

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const assignments = await getAllAssignments()
    if (assignments.length === 0) return NextResponse.json({ synced: 0 })

    await syncAssignmentsToSheet(
      assignments.map((a) => ({ leadEmail: a.lead_email, callerNombre: a.coldcaller_nombre }))
    )

    return NextResponse.json({ synced: assignments.length })
  } catch (e) {
    console.error('sync-sheet error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
