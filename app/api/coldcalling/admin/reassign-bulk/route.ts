import { NextRequest, NextResponse } from 'next/server'
import postgres from 'postgres'
import { syncAssignmentsToSheet } from '@/lib/sheets-write'

export const maxDuration = 60

const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require', max: 3, prepare: false, idle_timeout: 20, max_lifetime: 60 * 30 })

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

// GET — preview current state
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const [callers, uncontactedCount, distribution] = await Promise.all([
    sql<{ id: number; nombre: string; activa: boolean }[]>`
      SELECT id, nombre, activa FROM cold_callers ORDER BY nombre
    `,
    sql<{ count: number }[]>`
      SELECT COUNT(*)::int as count
      FROM lead_assignments la
      LEFT JOIN call_records cr ON cr.lead_email = la.lead_email
      WHERE cr.lead_email IS NULL
    `,
    sql<{ coldcaller_id: number; nombre: string; count: number }[]>`
      SELECT la.coldcaller_id, cc.nombre, COUNT(*)::int as count
      FROM lead_assignments la
      LEFT JOIN call_records cr ON cr.lead_email = la.lead_email
      JOIN cold_callers cc ON cc.id = la.coldcaller_id
      WHERE cr.lead_email IS NULL
      GROUP BY la.coldcaller_id, cc.nombre
      ORDER BY cc.nombre
    `,
  ])

  return NextResponse.json({
    callers,
    totalUncontacted: uncontactedCount[0]?.count ?? 0,
    currentDistribution: distribution,
  })
}

// POST — execute bulk reassignment in a single SQL UPDATE using unnest
// Body: { plan: { callerId: number, count: number }[] }
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await req.json()
  const plan: { callerId: number; count: number }[] = body.plan
  if (!plan || plan.length === 0) {
    return NextResponse.json({ error: 'plan requerido' }, { status: 400 })
  }

  // Get all uncontacted leads ordered stably
  const uncontacted = await sql<{ email: string }[]>`
    SELECT la.lead_email as email
    FROM lead_assignments la
    LEFT JOIN call_records cr ON cr.lead_email = la.lead_email
    WHERE cr.lead_email IS NULL
    ORDER BY la.assigned_at
  `
  if (uncontacted.length === 0) {
    return NextResponse.json({ reassigned: 0, message: 'No hay leads sin contactar' })
  }

  // Build assignment list according to plan
  const assignments: { email: string; callerId: number }[] = []
  let idx = 0
  for (let p = 0; p < plan.length; p++) {
    const isLast = p === plan.length - 1
    const take = isLast
      ? uncontacted.length - idx
      : Math.min(plan[p].count, uncontacted.length - idx)
    for (let i = 0; i < take && idx < uncontacted.length; i++, idx++) {
      assignments.push({ email: uncontacted[idx].email, callerId: plan[p].callerId })
    }
  }

  // Single bulk UPDATE via unnest arrays — safe, no string interpolation
  const emails = assignments.map((a) => a.email)
  const callerIds = assignments.map((a) => a.callerId)

  await sql`
    UPDATE lead_assignments
    SET coldcaller_id = data.caller_id, assigned_at = NOW()
    FROM (
      SELECT
        unnest(${sql.array(emails)}::text[]) AS email,
        unnest(${sql.array(callerIds)}::int[]) AS caller_id
    ) AS data
    WHERE lead_assignments.lead_email = data.email
  `

  // Caller names for sheet sync
  const callerRows = await sql<{ id: number; nombre: string }[]>`SELECT id, nombre FROM cold_callers`
  const nameById = new Map(callerRows.map((c) => [c.id, c.nombre]))

  // Sync ALL assignments to sheet (background — new distribution + existing)
  const allAssignments = await sql<{ lead_email: string; coldcaller_id: number }[]>`
    SELECT lead_email, coldcaller_id FROM lead_assignments
  `
  syncAssignmentsToSheet(
    allAssignments.map((a) => ({ leadEmail: a.lead_email, callerNombre: nameById.get(a.coldcaller_id) || '' }))
  ).catch(console.error)

  return NextResponse.json({
    reassigned: assignments.length,
    breakdown: plan.map((s) => ({
      caller: nameById.get(s.callerId) || String(s.callerId),
      assigned: assignments.filter((a) => a.callerId === s.callerId).length,
    })),
  })
}
