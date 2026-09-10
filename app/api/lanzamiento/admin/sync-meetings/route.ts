import { NextRequest, NextResponse } from 'next/server'
import { fetchReuniones } from '@/lib/sheets'
import { syncMeetings } from '@/lib/db-lanzamiento'

export const maxDuration = 60

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const rows = await fetchReuniones()
    const result = await syncMeetings(rows)
    return NextResponse.json({ ok: true, ...result, total: rows.length })
  } catch (e) {
    const err = e as Error
    console.error('[sync-meetings]', err)
    return NextResponse.json(
      { error: err.message, stage: err.message.includes('fetch') ? 'sheets' : 'db' },
      { status: 500 }
    )
  }
}
