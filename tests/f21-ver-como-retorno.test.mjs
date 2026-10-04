import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('salir de «Ver como» escribe la sesión con el adaptador SSR, no con una cookie HttpOnly a mano', () => {
  const s = leer('app/api/[tenant]/evergreen/admin/ver-como/salir/route.ts')
  assert.match(s, /createServerClient/)
  assert.match(s, /auth\.setSession/)
  assert.doesNotMatch(s, /httpOnly:\s*true/)
  assert.doesNotMatch(s, /base64-\$\{Buffer/)
})

test('el bloqueo por contrato también monta el banner de retorno', () => {
  const s = leer('app/[tenant]/layout.tsx')
  const bloque = s.slice(s.indexOf('if (contractGate) {'), s.indexOf('Te falta firmar el contrato'))
  assert.match(bloque, /<VerComoShim/)
})
