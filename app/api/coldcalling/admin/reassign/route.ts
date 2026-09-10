import { NextRequest, NextResponse } from 'next/server'
import { reassignLead, getCallerById } from '@/lib/db-coldcalling'
import { syncAssignmentsToSheet } from '@/lib/sheets-write'

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { leadEmail, callerId } = await req.json()
  if (!leadEmail || !callerId) {
    return NextResponse.json({ error: 'leadEmail y callerId requeridos' }, { status: 400 })
  }
  const id = Number(callerId)
  const [caller] = await Promise.all([getCallerById(id), reassignLead(leadEmail, id)])
  if (caller) {
    syncAssignmentsToSheet([{ leadEmail, callerNombre: caller.nombre }]).catch(console.error)
  }
  return NextResponse.json({ ok: true })
}
