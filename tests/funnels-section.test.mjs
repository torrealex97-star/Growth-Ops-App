import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

// Este test existe por un fallo real: añadí Funnels al menú pero no a DEPARTMENT_PREFIXES, y el
// filtro de visibilidad (`inZones` exige que la ruta case con algún prefijo) la habría escondido
// para TODOS los roles, admin incluido. Una entrada de menú invisible no da ningún error: solo
// no aparece, y eso es muy fácil de no ver.
test('una ruta del menú siempre casa con algún prefijo de departamento', () => {
  const nav = read('lib/nav.ts')
  const permissions = read('lib/auth/permissions.ts')

  const prefixes = [...permissions.matchAll(/'(\/[a-z0-9\-/]+)'/g)].map((m) => m[1])
  const hrefs = [...nav.matchAll(/href: '(\/[a-z0-9\-/]+)/g)].map((m) => m[1])
  assert.ok(hrefs.length > 20, 'no se han extraído las rutas del menú')

  const huerfanas = hrefs.filter((href) => !prefixes.some((p) => href.startsWith(p) || p.startsWith(href)))
  assert.deepEqual(huerfanas, [], `estas rutas del menú no casan con ningún prefijo: ${huerfanas.join(', ')}`)
})

test('Funnels está en el menú, en los prefijos y en el catálogo de páginas', () => {
  assert.match(read('lib/nav.ts'), /label: 'Funnels', href: '\/funnels'/)
  const permissions = read('lib/auth/permissions.ts')
  assert.match(permissions, /'\/funnels'/)
  assert.match(permissions, /href: '\/funnels', label: 'Funnels'/)
})

// La capa canónica distingue cuatro estados. Si la pantalla los pintara igual, distinguirlos en el
// cálculo no serviría de nada: el usuario seguiría leyendo un hueco como un cero.
test('la pantalla pinta los cuatro estados de forma distinguible', () => {
  const page = read('app/[tenant]/funnels/page.tsx')
  for (const status of ['ok', 'sin_datos', 'error_fuente', 'no_configurada']) {
    assert.match(page, new RegExp(`${status}:`), `la pantalla no contempla el estado ${status}`)
  }
  const styles = page.slice(page.indexOf('STATUS_STYLES'), page.indexOf('const num ='))
  const dots = [...styles.matchAll(/dot: '([^']+)'/g)].map((m) => m[1])
  assert.equal(dots.length, 4, 'faltan estilos de estado')
  assert.equal(new Set(dots).size, 4, 'dos estados comparten el mismo color: serían indistinguibles')
  // Y tiene que explicar el caso peligroso: un hueco NO es un cero.
  assert.match(page, /NO son ceros/)
  assert.match(page, /no comparable/, 'no avisa de la mezcla personas/eventos')
})

test('el endpoint saca el tenant de la URL y valida el rango de fechas', () => {
  const route = read('app/api/[tenant]/evergreen/funnels/route.ts')
  assert.match(route, /params: Promise<\{ tenant: string \}>/)
  assert.match(route, /await requireTenant\(tenant\)/)
  assert.match(route, /session\.tenantId/)
  // El tenant nunca del body ni de la query string.
  assert.doesNotMatch(route, /req\.json\(\)/)
  assert.doesNotMatch(route, /searchParams\.get\('tenant'\)/)
  // Familia validada contra la lista: si no, un valor arbitrario llegaría al cálculo.
  assert.match(route, /FUNNEL_FAMILIES\.includes/)
  assert.match(route, /from > to/)
})
