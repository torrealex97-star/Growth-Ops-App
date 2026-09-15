import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('la raíz del tenant redirige en servidor usando params, sin invocar hooks cliente', () => {
  const page = readFileSync(new URL('../app/[tenant]/page.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(page, /useTenant/, 'un Server Component no puede invocar el hook cliente useTenant')
  assert.match(page, /params:\s*Promise<\{\s*tenant:\s*string\s*\}>/)
  assert.match(page, /const\s+\{\s*tenant\s*\}\s*=\s*await\s+params/)
  assert.match(page, /redirect\(`\/\$\{tenant\}\/dashboard`\)/)
})
