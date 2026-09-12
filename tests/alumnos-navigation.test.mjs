import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('Alumnos agrupa las cuatro capacidades en deep-links reales', () => {
  for (const tab of ['journey', 'soporte', 'cancelaciones', 'contratos']) {
    assert.equal(existsSync(join(root, `app/[tenant]/alumnos/${tab}/page.tsx`)), true)
  }

  const nav = readFileSync(join(root, 'lib/nav.ts'), 'utf8')
  assert.match(nav, /label: 'Alumnos'.+href: '\/alumnos'/s)
  assert.match(nav, /label: 'Soporte'.+href: '\/alumnos\/soporte'/s)
  assert.match(nav, /label: 'Cancelaciones'.+href: '\/alumnos\/cancelaciones'/s)
  assert.match(nav, /label: 'Contratos'.+href: '\/alumnos\/contratos'/s)
})

test('las rutas antiguas de Alumnos usan redirección 301', () => {
  const config = readFileSync(join(root, 'next.config.js'), 'utf8')
  const expected = [
    ["/:tenant/students", "/:tenant/alumnos/journey"],
    ["/:tenant/csm-events", "/:tenant/alumnos/soporte"],
    ["/:tenant/drops", "/:tenant/alumnos/cancelaciones"],
    ["/:tenant/contratos", "/:tenant/alumnos/contratos"],
    ["/:tenant/contratos/equipo", "/:tenant/direccion/contratos-equipo"],
  ]
  for (const [source, destination] of expected) {
    assert.match(config, new RegExp(`source: '${source.replaceAll('/', '\\/')}'.+destination: '${destination.replaceAll('/', '\\/')}'.+statusCode: 301`))
  }
})

test('los roles restringidos solo reciben sus pestañas necesarias', () => {
  const permissions = readFileSync(join(root, 'lib/auth/permissions.ts'), 'utf8')
  assert.match(permissions, /csm:\s*\['\/alumnos', '\/recursos\/testimonios'\]/)
  assert.match(permissions, /gestoria:\s*\[[^\]]*'\/alumnos\/contratos'/)
})
