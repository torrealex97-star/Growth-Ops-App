import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// ---------------------------------------------------------------------------------------------
// LA CASCADA DE DATOS. 32 pantallas repetían `auth.getUser()` y 24 volvían a pedir `users` + `roles`,
// justo lo que el layout acababa de traer para decidir si dejarlas entrar. Eran dos viajes de red EN
// SERIE por pantalla, antes de pedir el dato que la persona ha venido a ver.
// ---------------------------------------------------------------------------------------------

test('el layout publica la sesión que ya resolvió', () => {
  const codigo = sinComentarios(leer('app/[tenant]/layout.tsx'))
  assert.match(codigo, /const sesion = useMemo\(/)
  assert.match(codigo, /userId: user\.id, user, rol: user\.roles\?\.key \?\? null, isSuperAdmin/)
  // Los dos TenantProvider (ruta pública y panel) la pasan: si solo uno, useSesion() daría null a medias.
  assert.equal((codigo.match(/sesion=\{sesion\}/g) || []).length, 2)
})

// SIN useMemo ESTO ES UN BUG: las pantallas ponen `sesion` en las dependencias de su efecto de carga, y
// un objeto nuevo en cada render del layout sería una referencia nueva → recarga en bucle.
test('la sesión está memorizada, o las pantallas recargarían en bucle', () => {
  const codigo = sinComentarios(leer('app/[tenant]/layout.tsx'))
  assert.match(codigo, /useMemo\(\s*\(\) => \(user \?[\s\S]{0,200}\[user, isSuperAdmin\]\s*\)/)
  assert.match(leer('app/[tenant]/layout.tsx'), /import \{ useState, useEffect, useMemo \} from 'react'/)
})

test('useSesion existe y no miente en las rutas públicas', () => {
  const src = leer('lib/tenant-context.tsx')
  assert.match(src, /export function useSesion\(\): SesionTenant \| null/)
  // Devuelve null donde no hay sesión (login, recover) en vez de lanzar: esas páginas se renderizan
  // a propósito sin sesión.
  assert.match(src, /return ctx\.sesion/)
  assert.match(src, /throw new Error\('useSesion\(\) called outside <TenantProvider>/)
})

test('el dashboard ya no repite auth.getUser() ni relee users dos veces', () => {
  const codigo = sinComentarios(leer('app/[tenant]/dashboard/page.tsx'))
  assert.doesNotMatch(codigo, /auth\.getUser\(\)/)
  // Eran DOS consultas a `users` para la misma fila, separadas por si las columnas del fijo no existían.
  assert.equal((codigo.match(/\.from\('users'\)\s*\n?\s*\.select\('full_name/g) || []).length, 0)
  assert.match(codigo, /const sesion = useSesion\(\)/)
  assert.match(codigo, /if \(!sesion \|\| !mounted\) return/)
  // Y sigue leyendo las columnas del fijo, que vienen del select('*') del layout.
  assert.match(codigo, /fijo_unlock_type/)
  assert.match(codigo, /base_salary/)
})

test('agendas ya no encadena getUser + users antes de pedir las agendas', () => {
  const codigo = sinComentarios(leer('app/[tenant]/crm/agendas/page.tsx'))
  assert.doesNotMatch(codigo, /auth\.getUser\(\)/)
  // El Promise.all de UN solo elemento no paralelizaba nada; ya no está.
  assert.doesNotMatch(codigo, /Promise\.all\(\[supabase\.auth\.getUser\(\)\]\)/)
  assert.match(codigo, /const sesion = useSesion\(\)/)
  // El filtro por rol sigue aplicándose: quitarlo habría convertido una mejora de rendimiento en una
  // fuga de agendas de otros closers.
  assert.match(codigo, /if \(userId && role && !isLeadership\(role as AppRole\) && scope !== 'team'\)/)
  assert.match(codigo, /appointmentsQuery\.eq\('closer_id', userId\)/)
  assert.match(codigo, /appointmentsQuery\.eq\('setter_id', userId\)/)
})

// El scoping por data_scope es una regla de acceso, no una preferencia: si se perdiera al refactorizar,
// un closer vería las agendas de todos.
test('el scoping propio del dashboard se mantiene', () => {
  const codigo = sinComentarios(leer('app/[tenant]/dashboard/page.tsx'))
  assert.match(codigo, /if \(!isLeadership\(rk\) && userData\.data_scope === 'own'\)/)
  assert.match(codigo, /setSelfScoped\(true\)/)
  assert.match(codigo, /setMember\(sesion\.userId\)/)
})
