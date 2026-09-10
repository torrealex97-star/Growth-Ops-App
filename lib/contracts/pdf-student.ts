import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { companySignatureLabel, type CompanyProfile } from './company'
import { studentConditionLines, type StudentContractTerms, type StudentSignerData } from './student'
import { idDocLabel } from './id-validation'

// Sustituye caracteres fuera de WinAnsi por equivalentes ASCII seguros para que
// pdf-lib/Helvetica nunca falle al codificar.
function sanitize(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x00-\xFF€]/g, '')
}

export type StudentPdfInput = {
  title: string
  bodyText: string
  terms: StudentContractTerms
  company: CompanyProfile
  signerName: string
  signerData: StudentSignerData | null
  signerEmail: string | null
  signedAtISO: string
  signerIp: string | null
  createdByName: string | null
  contractId: string
  hash: string
}

const A4 = { w: 595.28, h: 841.89 }
const MARGIN = 50
const BODY_SIZE = 10.5
const LINE = 15

export async function buildStudentContractPdf(input: StudentPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  let page: PDFPage = doc.addPage([A4.w, A4.h])
  let y = A4.h - MARGIN
  const maxW = A4.w - MARGIN * 2

  const newPage = () => { page = doc.addPage([A4.w, A4.h]); y = A4.h - MARGIN }
  const ensure = (needed: number) => { if (y - needed < MARGIN + 40) newPage() }

  const wrap = (text: string, f: PDFFont, size: number): string[] => {
    const out: string[] = []
    for (const rawLine of sanitize(text).split('\n')) {
      if (rawLine.trim() === '') { out.push(''); continue }
      const words = rawLine.split(/\s+/)
      let cur = ''
      for (const word of words) {
        const test = cur ? `${cur} ${word}` : word
        if (f.widthOfTextAtSize(test, size) > maxW && cur) { out.push(cur); cur = word }
        else cur = test
      }
      if (cur) out.push(cur)
    }
    return out
  }

  const draw = (text: string, opts: { font?: PDFFont; size?: number; color?: [number, number, number]; gap?: number } = {}) => {
    const f = opts.font ?? font
    const size = opts.size ?? BODY_SIZE
    const color = opts.color ?? [0.1, 0.1, 0.12]
    for (const line of wrap(text, f, size)) {
      ensure(LINE)
      if (line !== '') page.drawText(line, { x: MARGIN, y, size, font: f, color: rgb(color[0], color[1], color[2]) })
      y -= LINE
    }
    if (opts.gap) y -= opts.gap
  }

  const company = input.company

  // ---- Cabecera ----
  page.drawText(sanitize(company.name), { x: MARGIN, y, size: 16, font: bold, color: rgb(0.05, 0.05, 0.08) })
  y -= 12
  const companyMeta = [company.cif ? `CIF ${company.cif}` : null, [company.address, company.postal_code, company.city].filter(Boolean).join(', ') || null]
    .filter(Boolean).join('  ·  ')
  if (companyMeta) { page.drawText(sanitize(companyMeta), { x: MARGIN, y, size: 7.5, font, color: rgb(0.5, 0.5, 0.55) }); y -= 10 }
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 1, color: rgb(0.85, 0.85, 0.88) })
  y -= 24

  // ---- Título ----
  page.drawText(sanitize(input.title || 'Contrato de formación'), { x: MARGIN, y, size: 15, font: bold, color: rgb(0.05, 0.05, 0.08) })
  y -= LINE + 10

  // ---- Cuerpo ----
  draw(input.bodyText, { gap: 10 })

  // ---- Condiciones del programa ----
  ensure(LINE * 4)
  draw('CONDICIONES DEL PROGRAMA', { font: bold, size: 12, gap: 4 })
  for (const l of studentConditionLines(input.terms)) draw(`${l.label}: ${l.value}`)
  y -= 12

  // ---- Datos del alumno ----
  const sd = input.signerData
  ensure(LINE * 3)
  draw('DATOS DEL ALUMNO', { font: bold, size: 12, gap: 4 })
  draw(`Nombre: ${input.signerName}`)
  if (sd?.dni) draw(`${idDocLabel(sd.id_type)}: ${sd.dni}`)
  if (input.signerEmail) draw(`Email: ${input.signerEmail}`)
  if (sd?.phone) draw(`Teléfono: ${sd.phone}`)
  const dir = [sd?.address, sd?.city].filter(Boolean).join(', ')
  if (dir) draw(`Dirección: ${dir}`)
  y -= 10

  // ---- Firmas ----
  ensure(110)
  const colY = y
  const rightX = A4.w / 2 + 10
  const fecha = new Date(input.signedAtISO).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })

  const sigBlock = (x: number, heading: string, lines: string[]) => {
    let yy = colY
    page.drawText(sanitize(heading), { x, y: yy, size: 10, font: bold, color: rgb(0.05, 0.05, 0.08) })
    yy -= 22
    page.drawLine({ start: { x, y: yy }, end: { x: x + 220, y: yy }, thickness: 0.8, color: rgb(0.7, 0.7, 0.72) })
    yy -= 14
    for (const l of lines) { page.drawText(sanitize(l), { x, y: yy, size: 9, font, color: rgb(0.25, 0.25, 0.3) }); yy -= 13 }
  }

  sigBlock(MARGIN, 'LA ACADEMIA', [companySignatureLabel(company), company.representative ?? company.name, `Fecha: ${fecha}`])
  sigBlock(rightX, 'EL ALUMNO', [input.signerName, 'Firmado electronicamente', `Fecha: ${fecha}`])
  y = colY - 80

  // ---- Pie: evidencias ----
  ensure(60)
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 0.5, color: rgb(0.88, 0.88, 0.9) })
  y -= 12
  const foot = (t: string) => { page.drawText(sanitize(t), { x: MARGIN, y, size: 7.5, font, color: rgb(0.5, 0.5, 0.55) }); y -= 10 }
  foot('Documento firmado electronicamente conforme al Reglamento (UE) 910/2014 (eIDAS) - firma electronica simple.')
  foot(`ID contrato: ${input.contractId}  |  Hash SHA-256: ${input.hash}`)
  foot(`Firmante: ${input.signerName}  |  IP: ${input.signerIp ?? 'n/d'}  |  Sellado: ${fecha}`)
  if (input.createdByName) foot(`Venta gestionada por: ${input.createdByName}`)

  return doc.save()
}
