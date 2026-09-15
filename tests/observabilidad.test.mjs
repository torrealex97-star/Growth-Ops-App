import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// ---------------------------------------------------------------------------------------------
// LO QUE FALTABA: Sentry estaba configurado y `tagRequestScope` —el helper que añade tenant, ruta y
// request_id sin PII— no lo llamaba NADIE. Los errores llegaban sin saber de qué subcuenta ni de qué
// ruta venían, y sin forma de atar el error que ve la persona con el que hay que arreglar.
// ---------------------------------------------------------------------------------------------

test('el id de petición se genera en el middleware, que corre en todas las rutas', () => {
  const codigo = sinComentarios(leer('lib/supabase/middleware.ts'))
  assert.match(codigo, /nuevoRequestId\(\)/)
  assert.match(codigo, /request\.headers\.set\(CABECERA_REQUEST_ID, requestId\)/)
  assert.match(codigo, /request\.headers\.set\(CABECERA_RUTA, normalizarRuta\(request\.nextUrl\.pathname\)\)/)
  // Y vuelve en la RESPUESTA: sin eso, quien ve el error en el navegador no tiene el id que citar.
  assert.match(codigo, /response\.headers\.set\(CABECERA_REQUEST_ID, requestId\)/)
})

// Un id que llega de fuera es texto sin autenticar: se respeta para no romper una traza, pero acotado.
test('un id entrante se valida antes de reutilizarlo', () => {
  const codigo = sinComentarios(leer('lib/supabase/middleware.ts'))
  assert.match(codigo, /\/\^\[A-Za-z0-9-\]\{8,64\}\$\/\.test\(entrante\)/)
})

test('requireTenant etiqueta Sentry, y es el único sitio que hay que tocar', () => {
  const codigo = sinComentarios(leer('lib/auth/requireTenant.ts'))
  assert.match(codigo, /tagRequestScope\(\{/)
  assert.match(codigo, /tenantId: tenant\.id/)
  assert.match(codigo, /route: cabeceras\.get\(CABECERA_RUTA\)/)
  // El id se devuelve para que la ruta pueda enseñarlo en su respuesta de error.
  assert.match(codigo, /requestId,/)
})

// NADA DE PII EN LAS ETIQUETAS. tenant_id es un UUID interno y no identifica a una persona; lo demás
// (tokens, cookies, cuerpos, emails, transcripciones) no puede salir nunca a un tercero.
test('no se etiqueta nada que identifique a una persona', () => {
  const sentry = leer('lib/observability/sentry.ts')
  const etiquetas = sentry.slice(sentry.indexOf('setTags({'), sentry.indexOf('})', sentry.indexOf('setTags({')))
  for (const prohibido of ['email', 'phone', 'token', 'cookie', 'authorization', 'body', 'payload', 'full_name']) {
    assert.doesNotMatch(etiquetas, new RegExp(prohibido, 'i'), `no puede etiquetarse ${prohibido}`)
  }
  assert.match(etiquetas, /tenant_id/)
  assert.match(etiquetas, /route/)
  assert.match(etiquetas, /request_id/)
})

test('las rutas de navegador no exponen el slug de la subcuenta', async () => {
  const { normalizarRutaTenant } = await import(join(root, 'lib/observability/peticion.ts'))
  assert.equal(normalizarRutaTenant('/women-digital-closer/ventas/registro/123'), '/:tenant/ventas/registro/:n')
  assert.equal(normalizarRutaTenant('/evergreen/dashboard'), '/:tenant/dashboard')
})

test('LCP, INP y CLS se miden en el navegador sin crear otro proveedor', () => {
  const codigo = sinComentarios(leer('components/observability/WebVitalsReporter.tsx'))
  assert.match(codigo, /useReportWebVitals/)
  assert.match(codigo, /new Set\(\['CLS', 'INP', 'LCP'\]\)/)
  assert.match(codigo, /Sentry\.metrics\.distribution/)
  assert.match(codigo, /normalizarRutaTenant\(pathname\)/)
  assert.doesNotMatch(codigo, /email|phone|userId|full_name/)
  assert.match(sinComentarios(leer('app/layout.tsx')), /<WebVitalsReporter \/>/)
})

test('los límites de error registran la excepción sin exponer el mensaje técnico', () => {
  for (const fichero of ['app/[tenant]/error.tsx', 'app/global-error.tsx']) {
    const codigo = sinComentarios(leer(fichero))
    assert.match(codigo, /Sentry\.captureException\(error/)
    assert.doesNotMatch(codigo, /\{error\.message/)
    assert.match(codigo, /role="alert"/)
  }
  // El fallback debe seguir siendo barato aunque el error original fuera de GPU/renderizado.
  assert.doesNotMatch(leer('app/[tenant]/error.tsx'), /ShaderBackground|mesh-drift-shader/)
})
