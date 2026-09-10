import postgres from 'postgres'
import type { Lead } from './types'

const sql = postgres(process.env.POSTGRES_URL!, {
  ssl: 'require',
  max: 3,
  prepare: false, // required for Supabase pooler (PgBouncer transaction mode)
  idle_timeout: 20,
  max_lifetime: 60 * 30,
})

export interface ColdCaller {
  id: number
  email: string
  nombre: string
  activa: boolean
  peso: number
  created_at: string
}

export interface LeadAssignment {
  lead_email: string
  coldcaller_id: number
  assigned_at: string
}

export interface CallRecord {
  lead_email: string
  coldcaller_id: number
  estado: string | null
  notas: string | null
  updated_at: string
}

export interface CallStats {
  coldcaller_id: number
  nombre: string
  email: string
  total_asignados: number
  llamadas_realizadas: number
  asisten: number
  no_asisten: number
  no_contesta: number
  no_existe: number
  llamar_mas_tarde: number
  alumna_bw: number
}

// ── Callers ──────────────────────────────────────────────────────

export async function getCallers(): Promise<ColdCaller[]> {
  return sql<ColdCaller[]>`SELECT id, email, nombre, activa, peso, created_at FROM cold_callers ORDER BY nombre`
}

export async function getCallerById(id: number): Promise<ColdCaller | null> {
  const rows = await sql<ColdCaller[]>`SELECT id, email, nombre, activa, peso FROM cold_callers WHERE id = ${id}`
  return rows[0] ?? null
}

export async function getCallerByEmail(email: string): Promise<(ColdCaller & { password_hash: string }) | null> {
  const rows = await sql<(ColdCaller & { password_hash: string })[]>`
    SELECT id, email, nombre, activa, peso, password_hash FROM cold_callers WHERE email = ${email.toLowerCase()}
  `
  return rows[0] ?? null
}

export async function createCaller(email: string, nombre: string, passwordHash: string, peso = 100): Promise<ColdCaller> {
  const rows = await sql<ColdCaller[]>`
    INSERT INTO cold_callers (email, nombre, password_hash, peso)
    VALUES (${email.toLowerCase()}, ${nombre}, ${passwordHash}, ${peso})
    RETURNING id, email, nombre, activa, peso, created_at
  `
  return rows[0]
}

export async function updateCaller(id: number, fields: { activa?: boolean; peso?: number; nombre?: string }): Promise<void> {
  if (fields.activa !== undefined) {
    await sql`UPDATE cold_callers SET activa = ${fields.activa} WHERE id = ${id}`
  }
  if (fields.peso !== undefined) {
    await sql`UPDATE cold_callers SET peso = ${fields.peso} WHERE id = ${id}`
  }
  if (fields.nombre !== undefined) {
    await sql`UPDATE cold_callers SET nombre = ${fields.nombre} WHERE id = ${id}`
  }
}

export async function deleteCaller(id: number): Promise<void> {
  await sql`DELETE FROM cold_callers WHERE id = ${id}`
}

// ── Assignments ──────────────────────────────────────────────────

export async function getAssignedEmails(): Promise<Set<string>> {
  const rows = await sql<{ lead_email: string }[]>`SELECT lead_email FROM lead_assignments`
  return new Set(rows.map((r) => r.lead_email))
}

export async function getAssignmentsForCaller(callerId: number): Promise<string[]> {
  const rows = await sql<{ lead_email: string }[]>`
    SELECT lead_email FROM lead_assignments WHERE coldcaller_id = ${callerId} ORDER BY assigned_at
  `
  return rows.map((r) => r.lead_email)
}

export async function getAllAssignments(): Promise<{ lead_email: string; coldcaller_id: number; coldcaller_nombre: string }[]> {
  return sql`
    SELECT la.lead_email, la.coldcaller_id, cc.nombre as coldcaller_nombre
    FROM lead_assignments la
    JOIN cold_callers cc ON cc.id = la.coldcaller_id
    ORDER BY la.assigned_at DESC
  `
}

export async function assignLeads(assignments: { leadEmail: string; callerId: number }[]): Promise<void> {
  if (assignments.length === 0) return
  const emails = assignments.map((a) => a.leadEmail)
  const callerIds = assignments.map((a) => a.callerId)
  await sql`
    INSERT INTO lead_assignments (lead_email, coldcaller_id)
    SELECT * FROM unnest(
      ${sql.array(emails)}::text[],
      ${sql.array(callerIds)}::int[]
    ) AS t(lead_email, coldcaller_id)
    ON CONFLICT DO NOTHING
  `
}

export async function reassignLead(leadEmail: string, newCallerId: number): Promise<void> {
  await sql`
    INSERT INTO lead_assignments (lead_email, coldcaller_id)
    VALUES (${leadEmail}, ${newCallerId})
    ON CONFLICT (lead_email) DO UPDATE SET coldcaller_id = ${newCallerId}, assigned_at = NOW()
  `
}

// ── Call Records ─────────────────────────────────────────────────

export async function getCallRecord(leadEmail: string): Promise<CallRecord | null> {
  const rows = await sql<CallRecord[]>`SELECT * FROM call_records WHERE lead_email = ${leadEmail}`
  return rows[0] ?? null
}

export async function getCallRecordsForCaller(callerId: number): Promise<CallRecord[]> {
  return sql<CallRecord[]>`SELECT * FROM call_records WHERE coldcaller_id = ${callerId}`
}

export async function upsertCallRecord(
  leadEmail: string,
  callerId: number,
  estado: string,
  notas: string
): Promise<void> {
  await sql`
    INSERT INTO call_records (lead_email, coldcaller_id, estado, notas, updated_at)
    VALUES (${leadEmail}, ${callerId}, ${estado}, ${notas}, NOW())
    ON CONFLICT (lead_email) DO UPDATE
      SET estado = ${estado}, notas = ${notas}, updated_at = NOW()
  `
}

// ── Stats / Leaderboard ──────────────────────────────────────────

export async function getCallStats(): Promise<CallStats[]> {
  return sql<CallStats[]>`
    SELECT
      cc.id as coldcaller_id,
      cc.nombre,
      cc.email,
      (SELECT COUNT(*)::int FROM lead_assignments WHERE coldcaller_id = cc.id) as total_asignados,
      (SELECT COUNT(*)::int FROM call_records WHERE coldcaller_id = cc.id) as llamadas_realizadas,
      (SELECT COUNT(*)::int FROM call_records WHERE coldcaller_id = cc.id AND estado = 'llamada_asiste') as asisten,
      (SELECT COUNT(*)::int FROM call_records WHERE coldcaller_id = cc.id AND estado = 'llamada_no_asiste') as no_asisten,
      (SELECT COUNT(*)::int FROM call_records WHERE coldcaller_id = cc.id AND estado = 'no_contesta') as no_contesta,
      (SELECT COUNT(*)::int FROM call_records WHERE coldcaller_id = cc.id AND estado = 'no_existe') as no_existe,
      (SELECT COUNT(*)::int FROM call_records WHERE coldcaller_id = cc.id AND estado = 'llamar_mas_tarde') as llamar_mas_tarde,
      (SELECT COUNT(*)::int FROM call_records WHERE coldcaller_id = cc.id AND estado = 'alumna_bw') as alumna_bw
    FROM cold_callers cc
    ORDER BY asisten DESC, llamadas_realizadas DESC
  `
}

// ── Auto-assignment ──────────────────────────────────────────────

export interface AutoAssignResult {
  count: number
  assignments: { leadEmail: string; callerId: number; callerNombre: string }[]
}

/**
 * Distributes unassigned lead emails (not in lead_assignments) among active callers.
 * Priority: callers who have made more calls get proportionally more new leads.
 * Weight = calls_made (minimum = peso/10 so new callers still receive some leads).
 * Reads unassigned leads directly from leads_cache via a single JOIN query.
 */
export async function autoAssignLeads(allLeadEmails?: string[]): Promise<AutoAssignResult> {
  let unassigned: string[]

  if (allLeadEmails) {
    // Legacy: filter provided list against existing assignments
    const assigned = await getAssignedEmails()
    unassigned = allLeadEmails.filter((e) => e && !assigned.has(e))
  } else {
    // Optimized: single JOIN query — leads_cache minus lead_assignments
    const rows = await sql<{ email: string }[]>`
      SELECT DISTINCT ON (lc.email) lc.email, lc.fecha_registro
      FROM leads_cache lc
      LEFT JOIN lead_assignments la ON la.lead_email = lc.email
      WHERE la.lead_email IS NULL
      ORDER BY lc.email, lc.fecha_registro
    `
    unassigned = rows.map((r) => r.email)
  }

  if (unassigned.length === 0) return { count: 0, assignments: [] }

  const callers = await sql<(ColdCaller & { calls_made: number })[]>`
    SELECT cc.id, cc.nombre, cc.email, cc.activa, cc.peso,
      (SELECT COUNT(*)::int FROM call_records WHERE coldcaller_id = cc.id) AS calls_made
    FROM cold_callers cc
    WHERE cc.activa = true
  `
  if (callers.length === 0) return { count: 0, assignments: [] }

  const callerNameMap = new Map(callers.map((c) => [c.id, c.nombre]))

  // Weight = calls made by caller (those who call more get more new leads).
  // Minimum = ceil(peso / 10) so a new caller with 0 calls still gets a baseline share.
  const effective = callers.map((c) => ({
    id: c.id,
    weight: Math.max(Math.ceil(c.peso / 10), c.calls_made),
  }))

  // Sort descending by weight so the most active callers fill first
  effective.sort((a, b) => b.weight - a.weight)

  const totalWeight = effective.reduce((s, c) => s + c.weight, 0)

  // Proportional weighted distribution
  const toAssign: { leadEmail: string; callerId: number }[] = []
  let callerIndex = 0
  let bucket = 0

  for (let i = 0; i < unassigned.length; i++) {
    const normalized = (i / unassigned.length) * totalWeight
    while (
      callerIndex < effective.length - 1 &&
      bucket + effective[callerIndex].weight < normalized
    ) {
      bucket += effective[callerIndex].weight
      callerIndex++
    }
    toAssign.push({ leadEmail: unassigned[i], callerId: effective[callerIndex].id })
  }

  await assignLeads(toAssign)

  return {
    count: toAssign.length,
    assignments: toAssign.map((a) => ({
      leadEmail: a.leadEmail,
      callerId: a.callerId,
      callerNombre: callerNameMap.get(a.callerId) || '',
    })),
  }
}

// ── Leads cache ───────────────────────────────────────────────────

/**
 * Bulk-upserts lead basic data into leads_cache.
 * Single query, fast even for 1000+ rows.
 */
export async function syncLeadsCache(leads: Lead[]): Promise<number> {
  const valid = leads.filter((l) => l.email?.trim())
  if (valid.length === 0) return 0

  const values = valid.map((l) => ({
    email: l.email.trim().toLowerCase(),
    nombre: l.nombre || null,
    telefono: l.telefono || null,
    fecha_registro: l.fechaRegistro || null,
    utm_source: l.utmSource || null,
    utm_medium: l.utmMedium || null,
    utm_campaign: l.utmCampaign || null,
    utm_content: l.utmContent || null,
    utm_term: l.utmTerm || null,
  }))

  await sql`
    INSERT INTO leads_cache ${sql(values)}
    ON CONFLICT (email) DO UPDATE SET
      nombre       = EXCLUDED.nombre,
      telefono     = EXCLUDED.telefono,
      fecha_registro = EXCLUDED.fecha_registro,
      utm_source   = EXCLUDED.utm_source,
      utm_medium   = EXCLUDED.utm_medium,
      utm_campaign = EXCLUDED.utm_campaign,
      utm_content  = EXCLUDED.utm_content,
      utm_term     = EXCLUDED.utm_term,
      synced_at    = NOW()
  `

  return valid.length
}
