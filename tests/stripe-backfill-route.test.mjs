import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const ROUTE = 'app/api/[tenant]/evergreen/stripe-backfill/route.ts'

// Es un INFORME. No escribe nada, y esto no es opcional: sales.product_id y payment_plan_id son
// NOT NULL, y un pago de Stripe no dice a qué producto interno corresponde. Registrar ventas
// automáticamente exigiría elegir un producto, o sea inventar datos financieros.
test('el informe de backfill no escribe nada en ninguna tabla', () => {
  const route = read(ROUTE)
  // Ni POST, ni PATCH, ni PUT, ni DELETE: solo GET.
  for (const metodo of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    assert.doesNotMatch(route, new RegExp(`export async function ${metodo}`), `no debe existir ${metodo}`)
  }
  assert.match(route, /export async function GET/)
  // Y ninguna escritura de Supabase.
  for (const escritura of ['.insert(', '.upsert(', '.update(', '.delete(']) {
    assert.ok(!route.includes(escritura), `contiene una escritura: ${escritura}`)
  }
  assert.match(route, /solo_lectura: true/)
})

test('pagina de verdad sobre el rango, con tope y presupuesto de tiempo', () => {
  const route = read(ROUTE)
  // La conciliación que ya existía solo miraba los últimos 100 pagos sin rango: inútil para un
  // backfill histórico.
  assert.match(route, /created\[gte\]/)
  assert.match(route, /created\[lte\]/)
  assert.match(route, /starting_after/)
  assert.match(route, /has_more/)
  assert.match(route, /deadline/)
  assert.match(route, /quedan_por_revisar/)
})

test('el tenant sale de la URL y exige rol de gestión', () => {
  const route = read(ROUTE)
  assert.match(route, /await requireTenant\(tenant\)/)
  assert.match(route, /session\.role !== 'admin'/)
  assert.match(route, /eq\('tenant_id', session\.tenantId\)/)
  assert.doesNotMatch(route, /searchParams\.get\('tenant'\)/)
})

test('no crea contactos a partir de un email de facturación', () => {
  const route = read(ROUTE)
  const lib = read('lib/finance/stripeBackfill.ts')
  assert.ok(!route.includes("from('contacts')\n    .insert"), 'no debe crear contactos')
  // Y el clasificador tiene un veredicto explícito para ese caso, en vez de inventarse uno.
  assert.match(lib, /'sin_contacto'/)
})

test('la respuesta no manda miles de filas ya registradas', () => {
  const route = read(ROUTE)
  assert.match(route, /verdict !== 'ya_registrado'/)
  assert.match(route, /\.slice\(0, 500\)/)
})
