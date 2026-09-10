import { NextRequest, NextResponse } from 'next/server'
import { syncSalesFromSheet } from '@/lib/sync-sales-sheet'

export const maxDuration = 60

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const result = await syncSalesFromSheet()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const err = e as Error
    console.error('[sync-sales]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
