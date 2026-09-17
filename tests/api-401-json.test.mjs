import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// ---------------------------------------------------------------------------------------------
// BUG: el middleware redirigía TODAS las peticiones sin sesión al HTML de /<tenant>/login,
// incluidas las de /api/*. Un fetch sigue los redirects: recibía el HTML del login donde
// esperaba JSON, y el cliente no distinguía "sin sesión" de "respuesta corrupta".
// Las pantallas mostraban "El servidor ha fallado" en lugar de un 401 interpretable.
// ---------------------------------------------------------------------------------------------

test('el middleware NO redirige al login las rutas de API: responde 401 JSON', () => {
  const codigo = sinComentarios(leer('lib/supabase/middleware.ts'))
  // Debe existir una rama que detecta /api/ antes de decidir el destino sin sesión...
  assert.match(codigo, /pathname\.startsWith\('\/api\/'\)/)
  // ...y esa rama responde JSON con estado 401 (no NextResponse.redirect).
  assert.match(codigo, /status: 401/)
  // El redirect al login solo puede quedar para páginas: no debe existir ningún
  // NextResponse.redirect sin la guarda de API delante en la rama sin usuario.
  const ramaSinUsuario = codigo.split('if (!user)')[1] || ''
  const idxApi = ramaSinUsuario.indexOf("startsWith('/api/')")
  const idxRedirect = ramaSinUsuario.indexOf('NextResponse.redirect')
  assert.ok(idxApi !== -1, 'falta la guarda de API en la rama sin usuario')
  assert.ok(idxRedirect !== -1, 'falta el redirect al login para páginas')
  assert.ok(idxApi < idxRedirect, 'el redirect al login debe quedar DESPUÉS de la guarda de API')
})

test('la respuesta 401 del middleware conserva el request_id para trazabilidad', () => {
  const codigo = sinComentarios(leer('lib/supabase/middleware.ts'))
  const ramaSinUsuario = codigo.split('if (!user)')[1] || ''
  assert.match(ramaSinUsuario, /sinSesion\.headers\.set\(CABECERA_REQUEST_ID, requestId\)/)
})
