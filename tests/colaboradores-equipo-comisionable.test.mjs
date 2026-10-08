import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { enlaceDeRol } from '../lib/tracking/enlaces.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('los enlaces de setter y closer usan el código personal en utm_term', () => {
  assert.equal(
    enlaceDeRol('https://example.test/reserva', 'setter', 'SET-1'),
    'https://example.test/reserva?utm_term=SET-1'
  )
  assert.equal(
    enlaceDeRol('https://example.test/reserva?campaign=sales', 'closer', 'CLOSE-2'),
    'https://example.test/reserva?campaign=sales&utm_term=CLOSE-2'
  )
})

test('los enlaces de colaborador conservan UTM y referencia estructurada', () => {
  assert.equal(
    enlaceDeRol('https://example.test/landing', 'affiliate', 'REF-3'),
    'https://example.test/landing?utm_content=REF-3&ref=REF-3'
  )
})

test('el directorio comisionable se acota primero a miembros del tenant', () => {
  const route = read('app/api/[tenant]/evergreen/colaboradores/route.ts')
  const membership = route.indexOf(".from('tenant_members')")
  const users = route.indexOf(".from('users')", membership)
  assert.ok(membership >= 0 && users > membership, 'debe resolver tenant_members antes de leer users')
  assert.match(route, /\.eq\('tenant_id', t\.tenantId\)/)
  assert.match(route, /\.in\('id', userIds\)[\s\S]*?\.eq\('pays_commissions', true\)/)
})

test('el panel muestra a todo el equipo comisionable y reutiliza las plantillas existentes', () => {
  const page = read('app/[tenant]/marketing/afiliados/afiliados/page.tsx')
  assert.match(page, /Equipo que recibe comisiones/)
  assert.match(page, /personasComisionables/)
  assert.match(page, /enlaceDeRol/)
  assert.match(page, /plantilla\.applies_to\?\.includes\(role\)/)
  assert.match(page, /Asignar una campaña/)
})
