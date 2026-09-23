import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const route = readFileSync('app/api/[tenant]/evergreen/contracts/attach/route.ts', 'utf8')
const student = readFileSync('app/api/[tenant]/evergreen/contracts/student/route.ts', 'utf8')
const signer = readFileSync('lib/contracts/student.ts', 'utf8')
const studentPage = readFileSync('app/firmar-alumno/[token]/page.tsx', 'utf8')

test('el adjunto externo guarda PDF, marca firmado y activa colaboradores pendientes', () => {
  assert.match(route, /formData\(\)/)
  assert.match(route, /application\/pdf/)
  assert.match(route, /status: 'firmado'/)
  assert.match(route, /signed_pdf_url: path/)
  assert.match(route, /collaborator_profiles/)
  assert.match(route, /\['invited', 'pending_contract'\]/)
})

test('generar contrato de alumno no queda bloqueado por documents_verified', () => {
  assert.doesNotMatch(student, /Document verification required/)
  assert.doesNotMatch(student, /docsVerified/)
})

test('el DNI no bloquea la firma mientras su verificación está pospuesta', () => {
  assert.doesNotMatch(signer, /validateIdDocument/)
  assert.doesNotMatch(studentPage, /validateIdDocument/)
  assert.match(studentPage, /La verificación de identidad está pospuesta/)
})
