import postgres from 'postgres'
import { google } from 'googleapis'

const SPREADSHEET_ID = process.env.CC_SPREADSHEET_ID || '1qyUc2PYVFKq9XbJfNKko0mfZoovSKFLaZ19dqje-vOM'
const VENTAS_GID = 795312274

const sql = postgres(process.env.POSTGRES_URL!, {
  ssl: 'require',
  max: 5,
  prepare: false,
  idle_timeout: 20,
})

function getAuth() {
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n')
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
  return new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
}

function normalizePhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '')
  if (digits.startsWith('0034')) return digits.slice(4)
  if (digits.startsWith('34') && digits.length === 11) return digits.slice(2)
  return digits
}

function normName(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseEuroNumber(s: string): number | null {
  if (!s) return null
  const cleaned = String(s).replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

function parseFecha(s: string): string | null {
  if (!s) return null
  const trimmed = s.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  const m = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (m) {
    const [, d, mo, y] = m
    const yyyy = y.length === 2 ? '20' + y : y
    return `${yyyy}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

export interface SyncSalesResult {
  total: number
  inserted: number
  skipped: number
  unmatchedCloser: number
  unmatchedSetter: number
  unmatchedLead: number
  errors: string[]
  unmatchedCloserNames: string[]
  unmatchedSetterNames: string[]
  backfilledSetter: number
}

/**
 * Match a name from the sheet ("Paula", "Almu", "Carmina/Maria Mora") to a DB id.
 * Strategies: full exact → first name → contains substring → first token of compound.
 */
function buildNameMatcher(items: { id: number; nombre: string }[]) {
  const fullMap = new Map<string, number>()      // "almudena larranaga" → id
  const firstMap = new Map<string, number[]>()   // "almudena" → [id]
  const tokenMap = new Map<string, number[]>()   // "almu" → [id] (3+ char prefixes)

  for (const it of items) {
    const full = normName(it.nombre)
    if (full) fullMap.set(full, it.id)
    const tokens = full.split(' ').filter(Boolean)
    if (tokens[0]) {
      const arr = firstMap.get(tokens[0]) || []
      arr.push(it.id); firstMap.set(tokens[0], arr)
      // Also index 3-7 char prefixes of first name (catches "almu" → "almudena")
      for (let len = 3; len <= Math.min(tokens[0].length, 7); len++) {
        const pre = tokens[0].slice(0, len)
        const a = tokenMap.get(pre) || []
        if (!a.includes(it.id)) { a.push(it.id); tokenMap.set(pre, a) }
      }
    }
  }

  return (rawName: string): number | null => {
    if (!rawName) return null
    // Joint sales like "Carmina/Maria Mora" or "Ana & Paula" → take the first
    const primary = rawName.split(/[\/&,;]/)[0]
    const norm = normName(primary)
    if (!norm) return null

    if (fullMap.has(norm)) return fullMap.get(norm)!

    // First name exact match
    const firstToken = norm.split(' ')[0]
    const firstHits = firstMap.get(firstToken)
    if (firstHits && firstHits.length === 1) return firstHits[0]

    // Prefix match (e.g. "almu" → "almudena")
    if (firstToken.length >= 3) {
      const prefHits = tokenMap.get(firstToken)
      if (prefHits && prefHits.length === 1) return prefHits[0]
    }

    // Fuzzy: contains check both ways for short names typed loosely
    let fuzzyHit: number | null = null
    fullMap.forEach((id, full) => {
      if (fuzzyHit !== null) return
      if (full.includes(norm) || norm.includes(full.split(' ')[0])) {
        const fullFirst = full.split(' ')[0]
        if (fullFirst[0] === firstToken[0]) fuzzyHit = id
      }
    })
    return fuzzyHit
  }
}

export async function syncSalesFromSheet(): Promise<SyncSalesResult> {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties',
  })
  const tab = meta.data.sheets?.find(s => s.properties?.sheetId === VENTAS_GID)?.properties?.title
  if (!tab) throw new Error(`Tab gid=${VENTAS_GID} no encontrado`)

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tab}'!A:Z`,
  })
  const rows = res.data.values || []
  if (rows.length < 2) {
    return { total: 0, inserted: 0, skipped: 0, unmatchedCloser: 0, unmatchedSetter: 0, unmatchedLead: 0, errors: [], unmatchedCloserNames: [], unmatchedSetterNames: [], backfilledSetter: 0 }
  }

  const headers = rows[0].map((h: unknown) => String(h ?? '').trim())
  const idx = (name: string) => headers.findIndex((h: string) => h.toLowerCase() === name.toLowerCase())
  const c = {
    fecha:          idx('Fecha'),
    nombre:         idx('Nombre'),
    apellido:       idx('Apellido'),
    telefono:       idx('Telefono') >= 0 ? idx('Telefono') : idx('Teléfono'),
    email:          idx('Email'),
    plataforma:     idx('Plataforma'),
    valor:          idx('Valor'),
    tipo_pago:      idx('Tipo de Pago') >= 0 ? idx('Tipo de Pago') : idx('Tipo Pago'),
    cash_collected: idx('Cash Collected'),
    closer:         idx('Closer'),
    setter:         idx('Setter'),
    cobrador:       idx('Cobrador'),
  }
  const get = (row: unknown[], i: number) => i >= 0 ? String(row[i] ?? '').trim() : ''

  const [existing, closers, ccs, leads, assignments] = await Promise.all([
    sql<{ id: number; sheet_row: number | null; email: string | null; fecha: string; cash_collected: string | null; coldcaller_id: number | null; closer_id: number | null }[]>`
      SELECT id, sheet_row, email, fecha::text, cash_collected::text, coldcaller_id, closer_id FROM launch_sales
    `,
    sql<{ id: number; nombre: string }[]>`SELECT id, nombre FROM launch_closers`,
    sql<{ id: number; nombre: string }[]>`SELECT id, nombre FROM cold_callers`,
    sql<{
      email: string; telefono: string;
      utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
      utm_content: string | null; utm_term: string | null;
    }[]>`
      SELECT email, telefono, utm_source, utm_medium, utm_campaign, utm_content, utm_term
      FROM leads_cache
    `,
    sql<{ lead_email: string; coldcaller_id: number; telefono: string | null }[]>`
      SELECT la.lead_email, la.coldcaller_id, lc.telefono
      FROM lead_assignments la
      LEFT JOIN leads_cache lc ON lc.email = la.lead_email
    `,
  ])

  // Map for fallback: email/phone → coldcaller_id assigned to call this lead
  const assignByEmail = new Map<string, number>()
  const assignByPhone = new Map<string, number>()
  for (const a of assignments) {
    assignByEmail.set(a.lead_email.toLowerCase(), a.coldcaller_id)
    if (a.telefono) {
      const n = normalizePhone(a.telefono)
      const suffix = n.length > 9 ? n.slice(-9) : n
      if (suffix) assignByPhone.set(suffix, a.coldcaller_id)
    }
  }

  const existingRows = new Set<number>()
  const existingKey = new Set<string>()
  for (const e of existing) {
    if (e.sheet_row) existingRows.add(e.sheet_row)
    existingKey.add(`${(e.email || '').toLowerCase()}|${e.fecha}|${e.cash_collected ?? ''}`)
  }

  const matchCloser = buildNameMatcher(closers)
  const matchCC     = buildNameMatcher(ccs)

  const leadByEmail = new Map<string, typeof leads[number]>()
  const leadByPhone = new Map<string, typeof leads[number]>()
  for (const l of leads) {
    if (l.email) leadByEmail.set(l.email.toLowerCase(), l)
    if (l.telefono) {
      const n = normalizePhone(l.telefono)
      const suffix = n.length > 9 ? n.slice(-9) : n
      if (suffix) leadByPhone.set(suffix, l)
    }
  }

  const result: SyncSalesResult = {
    total: rows.length - 1,
    inserted: 0,
    skipped: 0,
    unmatchedCloser: 0,
    unmatchedSetter: 0,
    unmatchedLead: 0,
    errors: [],
    unmatchedCloserNames: [],
    unmatchedSetterNames: [],
    backfilledSetter: 0,
  }
  const unmatchedCloserSet = new Set<string>()
  const unmatchedSetterSet = new Set<string>()

  const toInsert: Array<{ values: Record<string, unknown>; sheetRow: number }> = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const sheetRow = i + 1
    if (existingRows.has(sheetRow)) { result.skipped++; continue }

    const email = get(row, c.email).toLowerCase()
    const fecha = parseFecha(get(row, c.fecha))
    const cash = parseEuroNumber(get(row, c.cash_collected))
    const valor = parseEuroNumber(get(row, c.valor))
    const nombre = get(row, c.nombre)
    const apellido = get(row, c.apellido)
    const telefono = get(row, c.telefono)
    const plataforma = get(row, c.plataforma) || null
    const tipoPago = get(row, c.tipo_pago) || null
    const closerName   = get(row, c.closer)
    const setterName   = get(row, c.setter)
    const cobradorName = get(row, c.cobrador)

    if (!email && !nombre) { result.skipped++; continue }
    if (!fecha) { result.skipped++; continue }

    const key = `${email}|${fecha}|${cash ?? ''}`
    if (existingKey.has(key)) { result.skipped++; continue }

    const closerId = matchCloser(closerName)
    if (!closerId) {
      result.unmatchedCloser++
      if (closerName) unmatchedCloserSet.add(closerName)
      result.skipped++
      continue
    }

    const phoneNorm = normalizePhone(telefono)
    const phoneKey = phoneNorm.length > 9 ? phoneNorm.slice(-9) : phoneNorm

    // Resolve cobrador → coldcaller_id (the person handling collection/closing)
    let ccId: number | null = matchCC(cobradorName)
    if (!ccId && cobradorName) ccId = null
    // Fallback: if no cobrador in sheet, look up via lead_assignments by email/phone
    if (!ccId && !cobradorName) {
      ccId = (email && assignByEmail.get(email)) || (phoneKey && assignByPhone.get(phoneKey)) || null
    }
    if (!ccId && cobradorName) {
      result.unmatchedSetter++
      unmatchedSetterSet.add(cobradorName)
    }

    // Resolve setter → setter_id (the person who set the meeting)
    const setterId = matchCC(setterName)
    if (!setterId && setterName) {
      result.unmatchedSetter++
      unmatchedSetterSet.add(setterName)
    }

    const lead = (email && leadByEmail.get(email)) || (phoneKey && leadByPhone.get(phoneKey)) || null
    if (!lead) result.unmatchedLead++

    const isAfiliado = lead?.utm_medium?.toLowerCase().includes('afiliaci') ?? false
    const afiliadoEmail = isAfiliado ? (lead?.utm_content || null) : null

    toInsert.push({
      sheetRow,
      values: {
        fecha, nombre, apellido: apellido || null, telefono: telefono || null, email: email || null,
        plataforma, valor, tipo_pago: tipoPago, cash_collected: cash,
        closer_id: closerId, coldcaller_id: ccId, setter_id: setterId,
        lead_email: lead?.email || null, afiliado_email: afiliadoEmail,
        utm_source: lead?.utm_source ?? null, utm_medium: lead?.utm_medium ?? null,
        utm_campaign: lead?.utm_campaign ?? null, utm_content: lead?.utm_content ?? null,
        utm_term: lead?.utm_term ?? null, sheet_row: sheetRow,
      },
    })
  }

  // Ensure setter_id column exists (idempotent)
  await sql`ALTER TABLE launch_sales ADD COLUMN IF NOT EXISTS setter_id INT REFERENCES cold_callers(id) ON DELETE SET NULL`

  // Parallel inserts in batches of 25
  const batchSize = 25
  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = toInsert.slice(i, i + batchSize)
    await Promise.all(batch.map(async ({ values: v }) => {
      try {
        await sql`
          INSERT INTO launch_sales (
            fecha, nombre, apellido, telefono, email, plataforma, valor, tipo_pago, cash_collected,
            closer_id, coldcaller_id, setter_id, lead_email, afiliado_email,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term, sheet_row
          ) VALUES (
            ${v.fecha as string}, ${v.nombre as string}, ${v.apellido as string | null},
            ${v.telefono as string | null}, ${v.email as string | null},
            ${v.plataforma as string | null}, ${v.valor as number | null}, ${v.tipo_pago as string | null}, ${v.cash_collected as number | null},
            ${v.closer_id as number}, ${v.coldcaller_id as number | null}, ${v.setter_id as number | null},
            ${v.lead_email as string | null}, ${v.afiliado_email as string | null},
            ${v.utm_source as string | null}, ${v.utm_medium as string | null},
            ${v.utm_campaign as string | null}, ${v.utm_content as string | null},
            ${v.utm_term as string | null}, ${v.sheet_row as number}
          )
        `
        result.inserted++
      } catch (e) {
        result.errors.push(`row ${v.sheet_row}: ${(e as Error).message}`)
      }
    }))
  }

  // Backfill: for existing sales with NULL coldcaller_id, resolve via lead_assignments
  const toBackfill = existing.filter(e => !e.coldcaller_id && e.email)
  const backfillUpdates: Array<{ id: number; ccId: number }> = []
  for (const sale of toBackfill) {
    const em = (sale.email || '').toLowerCase()
    const ccId = assignByEmail.get(em) ?? null
    if (ccId) backfillUpdates.push({ id: sale.id, ccId })
  }
  if (backfillUpdates.length > 0) {
    const batchSize = 25
    for (let i = 0; i < backfillUpdates.length; i += batchSize) {
      const batch = backfillUpdates.slice(i, i + batchSize)
      await Promise.all(batch.map(b => sql`
        UPDATE launch_sales SET coldcaller_id = ${b.ccId}, updated_at = NOW() WHERE id = ${b.id}
      `))
    }
    result.backfilledSetter = backfillUpdates.length
  }

  result.unmatchedCloserNames = Array.from(unmatchedCloserSet)
  result.unmatchedSetterNames = Array.from(unmatchedSetterSet)
  return result
}
