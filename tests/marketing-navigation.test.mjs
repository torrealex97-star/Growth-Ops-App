import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  LEGACY_MARKETING_ROUTES,
  isAllowedLocation,
  marketingDestinationFor,
  permissionLocationFor,
} from '../lib/marketing-navigation.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const NEW_PAGE_FILES = [
  'app/[tenant]/marketing/adquisicion/campanas/page.tsx',
  'app/[tenant]/marketing/adquisicion/atribucion/page.tsx',
  'app/[tenant]/marketing/adquisicion/vsl/page.tsx',
  'app/[tenant]/instagram/page.tsx',
  'app/[tenant]/instagram/reels/page.tsx',
  'app/[tenant]/instagram/carruseles/page.tsx',
  'app/[tenant]/instagram/competencia/page.tsx',
  'app/[tenant]/instagram/contenido/page.tsx',
  'app/[tenant]/settings/page.tsx',
]

test('cada destino nuevo tiene una página real', () => {
  for (const page of NEW_PAGE_FILES) {
    assert.equal(existsSync(join(root, page)), true, `Falta ${page}`)
  }
})

test('todas las rutas históricas apuntan al deep-link esperado', () => {
  const expected = {
    '/campaigns': '/marketing/adquisicion/campanas',
    '/attribution': '/marketing/adquisicion/atribucion',
    '/vsl': '/marketing/adquisicion/vsl',
    '/content/reels': '/instagram/reels',
    '/content': '/instagram/contenido',
    '/carruseles': '/instagram/carruseles',
    '/data-health': '/settings?tab=data-health',
  }

  assert.deepEqual(LEGACY_MARKETING_ROUTES, expected)
  for (const [source, destination] of Object.entries(expected)) {
    assert.equal(marketingDestinationFor(source), destination)
  }
})

test('los detalles de carruseles conservan el id al redirigir', () => {
  assert.equal(
    marketingDestinationFor('/carruseles/proyecto-123'),
    '/instagram/carruseles/proyecto-123'
  )
  assert.equal(marketingDestinationFor('/instagram/competencia'), null)
})

test('Marketing solo contiene los hubs Adquisición e Instagram', () => {
  const nav = readFileSync(join(root, 'lib/nav.ts'), 'utf8')
  const marketingStart = nav.indexOf("dept: 'marketing'")
  const marketingEnd = nav.indexOf("dept: 'producto'", marketingStart)
  const marketingSection = nav.slice(marketingStart, marketingEnd)

  assert.match(marketingSection, /label: 'Adquisición'/)
  assert.match(marketingSection, /label: 'Instagram'/)
  assert.doesNotMatch(marketingSection, /label: 'Setting AI'/)
  assert.doesNotMatch(marketingSection, /label: 'Data Health'/)
})

test('el menú compartido con ⌘K contiene todas las páginas absorbidas', () => {
  const nav = readFileSync(join(root, 'lib/nav.ts'), 'utf8')
  const entries = [
    ['Campañas', '/marketing/adquisicion/campanas'],
    ['Atribución', '/marketing/adquisicion/atribucion'],
    ['VSL', '/marketing/adquisicion/vsl'],
    ['Reels del día', '/instagram/reels'],
    ['Carruseles y Flyers', '/instagram/carruseles'],
    ['Competencia', '/instagram/competencia'],
    ['Contenido', '/instagram/contenido'],
    ['Data Health', '/settings?tab=data-health'],
  ]

  for (const [label, href] of entries) {
    assert.match(nav, new RegExp(`label: '${label}'.+href: '${href.replace(/[/?]/g, '\\$&')}'`))
  }
})

test('los roles limitados no reciben prefijos amplios de configuración o adquisición', () => {
  const permissions = readFileSync(join(root, 'lib/auth/permissions.ts'), 'utf8')
  assert.match(permissions, /adscripcion:\s*\['\/marketing\/adquisicion\/campanas', '\/marketing\/adquisicion\/atribucion', '\/settings\?tab=data-health'\]/)
  assert.match(permissions, /editor:\s*\['\/instagram', '\/marketing\/adquisicion\/vsl', '\/recursos\/testimonios'\]/)
  assert.doesNotMatch(permissions, /adscripcion:\s*\['\/marketing',/)
  assert.doesNotMatch(permissions, /marketing:\s*\[[^\]]*'\/settings',/)
})

test('el permiso de Data Health no abre el resto de Configuración', () => {
  const zones = ['/settings?tab=data-health']
  assert.equal(isAllowedLocation(zones, permissionLocationFor('/settings', true)), true)
  assert.equal(isAllowedLocation(zones, permissionLocationFor('/settings', false)), false)
  assert.equal(isAllowedLocation(zones, permissionLocationFor('/settings/users', false)), false)
  assert.equal(isAllowedLocation(zones, permissionLocationFor('/settings/integraciones', false)), false)
})

test('Adscripción y Editor quedan limitados a sus pestañas históricas', () => {
  const ads = ['/marketing/adquisicion/campanas', '/marketing/adquisicion/atribucion']
  assert.equal(isAllowedLocation(ads, '/marketing/adquisicion/campanas'), true)
  assert.equal(isAllowedLocation(ads, '/marketing/adquisicion/vsl'), false)

  const editor = ['/instagram', '/marketing/adquisicion/vsl']
  assert.equal(isAllowedLocation(editor, '/marketing/adquisicion/vsl'), true)
  assert.equal(isAllowedLocation(editor, '/marketing/adquisicion/campanas'), false)
})
