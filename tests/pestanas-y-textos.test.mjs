import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Cuatro detalles que solo se vieron mirando la app en producción (auditoría 25-sep).
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

test('toda página con entrada de sidebar en CRM y Recursos tiene su pestaña', () => {
  // Entrabas desde el menú y ninguna pestaña quedaba marcada: la sección no sabía que estabas en ella.
  const crm = leer('app/[tenant]/crm/layout.tsx')
  assert.match(crm, /href: '\/crm\/fathom-revision'/)
  const recursos = leer('app/[tenant]/recursos/layout.tsx')
  assert.match(recursos, /href: '\/recursos\/grabaciones'/)
})

test('"1 eventos" no existe: el singular se respeta', () => {
  const src = leer('app/[tenant]/funnels/eventos/page.tsx')
  assert.match(src, /ev\.events === 1 \? 'evento' : 'eventos'/)
  assert.match(src, /data\.sample\.rows === 1 \? 'evento' : 'eventos'/)
})

test('Testimonios distingue "vacío" de "el filtro no encaja"', () => {
  // Culpar al filtro cuando no hay ninguno manda a probar filtros sobre algo que aún no existe.
  const src = leer('app/[tenant]/recursos/testimonios/page.tsx')
  assert.match(src, /items\.length === 0/)
  assert.match(src, /Todavía no hay ningún testimonio/)
})
