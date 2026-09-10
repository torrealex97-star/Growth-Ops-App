import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

const SPREADSHEET_ID = process.env.CC_SPREADSHEET_ID || '1qyUc2PYVFKq9XbJfNKko0mfZoovSKFLaZ19dqje-vOM'
const TARGET_GID = 1432872362

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

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  const allSheets = meta.data.sheets || []
  const allTabs = allSheets.map(s => ({ gid: s.properties?.sheetId, name: s.properties?.title }))

  const targetSheet = allSheets.find(s => s.properties?.sheetId === TARGET_GID) ?? allSheets[0]
  const tabName = targetSheet?.properties?.title || 'Sheet1'

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!1:1`,
  })
  const headers: string[] = (headerRes.data.values?.[0] || [])

  return NextResponse.json({
    spreadsheetId: SPREADSHEET_ID,
    tabName,
    gid: targetSheet?.properties?.sheetId,
    allTabs,
    headers: headers.map((h, i) => ({ index: i, letter: colToLetter(i), name: h })),
  })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg, spreadsheetId: SPREADSHEET_ID }, { status: 500 })
  }
}

function colToLetter(index: number): string {
  let letter = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    letter = String.fromCharCode(65 + rem) + letter
    n = Math.floor((n - 1) / 26)
  }
  return letter
}
