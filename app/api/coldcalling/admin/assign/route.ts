import { NextRequest, NextResponse } from 'next/server'
import { autoAssignLeads, getAllAssignments } from '@/lib/db-coldcalling'
import { syncAssignmentsToSheet } from '@/lib/sheets-write'

export const maxDuration = 30

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const result = await autoAssignLeads()

    if (result.count > 0) {
      getAllAssignments()
        .then((all) =>
          syncAssignmentsToSheet(
            all.map((a) => ({ leadEmail: a.lead_email, callerNombre: a.coldcaller_nombre }))
          )
        )
        .catch(console.error)
    }

    return NextResponse.json({ assigned: result.count })
  } catch (err) {
    console.error('assign error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
