import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { importContractTemplateFile, MAX_CONTRACT_TEMPLATE_BYTES } from '../lib/contracts/import-template.ts'

test('importa TXT, normaliza saltos y propone el nombre', async () => {
  const file = new File(['Contrato\r\n\r\nCláusula 1'], 'contrato_alumno.txt', { type: 'text/plain' })
  const result = await importContractTemplateFile(file)
  assert.deepEqual(result, { body: 'Contrato\n\nCláusula 1', suggestedName: 'contrato alumno' })
})

test('admite Markdown por extensión aunque el navegador no envíe MIME', async () => {
  const file = new File(['# Contrato'], 'plantilla.md', { type: '' })
  assert.equal((await importContractTemplateFile(file)).body, '# Contrato')
})

test('rechaza archivos vacíos, formatos no admitidos y tamaños excesivos', async () => {
  await assert.rejects(() => importContractTemplateFile(new File([], 'vacio.txt')), /vacío/)
  await assert.rejects(() => importContractTemplateFile(new File(['x'], 'contrato.exe')), /Formato no admitido/)
  const huge = new File([new Uint8Array(MAX_CONTRACT_TEMPLATE_BYTES + 1)], 'enorme.txt', { type: 'text/plain' })
  await assert.rejects(() => importContractTemplateFile(huge), /4 MB/)
})

test('no confía solo en la extensión o el MIME de un supuesto PDF', async () => {
  const fakePdf = new File(['contenido ejecutable'], 'contrato.pdf', { type: 'application/pdf' })
  await assert.rejects(() => importContractTemplateFile(fakePdf), /PDF válido/)
})

test('extrae texto real de un PDF antes de abrir el editor', async () => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage()
  page.drawText('Contrato de prueba', { x: 40, y: 760, font, size: 14 })
  const file = new File([await pdf.save()], 'contrato-prueba.pdf', { type: 'application/pdf' })
  const result = await importContractTemplateFile(file)
  assert.match(result.body, /Contrato de prueba/)
})

test('el contrato importado no puede exceder el límite de caracteres', async () => {
  const file = new File(['a'.repeat(120_001)], 'largo.txt', { type: 'text/plain' })
  await assert.rejects(() => importContractTemplateFile(file), /120.000 caracteres/)
})

test('la ruta exige pertenencia y rol de dirección antes de leer el archivo', () => {
  const route = readFileSync(
    new URL('../app/api/[tenant]/evergreen/contracts/templates/import/route.ts', import.meta.url),
    'utf8'
  )
  const tenantCheck = route.indexOf('requireTenant(tenant)')
  const roleCheck = route.indexOf("['admin', 'director'].includes")
  const formRead = route.indexOf('req.formData()')
  assert.ok(tenantCheck >= 0 && roleCheck > tenantCheck && formRead > roleCheck)
})
