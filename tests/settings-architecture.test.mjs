import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { countDuplicateKeys, countDuplicateValues, deriveSourceStatus } from '../lib/data-health.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

// Configuración tiene UN solo nivel de navegación: la rejilla de tarjetas. La barra de pestañas
// (General / Integraciones / Data Health) que se superponía a la rejilla ya no existe.
test('Configuración es una sola rejilla, sin pestañas por encima', () => {
  const general = read('app/[tenant]/settings/page.tsx')
  assert.equal(existsSync(join(root, 'components/settings/SettingsNav.tsx')), false)
  assert.doesNotMatch(general, /SettingsNav/)
  assert.doesNotMatch(general, /searchParams|tab=data-health|DataHealthPanel/)
  // Integraciones, Data Health y Auditoría son tarjetas más de la rejilla.
  for (const href of ["'/settings/integraciones'", "'/settings/data-health'", "'/audit'"]) {
    assert.match(general, new RegExp(`href: ${href}`), `falta la tarjeta ${href}`)
  }
  // Data Health es la única visible sin permisos de gestión, como filtraba antes la barra.
  assert.match(general, /manageOnly: false/)
  assert.match(general, /canManage === true \|\| card\.manageOnly === false/)
})

// El contexto de negocio y los assets de marca no son una integración: no hay credencial ni
// conexión que probar. Viven en Datos de empresa, pero su persistencia sigue siendo la misma.
test('el bloque de negocio salió de Integraciones sin migrar datos', () => {
  const catalog = read('lib/integrations-catalog.ts')
  const integraciones = read('app/[tenant]/settings/integraciones/page.tsx')
  const empresa = read('app/[tenant]/settings/empresa/page.tsx')
  assert.match(catalog, /surface: 'empresa'/, 'el grupo negocio no está marcado como fuera de Integraciones')
  assert.match(catalog, /IG_BUSINESS_CONTEXT/, 'las claves deben seguir en el catálogo para poder guardarse')
  assert.match(catalog, /IG_BRAND_ASSETS/)
  assert.match(catalog, /INTEGRATION_ONLY_GROUPS/)
  assert.doesNotMatch(integraciones, /IG_BRAND_ASSETS|brandAssets|'negocio'/)
  assert.match(empresa, /BusinessContextCard/)
})

// Auditoría es la única trazabilidad de quién tocó un dato financiero: se mueve, no se borra.
test('Auditoría sigue existiendo, dentro de Configuración y no en primer nivel', () => {
  const nav = read('lib/nav.ts')
  assert.equal(existsSync(join(root, 'app/[tenant]/audit/page.tsx')), true, 'la pantalla de auditoría ha desaparecido')
  const sistema = nav.slice(nav.indexOf("dept: 'sistema'"))
  const config = sistema.slice(sistema.indexOf("label: 'Configuración'"))
  assert.match(config, /label: 'Auditoría'/, 'Auditoría no está entre los hijos de Configuración')
  // Y ya no cuelga del primer nivel, al lado de Actividad.
  const beforeConfig = sistema.slice(0, sistema.indexOf("label: 'Configuración'"))
  assert.doesNotMatch(beforeConfig, /label: 'Auditoría'/)
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
