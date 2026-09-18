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
import nextConfig from '../next.config.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const NEW_PAGE_FILES = [
  'app/[tenant]/marketing/adquisicion/campanas/page.tsx',
  'app/[tenant]/marketing/adquisicion/atribucion/page.tsx',
  'app/[tenant]/marketing/adquisicion/vsl/page.tsx',
  'app/[tenant]/instagram/page.tsx',
  'app/[tenant]/instagram/reels/page.tsx',
  'app/[tenant]/instagram/carruseles/page.tsx',
  'app/[tenant]/instagram/competencia/page.tsx',
  'app/[tenant]/marketing/contenido/page.tsx',
  'app/[tenant]/setting-ai/page.tsx',
  'app/[tenant]/settings/page.tsx',
  'app/[tenant]/settings/data-health/page.tsx',
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
    '/content': '/marketing/contenido',
    '/instagram/contenido': '/marketing/contenido',
    '/carruseles': '/instagram/carruseles',
    '/data-health': '/settings/data-health',
  }

  assert.deepEqual(LEGACY_MARKETING_ROUTES, expected)
  for (const [source, destination] of Object.entries(expected)) {
    assert.equal(marketingDestinationFor(source), destination)
  }
})

test('las rutas históricas responden con 301 real, no con el 308 de permanent', async () => {
  const redirects = await nextConfig.redirects()

  assert.ok(redirects.length > 0)
  for (const redirect of redirects) {
    assert.equal(redirect.statusCode, 301, `${redirect.source} no devuelve 301`)
    assert.equal('permanent' in redirect, false, `${redirect.source} conserva permanent y Next.js lo convierte en 308`)
  }
})

test('los detalles de carruseles conservan el id al redirigir', () => {
  assert.equal(marketingDestinationFor('/carruseles/proyecto-123'), '/instagram/carruseles/proyecto-123')
  assert.equal(marketingDestinationFor('/instagram/competencia'), null)
})

// El hub analítico se llamaba 'Adquisición', que no decía qué había dentro. Ahora es 'Métricas y
// KPIs': entrar en Marketing debe responder de dónde vienen los resultados. La vista OPERATIVA de
// Campañas no se renombró ni se movió de sitio — sigue siendo una entrada propia, y este test lo
// comprueba para que el renombrado no se lleve la operativa por delante.
test('Marketing contiene el hub de métricas, Instagram, Contenido, Colaboradores y Setting AI como hubs de primer nivel', () => {
  const nav = readFileSync(join(root, 'lib/nav.ts'), 'utf8')
  const marketingStart = nav.indexOf("dept: 'marketing'")
  const marketingEnd = nav.indexOf("dept: 'producto'", marketingStart)
  const marketingSection = nav.slice(marketingStart, marketingEnd)

  assert.match(marketingSection, /label: 'Métricas y KPIs'/)
  assert.doesNotMatch(marketingSection, /label: 'Adquisición'/)
  assert.match(marketingSection, /label: 'Campañas',\n\s+href: '\/marketing\/adquisicion\/campanas'/)
  assert.match(marketingSection, /label: 'Instagram'/)
  assert.match(marketingSection, /label: 'Contenido'/)
  assert.match(marketingSection, /label: 'Colaboradores'/)
  assert.match(marketingSection, /label: 'Setting AI'/)
  assert.doesNotMatch(marketingSection, /label: 'Data Health'/)
})

test('Setting AI ya no vive bajo Sistema', () => {
  const nav = readFileSync(join(root, 'lib/nav.ts'), 'utf8')
  const sistemaStart = nav.indexOf("dept: 'sistema'")
  const sistemaSection = nav.slice(sistemaStart)
  assert.doesNotMatch(sistemaSection, /label: 'Setting AI'/)
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
    ['Contenido', '/marketing/contenido'],
    ['Setting AI', '/setting-ai'],
    ['Data Health', '/settings/data-health'],
  ]

  for (const [label, href] of entries) {
    // [^}]* en vez de .+ para tolerar que Prettier envuelva el objeto en varias líneas sin dejar
    // que el match salte por encima del cierre `}` hasta un href de una entrada distinta.
    assert.match(nav, new RegExp(`label: '${label}'[^}]*href: '${href.replace(/[/?]/g, '\\$&')}'`))
  }
})

test('los roles limitados no reciben prefijos amplios de configuración o adquisición', () => {
  const permissions = readFileSync(join(root, 'lib/auth/permissions.ts'), 'utf8')
  assert.match(
    permissions,
    /adscripcion:\s*\['\/marketing\/adquisicion\/campanas', '\/marketing\/adquisicion\/atribucion', '\/settings\/data-health'\]/
  )
  assert.match(
    permissions,
    /editor:\s*\['\/instagram', '\/marketing\/contenido', '\/marketing\/adquisicion\/vsl', '\/recursos\/testimonios'\]/
  )
  assert.doesNotMatch(permissions, /adscripcion:\s*\['\/marketing',/)
  assert.doesNotMatch(permissions, /marketing:\s*\[[^\]]*'\/settings',/)
})

test('el permiso de Data Health no abre el resto de Configuración', () => {
  const zones = ['/settings/data-health']
  assert.equal(isAllowedLocation(zones, permissionLocationFor('/settings/data-health')), true)
  assert.equal(isAllowedLocation(zones, permissionLocationFor('/settings')), false)
  assert.equal(isAllowedLocation(zones, permissionLocationFor('/settings/users')), false)
  assert.equal(isAllowedLocation(zones, permissionLocationFor('/settings/integraciones')), false)
})

test('Adscripción y Editor quedan limitados a sus pestañas históricas', () => {
  const ads = ['/marketing/adquisicion/campanas', '/marketing/adquisicion/atribucion']
  assert.equal(isAllowedLocation(ads, '/marketing/adquisicion/campanas'), true)
  assert.equal(isAllowedLocation(ads, '/marketing/adquisicion/vsl'), false)

  const editor = ['/instagram', '/marketing/adquisicion/vsl']
  assert.equal(isAllowedLocation(editor, '/marketing/adquisicion/vsl'), true)
  assert.equal(isAllowedLocation(editor, '/marketing/adquisicion/campanas'), false)
})
