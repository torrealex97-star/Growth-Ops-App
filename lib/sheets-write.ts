import { google } from 'googleapis'

const SPREADSHEET_ID = process.env.CC_SPREADSHEET_ID || '1qyUc2PYVFKq9XbJfNKko0mfZoovSKFLaZ19dqje-vOM'

const VENTAS_GID    = 795312274
const REUNIONES_GID = 588106748

// Known column layout (verified via debug-headers — tab "Registros Funnel VSL")
// A=ID B=Fecha Registro C=Nombre D=Telefono E=Email ... Y=Coldcalling User Z=Coldcalling Registro AA=Notas
const SHEET_META = {
  tabName: 'Registros Funnel VSL',
  emailCol: 4,        // E
  ccRegistroCol: 25,  // Z
  notasCol: 26,       // AA
  ccUserCol: 24,      // Y
}

function getAuth() {
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n')
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
  return new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

function getSheetMeta() {
  return SHEET_META
}

/** Find the 1-based row number for a lead by email */
async function findLeadRow(sheets: ReturnType<typeof google.sheets>, tabName: string, emailCol: number, leadEmail: string): Promise<number | null> {
  const colLetter = colToLetter(emailCol)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!${colLetter}:${colLetter}`,
  })
  const values: string[][] = res.data.values || []
  for (let i = 1; i < values.length; i++) { // skip header row (index 0)
    if (values[i]?.[0]?.trim().toLowerCase() === leadEmail.toLowerCase()) {
      return i + 1 // 1-based row number
    }
  }
  return null
}

async function getSheetNameByGid(gid: number): Promise<string> {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties',
  })
  const sheet = res.data.sheets?.find((s) => s.properties?.sheetId === gid)
  return sheet?.properties?.title ?? String(gid)
}

function colToLetter(index: number): string {
  let letter = ''
  let n = index + 1 // 1-based
  while (n > 0) {
    const rem = (n - 1) % 26
    letter = String.fromCharCode(65 + rem) + letter
    n = Math.floor((n - 1) / 26)
  }
  return letter
}

/**
 * Batch-updates the "Coldcalling User" column for multiple leads at once.
 * Fetches the email column once, builds a row-map, then does a single batchUpdate.
 */
export async function syncAssignmentsToSheet(
  assignments: { leadEmail: string; callerNombre: string }[]
): Promise<void> {
  if (assignments.length === 0) return
  try {
    const auth = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })
    const meta = getSheetMeta()

    // Build lookup: email → callerNombre
    const assignMap = new Map<string, string>()
    for (const { leadEmail, callerNombre } of assignments) {
      assignMap.set(leadEmail.trim().toLowerCase(), callerNombre)
    }

    // Fetch entire email column in one request (rows 2+, skip header)
    const emailColLetter = colToLetter(meta.emailCol)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${meta.tabName}'!${emailColLetter}2:${emailColLetter}`,
    })
    const emailValues: string[][] = res.data.values || []
    if (emailValues.length === 0) return

    // Build the full Coldcalling User column as one array (same length as email column)
    // Empty string = leave untouched (but we overwrite all to keep sheet consistent)
    const userColData: string[][] = emailValues.map((row) => {
      const email = row[0]?.trim().toLowerCase() || ''
      return [assignMap.get(email) || '']
    })

    // Write entire column in a single request (2x faster than individual ranges)
    const userColLetter = colToLetter(meta.ccUserCol)
    const lastRow = emailValues.length + 1 // +1 because we start at row 2
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${meta.tabName}'!${userColLetter}2:${userColLetter}${lastRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: userColData },
    })
  } catch (err) {
    console.error('Sheets sync assignments error:', err)
    throw err
  }
}

export interface SaleRowData {
  id: number
  fecha: string
  nombre: string
  apellido: string
  telefono: string
  email: string
  plataforma: string
  valor: number | null
  tipo_pago: string
  cash_collected: number | null
  closer_nombre: string
  setter_nombre: string
}

/**
 * Appends a new sale row to the ventas sheet (gid=795312274).
 * Columns A–L: ID | Fecha | Nombre | Apellido | Telefono | Email | Plataforma | Valor | Tipo de Pago | Cash Collected | Closer | Setter
 * Returns the 1-based row number of the appended row.
 */
export async function appendSaleRow(data: SaleRowData): Promise<number> {
  try {
    const auth = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })
    const tabName = await getSheetNameByGid(VENTAS_GID)

    const row = [
      String(data.id),
      data.fecha,
      data.nombre,
      data.apellido,
      data.telefono,
      data.email,
      data.plataforma,
      data.valor ?? '',
      data.tipo_pago,
      data.cash_collected ?? '',
      data.closer_nombre,
      data.setter_nombre,
    ]

    const res = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A:L`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    })

    const updatedRange = res.data.updates?.updatedRange || ''
    const match = updatedRange.match(/(\d+)$/)
    return match ? parseInt(match[1]) : 0
  } catch (err) {
    console.error('appendSaleRow error:', err)
    throw err
  }
}

/**
 * Updates an existing sale row in the ventas sheet by row number.
 */
export async function updateSaleSheetRow(rowNumber: number, data: Partial<SaleRowData>): Promise<void> {
  if (!rowNumber) return
  try {
    const auth = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })
    const tabName = await getSheetNameByGid(VENTAS_GID)

    const updates: { range: string; values: (string | number)[][] }[] = []

    const colMap: Record<keyof SaleRowData, number> = {
      id: 0, fecha: 1, nombre: 2, apellido: 3, telefono: 4, email: 5,
      plataforma: 6, valor: 7, tipo_pago: 8, cash_collected: 9,
      closer_nombre: 10, setter_nombre: 11,
    }

    for (const [key, val] of Object.entries(data)) {
      const colIdx = colMap[key as keyof SaleRowData]
      if (colIdx === undefined || val === undefined) continue
      updates.push({
        range: `'${tabName}'!${colToLetter(colIdx)}${rowNumber}`,
        values: [[val ?? '']],
      })
    }

    if (updates.length === 0) return

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
    })
  } catch (err) {
    console.error('updateSaleSheetRow error:', err)
  }
}

/**
 * Deletes a sale row from the ventas sheet by clearing all cells in that row.
 * Uses a blank-row approach (clear content) to avoid shifting row numbers of other rows.
 */
export async function deleteSaleSheetRow(rowNumber: number): Promise<void> {
  if (!rowNumber) return
  try {
    const auth = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })
    const tabName = await getSheetNameByGid(VENTAS_GID)

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A${rowNumber}:L${rowNumber}`,
    })
  } catch (err) {
    console.error('deleteSaleSheetRow error:', err)
    throw err
  }
}

export async function updateLeadColdcalling(
  leadEmail: string,
  estado: string,
  notas: string,
  coldCallerNombre: string
): Promise<void> {
  try {
    const auth = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })
    const meta = await getSheetMeta()

    if (meta.emailCol === -1) {
      console.error('Email column not found in sheet')
      return
    }

    const rowNumber = await findLeadRow(sheets, meta.tabName, meta.emailCol, leadEmail)
    if (!rowNumber) {
      console.error(`Lead not found in sheet: ${leadEmail}`)
      return
    }

    const updates: { range: string; values: string[][] }[] = []

    if (meta.ccRegistroCol !== -1) {
      updates.push({
        range: `'${meta.tabName}'!${colToLetter(meta.ccRegistroCol)}${rowNumber}`,
        values: [[estado]],
      })
    }
    if (meta.notasCol !== -1) {
      updates.push({
        range: `'${meta.tabName}'!${colToLetter(meta.notasCol)}${rowNumber}`,
        values: [[notas]],
      })
    }
    if (meta.ccUserCol !== -1) {
      updates.push({
        range: `'${meta.tabName}'!${colToLetter(meta.ccUserCol)}${rowNumber}`,
        values: [[coldCallerNombre]],
      })
    }

    if (updates.length === 0) return

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates,
      },
    })
  } catch (err) {
    // Log but don't throw — DB update is the source of truth
    console.error('Sheets write error:', err)
  }
}
