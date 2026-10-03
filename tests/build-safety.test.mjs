import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const DOCUMENT_ROUTES = [
  'app/api/[tenant]/evergreen/documents/override/route.ts',
  'app/api/[tenant]/evergreen/documents/register/route.ts',
  'app/api/[tenant]/evergreen/documents/state/route.ts',
  'app/api/[tenant]/evergreen/documents/verify/route.ts',
]

test('la verificación documental usa el contacto canónico de la venta antes de subir y registrar', () => {
  const route = readFileSync(join(root, 'app/api/[tenant]/evergreen/documents/verify/route.ts'), 'utf8')
  assert.match(route, /\.eq\('tenant_id', t\.tenantId\)/)
  assert.match(route, /contactId !== sale\.contact_id/)
  assert.match(route, /documentos-verificacion\/\$\{saleId\}\/\$\{sale\.contact_id\}/)
  assert.match(route, /contact_id: sale\.contact_id/)
  assert.doesNotMatch(route, /documentos-verificacion\/\$\{saleId\}\/\$\{contactId\}/)
  assert.match(route, /byteLength\(fileBase64, 'base64'\)/)
  assert.match(route, /safeFileName/)
})

test('los endpoints de documentos no crean el cliente service-role al importar el módulo', () => {
  for (const route of DOCUMENT_ROUTES) {
    const source = readFileSync(join(root, route), 'utf8')

    assert.doesNotMatch(
      source,
      /^const supabase = createClient/m,
      `${route} vuelve a bloquear el build sin secretos de producción`
    )
    assert.match(source, /(?:const serviceClient = \(\) =>|function serviceClient\(\))/)
    assert.match(source, /const supabase = serviceClient\(\)/)
  }
})
