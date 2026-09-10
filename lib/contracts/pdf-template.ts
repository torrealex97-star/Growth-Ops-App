import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { CompanyProfile } from './company'

// PDF de PREVISUALIZACIÓN de una plantilla de contrato (sin datos de firmante), para
// que el closer pueda descargarlo y enseñárselo al cliente antes de la venta.
function sanitize(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x00-\xFF€]/g, '')
}

const A4 = { w: 595.28, h: 841.89 }
const MARGIN = 50
const BODY_SIZE = 10.5
const LINE = 15

export async function buildTemplatePreviewPdf(input: {
  title: string
  bodyText: string
  company: CompanyProfile
  welcome?: string | null
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  let page: PDFPage = doc.addPage([A4.w, A4.h])
  let y = A4.h - MARGIN
  const maxW = A4.w - MARGIN * 2
  const newPage = () => { page = doc.addPage([A4.w, A4.h]); y = A4.h - MARGIN }
  const ensure = (needed: number) => { if (y - needed < MARGIN + 30) newPage() }

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
  // Cabecera
  page.drawText(sanitize(company.name), { x: MARGIN, y, size: 16, font: bold, color: rgb(0.05, 0.05, 0.08) })
  y -= 12
  const meta = [company.cif ? `CIF ${company.cif}` : null, [company.address, company.postal_code, company.city].filter(Boolean).join(', ') || null].filter(Boolean).join('  ·  ')
  if (meta) { page.drawText(sanitize(meta), { x: MARGIN, y, size: 7.5, font, color: rgb(0.5, 0.5, 0.55) }); y -= 10 }
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 1, color: rgb(0.85, 0.85, 0.88) })
  y -= 24

  // Título
  page.drawText(sanitize(input.title || 'Contrato'), { x: MARGIN, y, size: 15, font: bold, color: rgb(0.05, 0.05, 0.08) })
  y -= LINE + 6
  // Nota de que es una previsualización
  draw('DOCUMENTO DE MUESTRA — las condiciones y datos del alumno se completan al generar el contrato real.', { size: 8, color: [0.55, 0.35, 0.05], gap: 10 })

  if (input.welcome) { draw(input.welcome, { color: [0.25, 0.25, 0.3], gap: 10 }) }

  // Cuerpo de la plantilla
  draw(input.bodyText || '(Plantilla sin contenido)', { gap: 6 })

  return doc.save()
}
