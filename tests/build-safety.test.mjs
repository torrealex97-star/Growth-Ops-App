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

test('los endpoints de documentos no crean el cliente service-role al importar el módulo', () => {
  for (const route of DOCUMENT_ROUTES) {
    const source = readFileSync(join(root, route), 'utf8')

    assert.doesNotMatch(
      source,
      /^const supabase = createClient/m,
      `${route} vuelve a bloquear el build sin secretos de producción`
    )
    assert.match(source, /const serviceClient = \(\) =>/)
    assert.match(source, /const supabase = serviceClient\(\)/)
  }
})
