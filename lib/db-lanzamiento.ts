import postgres from 'postgres'

const sql = postgres(process.env.POSTGRES_URL!, {
  ssl: 'require',
  max: 8,
  prepare: false, // required for Supabase pooler (PgBouncer transaction mode)
  idle_timeout: 20,
  max_lifetime: 60 * 30,
})

// ── Types ─────────────────────────────────────────────────────────

export interface LaunchCloser {
  id: number
  email: string
  nombre: string
  activa: boolean
  created_at: string
}

export interface LaunchSale {
  id: number
  fecha: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  email: string | null
  plataforma: string | null
  valor: number | null
  tipo_pago: string | null
  cash_collected: number | null
  closer_id: number | null
  closer_nombre?: string
  coldcaller_id: number | null
  coldcaller_nombre?: string
  setter_id: number | null
  setter_nombre?: string
  lead_email: string | null
  afiliado_email: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  status: 'active' | 'refunded' | null
  nota: string | null
  sheet_row: number | null
  created_at: string
  updated_at: string
}

export interface LaunchMeeting {
  id: number
  external_id: string | null
  lead_email: string | null
  lead_phone: string | null
  coldcaller_id: number | null
  coldcaller_nombre?: string
  meeting_date: string | null
  estado: string | null
  closer_name: string | null
  agendado_por: string | null
  nombre_cliente: string | null
  synced_at: string
}

export interface ReunionRow {
  id: string
  fecha: string
  fechaReunion: string
  nombreCliente: string
  telefono: string
  correo: string
  estadoReunion: string
  closer: string
  agendadoPor: string
}

// ── Closers ───────────────────────────────────────────────────────

export async function getCloserByEmail(email: string): Promise<(LaunchCloser & { password_hash: string }) | null> {
  const rows = await sql<(LaunchCloser & { password_hash: string })[]>`
    SELECT id, email, nombre, activa, password_hash, created_at
    FROM launch_closers WHERE email = ${email.toLowerCase()}
  `
  return rows[0] ?? null
}

export async function getCloserById(id: number): Promise<LaunchCloser | null> {
  const rows = await sql<LaunchCloser[]>`
    SELECT id, email, nombre, activa, created_at FROM launch_closers WHERE id = ${id}
  `
  return rows[0] ?? null
}

export async function getAllClosers(): Promise<LaunchCloser[]> {
  return sql<LaunchCloser[]>`SELECT id, email, nombre, activa, created_at FROM launch_closers ORDER BY nombre`
}

// ── Meetings ──────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0034')) return digits.slice(4)
  if (digits.startsWith('34') && digits.length === 11) return digits.slice(2)
  return digits
}

export async function syncMeetings(rows: ReunionRow[]): Promise<{ synced: number; matched: number }> {
  const valid = rows.filter(r => r.id)
  if (valid.length === 0) return { synced: 0, matched: 0 }

  // Pre-load all (email → coldcaller_id) and (phone-suffix → coldcaller_id) maps in two queries
  const allAssignments = await sql<{ lead_email: string; coldcaller_id: number; telefono: string | null }[]>`
    SELECT la.lead_email, la.coldcaller_id, lc.telefono
    FROM lead_assignments la
    LEFT JOIN leads_cache lc ON lc.email = la.lead_email
  `

  const emailMap = new Map<string, number>()
  const phoneMap = new Map<string, number>() // suffix-key (last 9 digits) → coldcaller_id
  for (const a of allAssignments) {
    emailMap.set(a.lead_email.toLowerCase(), a.coldcaller_id)
    if (a.telefono) {
      const digits = a.telefono.replace(/\D/g, '')
      const suffix = digits.length > 9 ? digits.slice(-9) : digits
      if (suffix) phoneMap.set(suffix, a.coldcaller_id)
    }
  }

  // Build resolved rows
  const resolved = valid.map(row => {
    const emailNorm = row.correo?.trim().toLowerCase() || null
    const phoneNorm = row.telefono ? normalizePhone(row.telefono) : null
    const phoneKey = phoneNorm ? (phoneNorm.length > 9 ? phoneNorm.slice(-9) : phoneNorm) : null
    const ccId = (emailNorm && emailMap.get(emailNorm))
      ?? (phoneKey && phoneMap.get(phoneKey))
      ?? null
    return {
      external_id:    row.id,
      lead_email:     emailNorm,
      lead_phone:     phoneNorm,
      coldcaller_id:  ccId,
      meeting_date:   row.fechaReunion || null,
      estado:         row.estadoReunion || null,
      closer_name:    row.closer || null,
      agendado_por:   row.agendadoPor || null,
      nombre_cliente: row.nombreCliente || null,
    }
  })

  const matched = resolved.filter(r => r.coldcaller_id !== null).length

  // Parallel upserts in batches of 25 (avoids exhausting the 3-conn pool while staying fast)
  const batchSize = 25
  for (let i = 0; i < resolved.length; i += batchSize) {
    const batch = resolved.slice(i, i + batchSize)
    await Promise.all(batch.map(r => sql`
      INSERT INTO launch_meetings (external_id, lead_email, lead_phone, coldcaller_id, meeting_date, estado, closer_name, agendado_por, nombre_cliente, synced_at)
      VALUES (${r.external_id}, ${r.lead_email}, ${r.lead_phone}, ${r.coldcaller_id}, ${r.meeting_date}, ${r.estado}, ${r.closer_name}, ${r.agendado_por}, ${r.nombre_cliente}, NOW())
      ON CONFLICT (external_id) DO UPDATE SET
        lead_email     = EXCLUDED.lead_email,
        lead_phone     = EXCLUDED.lead_phone,
        coldcaller_id  = EXCLUDED.coldcaller_id,
        meeting_date   = EXCLUDED.meeting_date,
        estado         = EXCLUDED.estado,
        closer_name    = EXCLUDED.closer_name,
        agendado_por   = EXCLUDED.agendado_por,
        nombre_cliente = EXCLUDED.nombre_cliente,
        synced_at      = NOW()
    `))
  }

  return { synced: resolved.length, matched }
}

// ── Sales ─────────────────────────────────────────────────────────

export interface RegisterSaleInput {
  fecha: string
  nombre: string
  apellido: string
  telefono: string
  email: string
  plataforma: string | null
  valor: number | null
  tipo_pago: string
  cash_collected: number | null
  closer_id: number
  coldcaller_id?: number | null
  setter_id?: number | null
  lead_email?: string | null
  afiliado_email?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
  status?: 'active' | 'refunded'
  nota?: string | null
}

export async function registerSale(input: RegisterSaleInput): Promise<LaunchSale> {
  const rows = await sql<LaunchSale[]>`
    INSERT INTO launch_sales (
      fecha, nombre, apellido, telefono, email, plataforma, valor, tipo_pago, cash_collected,
      closer_id, coldcaller_id, setter_id, lead_email, afiliado_email,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, status, nota
    ) VALUES (
      ${input.fecha}, ${input.nombre}, ${input.apellido}, ${input.telefono}, ${input.email},
      ${input.plataforma}, ${input.valor}, ${input.tipo_pago}, ${input.cash_collected},
      ${input.closer_id}, ${input.coldcaller_id ?? null}, ${input.setter_id ?? null}, ${input.lead_email ?? null}, ${input.afiliado_email ?? null},
      ${input.utm_source ?? null}, ${input.utm_medium ?? null}, ${input.utm_campaign ?? null},
      ${input.utm_content ?? null}, ${input.utm_term ?? null},
      ${input.status ?? 'active'}, ${input.nota ?? null}
    )
    RETURNING *
  `
  return rows[0]
}

export async function updateSaleSheetRow(id: number, sheetRow: number): Promise<void> {
  await sql`UPDATE launch_sales SET sheet_row = ${sheetRow} WHERE id = ${id}`
}

export async function deleteSale(id: number): Promise<{ sheet_row: number | null }> {
  const rows = await sql<{ sheet_row: number | null }[]>`
    DELETE FROM launch_sales WHERE id = ${id} RETURNING sheet_row
  `
  return rows[0] ?? { sheet_row: null }
}

export async function getSales(filters?: { closerId?: number; coldcallerId?: number }): Promise<LaunchSale[]> {
  if (filters?.closerId) {
    return sql<LaunchSale[]>`
      SELECT ls.*, lc.nombre as closer_nombre, cc.nombre as coldcaller_nombre, st.nombre as setter_nombre
      FROM launch_sales ls
      LEFT JOIN launch_closers lc ON lc.id = ls.closer_id
      LEFT JOIN cold_callers cc ON cc.id = ls.coldcaller_id
      LEFT JOIN cold_callers st ON st.id = ls.setter_id
      WHERE ls.closer_id = ${filters.closerId}
      ORDER BY ls.created_at DESC
    `
  }
  if (filters?.coldcallerId) {
    return sql<LaunchSale[]>`
      SELECT ls.*, lc.nombre as closer_nombre, cc.nombre as coldcaller_nombre, st.nombre as setter_nombre
      FROM launch_sales ls
      LEFT JOIN launch_closers lc ON lc.id = ls.closer_id
      LEFT JOIN cold_callers cc ON cc.id = ls.coldcaller_id
      LEFT JOIN cold_callers st ON st.id = ls.setter_id
      WHERE ls.coldcaller_id = ${filters.coldcallerId}
      ORDER BY ls.created_at DESC
    `
  }
  return sql<LaunchSale[]>`
    SELECT ls.*, lc.nombre as closer_nombre, cc.nombre as coldcaller_nombre, st.nombre as setter_nombre
    FROM launch_sales ls
    LEFT JOIN launch_closers lc ON lc.id = ls.closer_id
    LEFT JOIN cold_callers cc ON cc.id = ls.coldcaller_id
    LEFT JOIN cold_callers st ON st.id = ls.setter_id
    ORDER BY ls.created_at DESC
  `
}

export async function updateSaleSetter(id: number, setterId: number | null): Promise<void> {
  await sql`UPDATE launch_sales SET setter_id = ${setterId}, updated_at = NOW() WHERE id = ${id}`
}

export async function updateSale(id: number, fields: {
  coldcaller_id?: number | null
  setter_id?: number | null
  afiliado_email?: string | null
  plataforma?: string | null
  tipo_pago?: string
  cash_collected?: number
  valor?: number
  closer_id?: number | null
  fecha?: string
  nombre?: string | null
  apellido?: string | null
  telefono?: string | null
  email?: string | null
  status?: 'active' | 'refunded'
  nota?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
}): Promise<LaunchSale> {
  // Only set columns explicitly provided in `fields` so callers can clear values to NULL
  // and we don't blanket-coalesce-back to existing values.
  const sets: string[] = []
  const values: unknown[] = []
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = $${sets.length + 1}`)
    values.push(val)
  }
  if (fields.coldcaller_id !== undefined)   push('coldcaller_id', fields.coldcaller_id)
  if (fields.setter_id !== undefined)       push('setter_id', fields.setter_id)
  if (fields.afiliado_email !== undefined)  push('afiliado_email', fields.afiliado_email)
  if (fields.plataforma !== undefined)      push('plataforma', fields.plataforma)
  if (fields.tipo_pago !== undefined)       push('tipo_pago', fields.tipo_pago)
  if (fields.cash_collected !== undefined)  push('cash_collected', fields.cash_collected)
  if (fields.valor !== undefined)           push('valor', fields.valor)
  if (fields.closer_id !== undefined)       push('closer_id', fields.closer_id)
  if (fields.fecha !== undefined)           push('fecha', fields.fecha)
  if (fields.nombre !== undefined)          push('nombre', fields.nombre)
  if (fields.apellido !== undefined)        push('apellido', fields.apellido)
  if (fields.telefono !== undefined)        push('telefono', fields.telefono)
  if (fields.email !== undefined)           push('email', fields.email)
  if (fields.status !== undefined)          push('status', fields.status)
  if (fields.nota !== undefined)            push('nota', fields.nota)
  if (fields.utm_source !== undefined)      push('utm_source', fields.utm_source)
  if (fields.utm_medium !== undefined)      push('utm_medium', fields.utm_medium)
  if (fields.utm_campaign !== undefined)    push('utm_campaign', fields.utm_campaign)
  if (fields.utm_content !== undefined)     push('utm_content', fields.utm_content)
  if (fields.utm_term !== undefined)        push('utm_term', fields.utm_term)

  // Build a plain object of changed columns and let postgres-js expand it
  // via `sql(obj)` into the SET clause. Avoids manual placeholder bookkeeping.
  const changed: Record<string, unknown> = {}
  for (let i = 0; i < sets.length; i++) {
    // sets[i] looks like 'col = $N' — extract the column name
    const col = sets[i].split(' = ')[0]
    changed[col] = values[i]
  }

  if (Object.keys(changed).length === 0) {
    const cur = await sql<LaunchSale[]>`SELECT * FROM launch_sales WHERE id = ${id}`
    return cur[0]
  }

  const rows = await sql<LaunchSale[]>`
    UPDATE launch_sales SET ${sql(changed)}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `
  return rows[0]
}

// ── Lead lookup (for closer sale form) ────────────────────────────

export interface LeadLookupResult {
  found: boolean
  lead?: {
    nombre: string
    email: string
    telefono: string
    utm_source: string | null
    utm_medium: string | null
    utm_campaign: string | null
    utm_content: string | null
    utm_term: string | null
    afiliado_email: string | null
  }
  coldcaller?: { id: number; nombre: string } | null
}

export async function lookupLead(query: string): Promise<LeadLookupResult> {
  const q = query.trim().toLowerCase()
  const phoneDigits = normalizePhone(query)

  const rows = await sql<{
    email: string; nombre: string; telefono: string
    utm_source: string | null; utm_medium: string | null; utm_campaign: string | null
    utm_content: string | null; utm_term: string | null
    coldcaller_id: number | null; coldcaller_nombre: string | null
  }[]>`
    SELECT
      lc.email, lc.nombre, lc.telefono,
      lc.utm_source, lc.utm_medium, lc.utm_campaign, lc.utm_content, lc.utm_term,
      la.coldcaller_id,
      cc.nombre as coldcaller_nombre
    FROM leads_cache lc
    LEFT JOIN lead_assignments la ON la.lead_email = lc.email
    LEFT JOIN cold_callers cc ON cc.id = la.coldcaller_id
    WHERE lc.email = ${q}
       OR regexp_replace(lc.telefono, '[^0-9]', '', 'g') LIKE ${'%' + phoneDigits}
    LIMIT 1
  `

  if (!rows[0]) return { found: false }

  const r = rows[0]
  const isAfiliado = r.utm_medium?.toLowerCase().includes('afiliaci') ?? false

  return {
    found: true,
    lead: {
      nombre: r.nombre,
      email: r.email,
      telefono: r.telefono,
      utm_source: r.utm_source,
      utm_medium: r.utm_medium,
      utm_campaign: r.utm_campaign,
      utm_content: r.utm_content,
      utm_term: r.utm_term,
      afiliado_email: isAfiliado ? (r.utm_content || null) : null,
    },
    coldcaller: r.coldcaller_id ? { id: r.coldcaller_id, nombre: r.coldcaller_nombre! } : null,
  }
}

// ── Admin stats ───────────────────────────────────────────────────

export function calcCCCommission(ventas: number): number {
  if (ventas <= 3) return ventas * 70
  if (ventas <= 6) return ventas * 80
  return ventas * 100
}

export function calcCloserCommission(cashCollected: number): number {
  return Math.round(cashCollected * 0.08 * 100) / 100
}

export interface AdminLaunchStats {
  totals: {
    reuniones: number
    ventas: number
    refunded: number
    facturacion: number
    facturacion_refunded: number
    cash_collected: number
    cash_refunded: number
    pendiente: number
    comision_closers: number
    comision_closers_total: number
    comision_coldcallers: number
  }
  closers: {
    id: number; nombre: string; ventas: number;
    cash_collected: number; facturacion: number; pendiente: number;
    comision: number; comision_actual: number; comision_total: number
  }[]
  coldcallers: {
    id: number; nombre: string; leads: number; reuniones: number;
    ventas: number; ventas_cobrador: number; ventas_setter: number;
    cash_collected: number; comision: number
  }[]
  afiliados: {
    email: string; ventas: number; cash_collected: number
  }[]
  utms: {
    by_source: { value: string; ventas: number; cash_collected: number }[]
    by_medium: { value: string; ventas: number; cash_collected: number }[]
    by_campaign: { value: string; ventas: number; cash_collected: number }[]
  }
}

export async function getAdminLaunchStats(): Promise<AdminLaunchStats> {
  // Note: all commission/aggregate queries below filter `status = 'active'`.
  // Refunded sales remain in the table for visibility but never contribute
  // to commissions or cash totals.
  const [closerRows, ccRows, reunionesCount, afiliadoRows, utmSourceRows, utmMediumRows, utmCampaignRows, refundRow] = await Promise.all([
    sql<{ id: number; nombre: string; ventas: number; cash_collected: number; facturacion: number }[]>`
      SELECT lc.id, lc.nombre,
        COUNT(ls.id)::int                          as ventas,
        COALESCE(SUM(ls.cash_collected), 0)::numeric as cash_collected,
        COALESCE(SUM(ls.valor), 0)::numeric          as facturacion
      FROM launch_closers lc
      LEFT JOIN launch_sales ls ON ls.closer_id = lc.id AND ls.status = 'active'
      GROUP BY lc.id, lc.nombre
      ORDER BY facturacion DESC
    `,
    sql<{ id: number; nombre: string; leads: number; reuniones: number; ventas_cobrador: number; ventas_setter: number; ventas: number; cash_collected: number }[]>`
      SELECT
        cc.id, cc.nombre,
        COALESCE(la.cnt, 0)::int                                  as leads,
        COALESCE(lm.cnt, 0)::int                                  as reuniones,
        COALESCE(ls_cob.cnt, 0)::int                              as ventas_cobrador,
        COALESCE(ls_set.cnt, 0)::int                              as ventas_setter,
        (COALESCE(ls_cob.cnt, 0) + COALESCE(ls_set.cnt, 0))::int  as ventas,
        (COALESCE(ls_cob.cash, 0) + COALESCE(ls_set.cash, 0))::numeric as cash_collected
      FROM cold_callers cc
      LEFT JOIN (SELECT coldcaller_id, COUNT(*) as cnt FROM lead_assignments GROUP BY coldcaller_id) la
        ON la.coldcaller_id = cc.id
      LEFT JOIN (SELECT coldcaller_id, COUNT(*) as cnt FROM launch_meetings WHERE coldcaller_id IS NOT NULL GROUP BY coldcaller_id) lm
        ON lm.coldcaller_id = cc.id
      LEFT JOIN (SELECT coldcaller_id, COUNT(*) as cnt, COALESCE(SUM(cash_collected), 0) as cash
                 FROM launch_sales WHERE coldcaller_id IS NOT NULL AND status = 'active' GROUP BY coldcaller_id) ls_cob
        ON ls_cob.coldcaller_id = cc.id
      LEFT JOIN (SELECT setter_id, COUNT(*) as cnt, COALESCE(SUM(cash_collected), 0) as cash
                 FROM launch_sales WHERE setter_id IS NOT NULL AND status = 'active' GROUP BY setter_id) ls_set
        ON ls_set.setter_id = cc.id
      ORDER BY cash_collected DESC
    `,
    sql<{ count: number }[]>`SELECT COUNT(*)::int as count FROM launch_meetings`,
    sql<{ email: string; ventas: number; cash_collected: number }[]>`
      SELECT afiliado_email as email,
        COUNT(*)::int as ventas,
        COALESCE(SUM(cash_collected), 0)::numeric as cash_collected
      FROM launch_sales
      WHERE afiliado_email IS NOT NULL AND afiliado_email <> '' AND status = 'active'
      GROUP BY afiliado_email
      ORDER BY cash_collected DESC
    `,
    sql<{ value: string; ventas: number; cash_collected: number }[]>`
      SELECT COALESCE(utm_source, '(sin source)') as value,
        COUNT(*)::int as ventas,
        COALESCE(SUM(cash_collected), 0)::numeric as cash_collected
      FROM launch_sales
      WHERE status = 'active'
      GROUP BY utm_source ORDER BY cash_collected DESC
    `,
    sql<{ value: string; ventas: number; cash_collected: number }[]>`
      SELECT COALESCE(utm_medium, '(sin medium)') as value,
        COUNT(*)::int as ventas,
        COALESCE(SUM(cash_collected), 0)::numeric as cash_collected
      FROM launch_sales
      WHERE status = 'active'
      GROUP BY utm_medium ORDER BY cash_collected DESC
    `,
    sql<{ value: string; ventas: number; cash_collected: number }[]>`
      SELECT COALESCE(utm_campaign, '(sin campaign)') as value,
        COUNT(*)::int as ventas,
        COALESCE(SUM(cash_collected), 0)::numeric as cash_collected
      FROM launch_sales
      WHERE status = 'active'
      GROUP BY utm_campaign ORDER BY cash_collected DESC
    `,
    sql<{ refunded: number; cash_refunded: number; facturacion_refunded: number }[]>`
      SELECT
        COUNT(*)::int                                 as refunded,
        COALESCE(SUM(cash_collected), 0)::numeric     as cash_refunded,
        COALESCE(SUM(valor), 0)::numeric              as facturacion_refunded
      FROM launch_sales WHERE status = 'refunded'
    `,
  ])

  const closers = closerRows.map(r => {
    const cash = Number(r.cash_collected)
    const fac = Number(r.facturacion)
    return {
      ...r,
      cash_collected: cash,
      facturacion: fac,
      pendiente: Math.max(fac - cash, 0),
      comision_actual: calcCloserCommission(cash),     // 8% sobre cash ya cobrado
      comision_total:  calcCloserCommission(fac),      // 8% sobre facturación total (cuando se cobre todo)
      // legacy alias for components still reading "comision"
      comision: calcCloserCommission(cash),
    }
  })

  const coldcallers = ccRows.map(r => ({
    ...r,
    cash_collected: Number(r.cash_collected),
    comision: calcCCCommission(r.ventas),
  }))

  const totalCashCollected   = closers.reduce((s, c) => s + c.cash_collected, 0)
  const totalFacturacion     = closers.reduce((s, c) => s + c.facturacion, 0)
  const totalPendiente       = closers.reduce((s, c) => s + c.pendiente, 0)
  const totalComisionClosersActual = closers.reduce((s, c) => s + c.comision_actual, 0)
  const totalComisionClosersTotal  = closers.reduce((s, c) => s + c.comision_total, 0)
  const totalComisionCC      = coldcallers.reduce((s, c) => s + c.comision, 0)
  const totalVentas          = closers.reduce((s, c) => s + c.ventas, 0)

  return {
    totals: {
      reuniones: reunionesCount[0]?.count ?? 0,
      ventas: totalVentas,
      refunded: refundRow[0]?.refunded ?? 0,
      facturacion: totalFacturacion,
      facturacion_refunded: Number(refundRow[0]?.facturacion_refunded ?? 0),
      cash_collected: totalCashCollected,
      cash_refunded: Number(refundRow[0]?.cash_refunded ?? 0),
      pendiente: totalPendiente,
      comision_closers: totalComisionClosersActual,
      comision_closers_total: totalComisionClosersTotal,
      comision_coldcallers: totalComisionCC,
    },
    closers,
    coldcallers,
    afiliados: afiliadoRows.map(r => ({ ...r, cash_collected: Number(r.cash_collected) })),
    utms: {
      by_source: utmSourceRows.map(r => ({ ...r, cash_collected: Number(r.cash_collected) })),
      by_medium: utmMediumRows.map(r => ({ ...r, cash_collected: Number(r.cash_collected) })),
      by_campaign: utmCampaignRows.map(r => ({ ...r, cash_collected: Number(r.cash_collected) })),
    },
  }
}

export async function getColdCallerLaunchStats(callerId: number): Promise<{
  reuniones: number; ventas: number; cash_collected: number; comision: number
}> {
  const [r, s] = await Promise.all([
    sql<{ count: number }[]>`SELECT COUNT(*)::int as count FROM launch_meetings WHERE coldcaller_id = ${callerId}`,
    sql<{ ventas: number; cash_collected: number }[]>`
      SELECT COUNT(*)::int as ventas, COALESCE(SUM(cash_collected), 0)::numeric as cash_collected
      FROM launch_sales
      WHERE (coldcaller_id = ${callerId} OR setter_id = ${callerId})
        AND status = 'active'
    `,
  ])
  const ventas = s[0]?.ventas ?? 0
  const cash = Number(s[0]?.cash_collected ?? 0)
  return {
    reuniones: r[0]?.count ?? 0,
    ventas,
    cash_collected: cash,
    comision: calcCCCommission(ventas),
  }
}

export async function getCloserStats(closerId: number): Promise<{
  ventas: number; cash_collected: number; facturacion: number; pendiente: number;
  comision: number; comision_actual: number; comision_total: number
}> {
  const rows = await sql<{ ventas: number; cash_collected: number; facturacion: number }[]>`
    SELECT
      COUNT(*)::int                                 as ventas,
      COALESCE(SUM(cash_collected), 0)::numeric     as cash_collected,
      COALESCE(SUM(valor), 0)::numeric              as facturacion
    FROM launch_sales
    WHERE closer_id = ${closerId} AND status = 'active'
  `
  const ventas = rows[0]?.ventas ?? 0
  const cash = Number(rows[0]?.cash_collected ?? 0)
  const fac = Number(rows[0]?.facturacion ?? 0)
  return {
    ventas,
    cash_collected: cash,
    facturacion: fac,
    pendiente: Math.max(fac - cash, 0),
    comision: calcCloserCommission(cash),
    comision_actual: calcCloserCommission(cash),
    comision_total: calcCloserCommission(fac),
  }
}
