import { NextRequest, NextResponse } from 'next/server'
import { fetchLeadsOnly } from '@/lib/sheets'
import { syncLeadsCache, autoAssignLeads } from '@/lib/db-coldcalling'
import { syncAssignmentsToSheet } from '@/lib/sheets-write'

export const maxDuration = 60

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const leads = await fetchLeadsOnly()
  const emails = leads.map((l) => l.email).filter(Boolean)

  const [synced, result] = await Promise.all([
    syncLeadsCache(leads),
    autoAssignLeads(emails),
  ])

  if (result.count > 0) {
    syncAssignmentsToSheet(
      result.assignments.map((a) => ({ leadEmail: a.leadEmail, callerNombre: a.callerNombre }))
    ).catch(console.error)
  }

  return NextResponse.json({ synced, newAssigned: result.count })
}
