import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { filasVisibles, PAGINA_LISTA } from '../lib/hooks/useMostrarMas.ts'

test('filasVisibles crece por tramos y nunca pasa del total', () => {
  assert.equal(filasVisibles(1300, PAGINA_LISTA, 1), PAGINA_LISTA)
  assert.equal(filasVisibles(1300, PAGINA_LISTA, 3), PAGINA_LISTA * 3)
  assert.equal(filasVisibles(20, PAGINA_LISTA, 5), 20)
  assert.equal(filasVisibles(0, PAGINA_LISTA, 1), 0)
  assert.equal(filasVisibles(100, PAGINA_LISTA, 0), PAGINA_LISTA)
})

test('contactos y cola de Fathom pintan por tramos, no todas las filas', () => {
  const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  const c = leer('components/crm/ContactsAllView.tsx')
  assert.match(c, /visibles\.map\(\(l\)/)
  assert.doesNotMatch(c, /\bfiltered\.map\(\(l\)/)
  const f = leer('app/[tenant]/crm/fathom-revision/page.tsx')
  assert.match(f, /visibles\.map\(\(item\)/)
  assert.doesNotMatch(f, /data\.items\.map\(\(item\)/)
})
