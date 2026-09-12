import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { countDuplicateKeys, countDuplicateValues, deriveSourceStatus } from '../lib/data-health.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('Configuración tiene rutas canónicas únicas y abre General por defecto', () => {
  const nav = read('components/settings/SettingsNav.tsx')
  const general = read('app/[tenant]/settings/page.tsx')
  assert.match(nav, /href: '\/settings'/)
  assert.match(nav, /href: '\/settings\/integraciones'/)
  assert.match(nav, /href: '\/settings\/data-health'/)
  assert.doesNotMatch(general, /searchParams|tab=data-health|DataHealthPanel/)
})

test('Integraciones usa tarjetas, panel accesible y estados no engañosos', () => {
  const page = read('app/[tenant]/settings/integraciones/page.tsx')
  assert.match(page, /<Sheet/)
  assert.match(page, /Cómo se conecta/)
  assert.match(page, /Configurada · verificar/)
  assert.match(page, /Necesita atención/)
  assert.match(page, /datos históricos importados/)
})

test('la asistencia vive en Notificaciones y el widget positivo ya no se sirve', () => {
  const header = read('components/os/Header.tsx')
  const dashboard = read('app/[tenant]/dashboard/page.tsx')
  assert.match(header, /pendiente[\s\S]*de asistencia/)
  assert.match(header, /markAttendance/)
  assert.doesNotMatch(dashboard, /PendingAttendanceAlert|PositiveNoteWidget/)
  assert.equal(existsSync(join(root, 'components/os/PositiveNoteWidget.tsx')), false)
  assert.equal(existsSync(join(root, 'app/api/[tenant]/evergreen/positive-notes/route.ts')), false)
})

test('deduplicación normaliza identidades y solo cuenta excedentes reales', () => {
  assert.equal(countDuplicateValues([' A@EXAMPLE.com ', 'a@example.com', null, 'b@example.com']), 1)
  assert.equal(countDuplicateValues(['+34 600-100-200', '+34600100200']), 1)
  assert.equal(countDuplicateKeys(['calendly:1', 'calendly:1', 'ghl:1', null]), 1)
})

test('una credencial no equivale a una integración operativa', () => {
  assert.equal(deriveSourceStatus(false, 0), 'not_configured')
  assert.equal(deriveSourceStatus(true, 0), 'needs_attention')
  assert.equal(deriveSourceStatus(true, 49), 'connected')
})
