import Papa from 'papaparse'
import {
  Lead,
  KPIStats,
  SurveyStats,
  UTMStats,
  WhatsAppMsgStats,
  AfiliadaStat,
  AfiliadasStats,
  DashboardData,
  SurveyBreakdown,
  UTMCampaignStat,
} from './types'

const SHEETS_CSV_URL =
  process.env.SHEETS_CSV_URL ||
  'https://docs.google.com/spreadsheets/d/1oULwiYM4I6i-8lV7V2OpOS3kdCtGKsMq8qKZeRL3N-I/export?format=csv&gid=1432872362'

const AFILIADAS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1oULwiYM4I6i-8lV7V2OpOS3kdCtGKsMq8qKZeRL3N-I/export?format=csv&gid=2134566001'

function parseRow(row: Record<string, string>): Lead {
  return {
    id: row['ID'] || '',
    fechaRegistro: row['Fecha Registro'] || '',
    nombre: row['Nombre'] || '',
    telefono: row['Telefono'] || '',
    email: row['Email'] || '',
    avatar: row['Avatar'] || '',
    fuente: row['Fuente'] || '',
    afiliado: row['Afiliado'] || '',
    utmSource: row['UTM Source'] || '',
    utmMedium: row['UTM Medium'] || '',
    utmCampaign: row['UTM Campaing'] || '', // note: typo in sheet
    utmContent: row['UTM Content'] || '',
    utmTerm: row['UTM Term'] || '',
    etiqueta: row['Etiqueta'] || '',
    whatsappRegistro: row['WhatsApp Registro']?.trim().toLowerCase() || '',
    encuestaRellenada: row['Encuesta rellenada']?.trim().toLowerCase() === 'si',
    q0Edad: row['0. Edad'] || '',
    q1Fuente: row['1. Fuente'] || '',
    q2Ocupacion: row['2. Ocupación'] || '',
    q3Economia: row['3. Economía'] || '',
    q4Objetivo: row['4. Objetivo'] || '',
    q5Aprender: row['5. Aprender'] || '',
    q6Timing: row['6. Timing'] || '',
    q7Deseo: row['7. Deseo'] || '',
  }
}

function isToday(dateStr: string): boolean {
  if (!dateStr) return false
  try {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    // Try to match common date formats
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) {
      // Try DD/MM/YYYY
      const parts = dateStr.split(/[\/\-\s]/)
      if (parts.length >= 3) {
        const rebuilt = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
        const d2 = new Date(rebuilt)
        if (!isNaN(d2.getTime())) {
          return d2.toISOString().startsWith(todayStr)
        }
      }
      return false
    }
    return d.toISOString().startsWith(todayStr)
  } catch {
    return false
  }
}

function buildBreakdown(
  items: string[],
  total: number
): SurveyBreakdown[] {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const key = item?.trim() || ''
    if (!key) continue
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.entries(counts)
    .map(([label, count]) => ({
      label,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
}

const REUNIONES_SPREADSHEET_ID =
  process.env.CC_SPREADSHEET_ID || '1qyUc2PYVFKq9XbJfNKko0mfZoovSKFLaZ19dqje-vOM'
const REUNIONES_GID = 588106748

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

export async function fetchReuniones(): Promise<ReunionRow[]> {
  // Lazy-import so this file can still be imported in places without googleapis
  const { google } = await import('googleapis')

  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n')
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
  if (!privateKey || !clientEmail) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL/KEY no configurado')
  }

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const sheets = google.sheets({ version: 'v4', auth })

  // Resolve sheet name from gid
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: REUNIONES_SPREADSHEET_ID,
    fields: 'sheets.properties',
  })
  const tabName = meta.data.sheets?.find((s) => s.properties?.sheetId === REUNIONES_GID)?.properties?.title
  if (!tabName) throw new Error(`Tab gid=${REUNIONES_GID} no encontrado en spreadsheet`)

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: REUNIONES_SPREADSHEET_ID,
    range: `'${tabName}'!A:Z`,
  })
  const values = res.data.values || []
  if (values.length < 2) return []

  const headers = values[0].map((h: unknown) => String(h ?? '').trim())
  const idx = (name: string) => headers.indexOf(name)

  const cols = {
    id:            idx('ID'),
    fecha:         idx('Fecha'),
    fechaReunion:  idx('Fecha Reunión'),
    nombreCliente: idx('Nombre Cliente'),
    telefono:      idx('Teléfono'),
    correo:        idx('Correo'),
    estadoReunion: idx('Estado reunión'),
    closer:        idx('Closer'),
    agendadoPor:   idx('Agendado por'),
  }

  const get = (row: unknown[], i: number) => i >= 0 ? String(row[i] ?? '') : ''

  return values.slice(1)
    .map((row) => ({
      id:            get(row, cols.id),
      fecha:         get(row, cols.fecha),
      fechaReunion:  get(row, cols.fechaReunion),
      nombreCliente: get(row, cols.nombreCliente),
      telefono:      get(row, cols.telefono),
      correo:        get(row, cols.correo),
      estadoReunion: get(row, cols.estadoReunion),
      closer:        get(row, cols.closer),
      agendadoPor:   get(row, cols.agendadoPor),
    }))
    .filter((r) => r.id || r.nombreCliente)
}

/** Lightweight fetch — only parses leads, no stats. Used by cold calling panel. */
export async function fetchLeadsOnly(): Promise<Lead[]> {
  const res = await fetch(SHEETS_CSV_URL, { next: { revalidate: 60 }, cache: 'force-cache' })
  if (!res.ok) throw new Error(`Error fetching sheet: ${res.status}`)
  const csvText = await res.text()
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  })
  return parsed.data
    .filter((row) => row['ID'] || row['Nombre'] || row['Email'])
    .map(parseRow)
}

async function fetchAfiliadasNombres(): Promise<Record<string, string>> {
  try {
    const res = await fetch(AFILIADAS_CSV_URL, { next: { revalidate: 300 } })
    if (!res.ok) return {}
    const csv = await res.text()
    const parsed = Papa.parse<Record<string, string>>(csv, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
    })
    const map: Record<string, string> = {}
    for (const row of parsed.data) {
      const email = row['Correo']?.trim().toLowerCase()
      const nombre = row['Nombre']?.trim()
      if (email && nombre) map[email] = nombre
    }
    return map
  } catch {
    return {}
  }
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const [res, nombresMap] = await Promise.all([
    fetch(SHEETS_CSV_URL, { next: { revalidate: 60 } }),
    fetchAfiliadasNombres(),
  ])
  if (!res.ok) {
    throw new Error(`Error fetching sheet: ${res.status} ${res.statusText}`)
  }
  const csvText = await res.text()

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  })

  const leads: Lead[] = parsed.data
    .filter((row) => row['ID'] || row['Nombre'] || row['Email'])
    .map(parseRow)

  const total = leads.length
  const encuestaCount = leads.filter((l) => l.encuestaRellenada).length
  const encuestaWithSurvey = leads.filter((l) => l.encuestaRellenada)

  // Top UTM source
  const sourceCounts: Record<string, number> = {}
  for (const l of leads) {
    const src = l.utmSource?.trim() || 'Directo'
    sourceCounts[src] = (sourceCounts[src] || 0) + 1
  }
  const topFuente =
    Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'

  const leadsHoy = leads.filter((l) => isToday(l.fechaRegistro)).length

  const stats: KPIStats = {
    totalLeads: total,
    encuestaCompletada: encuestaCount,
    encuestaCompletadaPct: total > 0 ? Math.round((encuestaCount / total) * 100) : 0,
    topFuente,
    leadsHoy,
  }

  // Survey stats — only from leads that completed the survey
  const surveyTotal = encuestaWithSurvey.length

  const surveyStats: SurveyStats = {
    edad: buildBreakdown(
      encuestaWithSurvey.map((l) => l.q0Edad),
      surveyTotal
    ),
    fuente: buildBreakdown(
      encuestaWithSurvey.map((l) => l.q1Fuente),
      surveyTotal
    ),
    ocupacion: buildBreakdown(
      encuestaWithSurvey.map((l) => l.q2Ocupacion),
      surveyTotal
    ),
    economia: buildBreakdown(
      encuestaWithSurvey.map((l) => l.q3Economia),
      surveyTotal
    ),
    objetivo: buildBreakdown(
      encuestaWithSurvey.map((l) => l.q4Objetivo),
      surveyTotal
    ),
    aprender: buildBreakdown(
      encuestaWithSurvey.map((l) => l.q5Aprender),
      surveyTotal
    ),
    timing: buildBreakdown(
      encuestaWithSurvey.map((l) => l.q6Timing),
      surveyTotal
    ),
  }

  // UTM Stats
  const bySource = buildBreakdown(
    leads.map((l) => l.utmSource?.trim() || 'Directo'),
    total
  )

  // By campaign + content + term (ad name)
  const campaignMap: Record<
    string,
    { total: number; encuesta: number; content: string; term: string }
  > = {}
  for (const l of leads) {
    const campaign = l.utmCampaign?.trim() || '—'
    const content = l.utmContent?.trim() || '—'
    const term = l.utmTerm?.trim() || '—'
    const key = `${campaign}||${content}||${term}`
    if (!campaignMap[key]) {
      campaignMap[key] = { total: 0, encuesta: 0, content, term }
    }
    campaignMap[key].total++
    if (l.encuestaRellenada) campaignMap[key].encuesta++
  }

  const byCampaign: UTMCampaignStat[] = Object.entries(campaignMap)
    .map(([key, val]) => {
      const [campaign] = key.split('||')
      const pct =
        val.total > 0 ? Math.round((val.encuesta / val.total) * 100) : 0
      return {
        campaign,
        content: val.content,
        term: val.term,
        totalLeads: val.total,
        encuestaCount: val.encuesta,
        encuestaPct: pct,
        score: pct,
      }
    })
    .sort((a, b) => b.totalLeads - a.totalLeads)

  // By ad name (utm_term) — ranking de anuncios individuales
  const byAd = buildBreakdown(
    leads.map((l) => l.utmTerm?.trim() || '—'),
    total
  ).filter((d) => d.label !== '—')

  const utmStats: UTMStats = { bySource, byCampaign, byAd }

  // WhatsApp mensajes stats
  const enviados = leads.filter(l => l.whatsappRegistro === 'enviado').length
  const timeout = leads.filter(l => l.whatsappRegistro === 'timeout').length
  const fallidos = leads.filter(l => l.whatsappRegistro === 'fallido').length
  const totalEntregados = enviados + timeout
  const totalContactados = enviados + timeout + fallidos
  const whatsappStats: WhatsAppMsgStats = {
    enviados,
    timeout,
    fallidos,
    pendientes: total - totalContactados,
    totalContactados,
    totalEntregados,
    tasaEntrega: totalContactados > 0 ? Math.round((totalEntregados / totalContactados) * 100) : 0,
    tasaInteraccion: totalEntregados > 0 ? Math.round((enviados / totalEntregados) * 100) : 0,
    pctLeadsContactados: total > 0 ? Math.round((totalContactados / total) * 100) : 0,
  }

  // Afiliadas stats — leads where utm_medium contains "afiliaci" (handles "Afiliación", "afiliacion", etc.)
  const afiliadaLeads = leads.filter((l) =>
    l.utmMedium?.toLowerCase().includes('afiliaci')
  )
  const totalLeadsAfiliadas = afiliadaLeads.length
  const afiliadaMap: Record<string, number> = {}
  for (const l of afiliadaLeads) {
    const email = l.utmContent?.trim() || 'Desconocida'
    afiliadaMap[email] = (afiliadaMap[email] || 0) + 1
  }
  const ranking: AfiliadaStat[] = Object.entries(afiliadaMap)
    .map(([email, count]) => ({
      email,
      nombre: nombresMap[email.toLowerCase()] || email,
      leads: count,
      pct: totalLeadsAfiliadas > 0 ? Math.round((count / totalLeadsAfiliadas) * 100) : 0,
    }))
    .sort((a, b) => b.leads - a.leads)

  const afiliadasStats: AfiliadasStats = {
    totalLeadsAfiliadas,
    pctOfTotal: total > 0 ? Math.round((totalLeadsAfiliadas / total) * 100) : 0,
    ranking,
  }

  return {
    leads,
    stats,
    surveyStats,
    utmStats,
    whatsappStats,
    afiliadasStats,
    lastUpdated: new Date().toISOString(),
  }
}

export function buildAIContext(data: DashboardData): string {
  const { stats, surveyStats, utmStats, leads } = data
  const lines: string[] = [
    `=== THE CLOSER CLUB — DATOS DE LANZAMIENTO (${new Date().toLocaleDateString('es-ES')}) ===`,
    '',
    `RESUMEN GENERAL:`,
    `- Total leads registrados: ${stats.totalLeads}`,
    `- Encuesta completada: ${stats.encuestaCompletada} (${stats.encuestaCompletadaPct}%)`,
    `- Leads de hoy: ${stats.leadsHoy}`,
    `- Top fuente UTM: ${stats.topFuente}`,
    '',
    `PROCEDENCIA (¿dónde te encontraron?):`,
    ...surveyStats.fuente.map(
      (f) => `  - ${f.label}: ${f.count} (${f.pct}%)`
    ),
    '',
    `EDAD:`,
    ...surveyStats.edad.map((f) => `  - ${f.label}: ${f.count} (${f.pct}%)`),
    '',
    `OCUPACIÓN:`,
    ...surveyStats.ocupacion.map(
      (f) => `  - ${f.label}: ${f.count} (${f.pct}%)`
    ),
    '',
    `INDEPENDENCIA ECONÓMICA:`,
    ...surveyStats.economia.map(
      (f) => `  - ${f.label}: ${f.count} (${f.pct}%)`
    ),
    '',
    `SITUACIÓN ACTUAL:`,
    ...surveyStats.objetivo.map(
      (f) => `  - ${f.label}: ${f.count} (${f.pct}%)`
    ),
    '',
    `QUÉ QUIEREN APRENDER:`,
    ...surveyStats.aprender.map(
      (f) => `  - ${f.label}: ${f.count} (${f.pct}%)`
    ),
    '',
    `TIMING (cuánto tiempo llevan siguiéndola):`,
    ...surveyStats.timing.map(
      (f) => `  - ${f.label}: ${f.count} (${f.pct}%)`
    ),
    '',
    `UTM SOURCES:`,
    ...utmStats.bySource.map(
      (f) => `  - ${f.label}: ${f.count} leads (${f.pct}%)`
    ),
    '',
    `TOP CAMPAÑAS UTM (por volumen):`,
    ...utmStats.byCampaign.slice(0, 10).map(
      (c) =>
        `  - Campaña "${c.campaign}" / AdSet "${c.content}" / Anuncio "${c.term}": ${c.totalLeads} leads, ${c.encuestaPct}% encuesta`
    ),
    '',
    `TOP ANUNCIOS (utm_term — nombre del anuncio):`,
    ...utmStats.byAd.slice(0, 10).map(
      (a) => `  - "${a.label}": ${a.count} leads (${a.pct}%)`
    ),
  ]
  return lines.join('\n')
}
