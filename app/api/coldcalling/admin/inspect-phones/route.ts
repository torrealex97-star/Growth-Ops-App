import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

export const maxDuration = 30

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

function getAuth() {
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n')
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
  return new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

const SPREADSHEET_ID = process.env.CC_SPREADSHEET_ID || '1qyUc2PYVFKq9XbJfNKko0mfZoovSKFLaZ19dqje-vOM'
const TARGET_GID = 1432872362

async function getTabName(sheets: ReturnType<typeof google.sheets>) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  return meta.data.sheets?.find(s => s.properties?.sheetId === TARGET_GID)?.properties?.title || 'Sheet1'
}

// GET: inspect error cells — shows formula + formatted value so we can recover the number
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const tabName = await getTabName(sheets)

  const [formattedRes, formulaRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!D1:D`,
      valueRenderOption: 'FORMATTED_VALUE',
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!D1:D`,
      valueRenderOption: 'FORMULA',
    }),
  ])

  const formatted = formattedRes.data.values || []
  const formulas = formulaRes.data.values || []

  const errorCells: { row: number; formula: string; formatted: string; recoverable: boolean; recovered: string }[] = []
  for (let i = 1; i < formatted.length; i++) {
    const fmtVal = String(formatted[i]?.[0] ?? '')
    if (!fmtVal.startsWith('#')) continue
    const formula = String(formulas[i]?.[0] ?? '')
    // Try to recover: strip leading = + - signs and get the digits
    const digits = formula.replace(/^[=+\-\s]+/, '').replace(/\D/g, '')
    const recoverable = digits.length >= 9
    const recovered = recoverable ? digits : ''
    errorCells.push({ row: i + 1, formula, formatted: fmtVal, recoverable, recovered })
  }

  return NextResponse.json({
    tabName,
    total: errorCells.length,
    recoverable: errorCells.filter(c => c.recoverable).length,
    notRecoverable: errorCells.filter(c => !c.recoverable).length,
    samples: errorCells.slice(0, 20),
  })
}

// POST: fix error cells — recover phone number if possible, otherwise clear
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const tabName = await getTabName(sheets)

  const [formattedRes, formulaRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!D1:D`,
      valueRenderOption: 'FORMATTED_VALUE',
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!D1:D`,
      valueRenderOption: 'FORMULA',
    }),
  ])

  const formatted = formattedRes.data.values || []
  const formulas = formulaRes.data.values || []

  const updates: { range: string; values: string[][] }[] = []
  const toClear: string[] = []
  let recovered = 0
  let cleared = 0

  for (let i = 1; i < formatted.length; i++) {
    const fmtVal = String(formatted[i]?.[0] ?? '')
    if (!fmtVal.startsWith('#')) continue

    const formula = String(formulas[i]?.[0] ?? '')
    const digits = formula.replace(/^[=+\-\s]+/, '').replace(/\D/g, '')

    if (digits.length >= 9) {
      // Write recovered number as plain text (prefix with ' to force text)
      updates.push({ range: `'${tabName}'!D${i + 1}`, values: [[digits]] })
      recovered++
    } else {
      toClear.push(`'${tabName}'!D${i + 1}`)
      cleared++
    }
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'RAW', data: updates },
    })
  }

  if (toClear.length > 0) {
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { ranges: toClear },
    })
  }

  return NextResponse.json({ recovered, cleared })
}
