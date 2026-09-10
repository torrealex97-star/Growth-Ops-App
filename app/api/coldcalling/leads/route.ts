import { NextResponse } from 'next/server'
import { getCallerIdFromCookies } from '@/lib/cc-session'
import { getCallerById } from '@/lib/db-coldcalling'
import { getColdCallerLaunchStats } from '@/lib/db-lanzamiento'
import postgres from 'postgres'

export const maxDuration = 30

const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require', max: 3, prepare: false, idle_timeout: 20, max_lifetime: 60 * 30 })

export async function GET() {
  const callerId = getCallerIdFromCookies()
  if (!callerId) return NextResponse.json({ error: 'No autenticada' }, { status: 401 })

  const caller = await getCallerById(callerId)
  if (!caller) return NextResponse.json({ error: 'Caller no encontrada' }, { status: 401 })

  const [rows, launchStats] = await Promise.all([
    sql`
      SELECT
        lc.email,
        lc.nombre,
        lc.telefono,
        lc.fecha_registro as "fechaRegistro",
        cr.estado as "ccEstado",
        cr.notas as "ccNotas",
        cr.updated_at as "ccUpdatedAt"
      FROM lead_assignments la
      JOIN leads_cache lc ON lc.email = la.lead_email
      LEFT JOIN call_records cr
        ON cr.lead_email = la.lead_email AND cr.coldcaller_id = la.coldcaller_id
      WHERE la.coldcaller_id = ${callerId}
      ORDER BY
        (cr.estado IS NOT NULL) ASC,
        lc.fecha_registro DESC
    `,
    getColdCallerLaunchStats(callerId),
  ])

  return NextResponse.json({ caller, leads: rows, launchStats })
}
