import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { buscarIdAuth } from '../lib/e2e/usuario-auth.ts'

// El E2E de TODAS las PRs murió con 422 `email_exists` durante horas el 3-oct: un usuario de prueba
// creado a mano por SQL (columnas de token a NULL) hace que `auth.admin.listUsers()` falle para todos,
// y el script descartaba ese error y trataba el fallo como «el usuario no existe».

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function cliente({ listado, errorListado = null, fila = null }) {
  const llamadas = { publicUsers: 0 }
  return {
    llamadas,
    auth: { admin: { listUsers: async () => ({ data: listado, error: errorListado }) } },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            llamadas.publicUsers++
            return { data: fila }
          },
        }),
      }),
    }),
  }
}

test('si el listado lo contiene, se usa y no se toca public.users', async () => {
  const sb = cliente({ listado: { users: [{ id: 'u-1', email: 'admin@qa-e2e.test' }] } })
  assert.equal(await buscarIdAuth(sb, 'admin@qa-e2e.test', () => {}), 'u-1')
  assert.equal(sb.llamadas.publicUsers, 0)
})

test('listUsers roto por una fila con tokens a NULL: se resuelve por public.users', async () => {
  // El caso real: error de GoTrue, listado vacío, pero el usuario SÍ existe.
  const avisos = []
  const sb = cliente({
    listado: null,
    errorListado: { message: 'Database error finding users' },
    fila: { id: 'u-2' },
  })
  assert.equal(await buscarIdAuth(sb, 'admin@qa-e2e.test', (m) => avisos.push(m)), 'u-2')
  assert.equal(avisos.length, 1, 'el error de listado tiene que decirse, no tragarse')
  assert.match(avisos[0], /listUsers falló/)
})

test('un error de listado no se confunde con «no existe» cuando la otra vía lo encuentra', async () => {
  const sb = cliente({ listado: { users: [] }, errorListado: { message: 'x' }, fila: { id: 'u-3' } })
  assert.equal(await buscarIdAuth(sb, 'a@b.test', () => {}), 'u-3')
})

test('de verdad no existe en ninguna fuente: null, y entonces sí se crea', async () => {
  const sb = cliente({ listado: { users: [{ id: 'otro', email: 'otro@qa-e2e.test' }] } })
  assert.equal(await buscarIdAuth(sb, 'nuevo@qa-e2e.test', () => {}), null)
})

test('el script de fixtures usa la búsqueda segura en sus dos usuarios', () => {
  const src = readFileSync(join(root, 'scripts/e2e/setup-tenant.mjs'), 'utf8')
  assert.match(src, /buscarIdAuth\(sb, EMAIL\)/)
  assert.match(src, /buscarIdAuth\(sb, EMAIL_COLAB\)/)
  // El patrón que descartaba el error no puede volver.
  assert.doesNotMatch(src, /const \{ data: listed \} = await sb\.auth\.admin\.listUsers\(\)/)
})
