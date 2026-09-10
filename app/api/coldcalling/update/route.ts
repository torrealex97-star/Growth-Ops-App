import { NextRequest, NextResponse } from 'next/server'
import { getCallerIdFromCookies } from '@/lib/cc-session'
import { getCallerById, upsertCallRecord } from '@/lib/db-coldcalling'
import { updateLeadColdcalling } from '@/lib/sheets-write'

export const maxDuration = 30

const VALID_ESTADOS = ['llamada_asiste', 'llamada_no_asiste', 'no_contesta', 'no_existe', 'llamar_mas_tarde', 'alumna_bw']

const ESTADO_LABEL: Record<string, string> = {
  llamada_asiste: 'Llamada Asiste',
  llamada_no_asiste: 'Llamada No Asiste',
  no_contesta: 'No Contesta',
  no_existe: 'No Existe',
  llamar_mas_tarde: 'Llamar Más Tarde',
  alumna_bw: 'Alumna BW',
}

export async function POST(req: NextRequest) {
  const callerId = getCallerIdFromCookies()
  if (!callerId) return NextResponse.json({ error: 'No autenticada' }, { status: 401 })

  const { leadEmail, estado, notas = '' } = await req.json()

  if (!leadEmail) return NextResponse.json({ error: 'leadEmail requerido' }, { status: 400 })
  if (!VALID_ESTADOS.includes(estado)) {
    return NextResponse.json({ error: 'Estado inválido' }, { status: 400 })
  }

  const caller = await getCallerById(callerId)
  if (!caller) return NextResponse.json({ error: 'Caller no encontrada' }, { status: 401 })

  // Save to DB — source of truth, always awaited
  await upsertCallRecord(leadEmail, callerId, estado, notas)

  // Sync to Google Sheets — fire-and-forget so Sheets latency never blocks the response
  updateLeadColdcalling(leadEmail, ESTADO_LABEL[estado], notas, caller.nombre)
    .catch(err => console.error('Sheet sync error (non-fatal):', err))

  return NextResponse.json({ ok: true })
}
