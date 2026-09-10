import { google } from 'googleapis'

const SPREADSHEET_ID = '1jyOxaqm_xzFH2PBxTSP4Oyu51kLwAcVwj-x7cuBmv_w'

const privateKey = `-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC7DF7mCbBnkA5H\nDrYPj0YvMdXn+bS/U/fKOulBAxYe9dtrroraiOcUo8yurn8qxZYEYbKBF0Vm73Uv\n/uPQ61cXKa3Ch/ixyutfBLFPn+E+HsKgKBwqpJcexdTnz+2qhjdK+I2M1tdqlIip\nOQhC7Nz0eLXjbIQmuWihK9eFVTkoiPGFrk8xjBQOufl6pPsia0COVjRLIMc9TeGJ\nR/quDXDlJlUe1sv0RwHKTtaXahpZjLUJb8ebNTt2aCmKmbWGEwnirgY+iDLVbgUp\nAw2doduupnleUnDAUCy0K1baZ5Qi1c2Q0PB23r4CXrZ0MnYtZ2qsFl452X5Wu0qZ\nj2CaU0oXAgMBAAECggEAElELeKKu7UVJu02b0yQ9mYuGHeRG/eFpchqYvYQMMNX0\njwlAPFbhrL9pi3A3sGbkN45K86HlavISBgmDd5xEIqwzLB8yjFPe/qav/P3JXyhA\no3xUsxxRAXNv/jn5/76K6u2HYaj8M/SoTqHwxtT5F3uRRtxZMzg+ywxHBkh/2Lx9\ncXE/1Q7KsPmz4QFNR3uoCiFJ4rui0LapIyKqc0SEFOWuOpglSgRHdxwq+a4s53VX\nIviC/HuMJn+B+Elj75zxHiqiUVpE1ikgeMz9weyPT5OLkcwg1JIJAtSndDNv8VxK\nNDYmSRJqDqXEedi9EwH4ghhcwhUh9I01o3pHaiiN0QKBgQDbCml3r0iTwEW2KJLE\nWv6FqvjY5SQyw1lbdyYs25OEbIxQdRDSjQrLssEerMADrSyO/06Zj8D8vrlTPv61\n0wKY3eSRVwjxMYsOkB8I24/82ESJltQhE/lvaDfwhi4JyjN8VHRdRHFeMcaRwZZX\nDfkJ6nBBGY7zvpoMn3OPp2e0KQKBgQDanAfhDo7gYkbp+plFEXMa2FrzIBeQRiVU\nCzL1ul7uUO8ZKz2wPR2LGFpMBUPT1R63/1+VKQtczlPUYCJnHtoApQIHHVM13mt3\nw3mA7OYdfFfx7tY+TnhRG3wQfeMvtg9oLddFDqGjX14BbIBf6gDmR0/Pqzf9tzzF\nlqc1hTzUPwKBgEDK8au/o95gz740fkWrDQMJMhcmoPCLLJGLyzUVtqtDWLYsCs/d\nfMYImGu0ehAcV8Ps7ZkrFtEssbFYPwwV4PzLFmOPtUtzdkjWhPefyxXl+1Af15v5\nRp2X3IQ/jLrEnzo12T4FkutkGfLfqtMRhQtT1+TJ5KlhRjxZpltmD50RAoGAN3BS\nXzS97xF9QmEW9XkTY79ycS22TBQ96y5b4g09fdpwiEV7A3K8R0YJwDWlmdb2T1sn\n9j/Obd61S6qFjvk39+ngtcUuEP8y6dBcw+FQCjI6a1RSaMKlqIv7zoLeVn8pMRZO\n/WhUfYX15Q6LD8fcKonzJ4sYS/NoKgOmq9/6KSkCgYB4Dw1Dr6L0X4yowkJGvktm\nG3kkszF9sJuamMA6PQTQNwY2anpJ6efhcH/lY9OIw9wnr3uNNCu3VR0Yx8JhkRvN\nQ5B3wG2Q8oScjUjgXlnYJPI6vACJB/UQEcs17K3YT74N0C8ofa0J8/46PvDDS6r4\n7Je6dlGjhQEHYdYxAEiuUQ==\n-----END PRIVATE KEY-----`.replace(/\\n/g, '\n')

const auth = new google.auth.GoogleAuth({
  credentials: { client_email: 'thecloserclub-sheets@the-closer-club.iam.gserviceaccount.com', private_key: privateKey },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})

async function main() {
  const sheets = google.sheets({ version: 'v4', auth })

  // List all tabs
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  console.log('\n=== TABS ===')
  meta.data.sheets.forEach(s => console.log(` - "${s.properties.title}" (gid: ${s.properties.sheetId}, rows: ${s.properties.gridProperties.rowCount})`))

  // Read each tab headers + sample data
  for (const sheet of meta.data.sheets) {
    const tabName = sheet.properties.title
    console.log(`\n\n${'='.repeat(60)}`)
    console.log(`TAB: "${tabName}"`)
    console.log('='.repeat(60))

    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tabName}'!A1:AZ5`,
      })
      const rows = res.data.values || []
      if (rows.length === 0) { console.log('(vacía)'); continue }

      const headers = rows[0]
      console.log(`\nColumnas (${headers.length}):`)
      headers.forEach((h, i) => {
        const letter = i < 26 ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(65 + i - 26)
        console.log(`  ${letter} (${i+1}): ${h}`)
      })

      if (rows.length > 1) {
        console.log(`\nEjemplos de datos (fila 2):`)
        rows[1].forEach((v, i) => {
          if (v) {
            const letter = i < 26 ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(65 + i - 26)
            console.log(`  ${letter}: ${v}`)
          }
        })
      }
    } catch (e) {
      console.log(`Error leyendo tab: ${e.message}`)
    }
  }
}

main().catch(console.error)
