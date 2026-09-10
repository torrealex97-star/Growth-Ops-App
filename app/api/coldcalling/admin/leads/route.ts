import { NextRequest, NextResponse } from 'next/server'
import { fetchLeadsOnly } from '@/lib/sheets'
import postgres from 'postgres'

const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require', max: 3, prepare: false, idle_timeout: 20, max_lifetime: 60 * 30 })

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const [leads, assignments, callRecords] = await Promise.all([
    fetchLeadsOnly(),
    sql`SELECT la.lead_email, la.coldcaller_id, cc.nombre as coldcaller_nombre
        FROM lead_assignments la
        JOIN cold_callers cc ON cc.id = la.coldcaller_id`,
    sql`SELECT lead_email, estado, notas, updated_at FROM call_records`,
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignMap = new Map((assignments as unknown as any[]).map((a) => [a.lead_email as string, a]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recordMap = new Map((callRecords as unknown as any[]).map((r) => [r.lead_email as string, r]))

  const result = leads.map((l) => {
    const a = assignMap.get(l.email)
    const r = recordMap.get(l.email)
    return {
      ...l,
      asignadaA: a?.coldcaller_nombre ?? null,
      asignadaId: a?.coldcaller_id ?? null,
      ccEstado: r?.estado ?? null,
      ccNotas: r?.notas ?? null,
      ccUpdatedAt: r?.updated_at ?? null,
    }
  })

  return NextResponse.json(result)
}
