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
  assert.match(route, /deadline/)
  assert.match(route, /quedan_por_revisar/)
  // La mecánica de paginación vive en el cliente compartido de Stripe: había cuatro bucles escritos
  // a mano y solo este paginaba. Los otros tres se quedaban con las 100 filas más recientes.
  assert.match(route, /stripeList</)
  const client = read('lib/stripe/client.ts')
  assert.match(client, /starting_after/)
  assert.match(client, /has_more/)
  assert.match(client, /truncated/)
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

// El informe sigue siendo de solo lectura: registrar vive en OTRA ruta, y ahí sí escribe, pero solo
// lo que una persona ha elegido. Estas son las guardas de esa escritura, que toca ventas y cobros —
// de donde salen la facturación y las comisiones.
test('registrar ventas desde Stripe escribe solo bajo decisión humana y sin duplicar', () => {
  const registrar = read('app/api/[tenant]/evergreen/stripe-backfill/registrar/route.ts')
  const code = registrar.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

  // Rol financiero, no cualquier miembro.
  assert.match(code, /role !== 'admin' && session\.role !== 'director'/)
  // Producto y plan obligatorios: sin ellos no hay venta que escribir.
  assert.match(code, /Falta elegir producto y plan de pago/)
  // Y tienen que ser de ESTA subcuenta: con service_role, un id de otra pasaría sin que RLS lo pare.
  assert.match(code, /Ese producto no es de esta subcuenta/)
  assert.match(code, /Ese plan de pago no es de esta subcuenta/)

  // El importe se relee de Stripe por id: no se escribe lo que diga el navegador. Se comprueba sobre
  // el fichero SIN limpiar comentarios: el limpiador corta desde el "//" de la URL hasta fin de
  // línea, así que sobre el texto limpio esta URL no existiría.
  assert.match(registrar, /payment_intents\/\$\{encodeURIComponent\(paymentId\)\}/)
  assert.match(code, /classifyForBackfill\(intent/, 'hay que reclasificar antes de escribir')

  // Idempotencia: la referencia se añade a las conocidas dentro del bucle, así que un id repetido en
  // la misma tanda no crea una segunda venta.
  assert.match(code, /knownReferences\.add\(paymentId\)/)

  // Si el cobro falla, la venta se deshace: una venta sin cobro es facturación sin dinero, y encima
  // volvería a salir como registrable y se duplicaría.
  assert.match(code, /from\('sales'\)\.delete\(\)/)
  assert.match(code, /se deshizo la venta/)

  // Cada venta creada queda auditada.
  assert.match(code, /entity_type: 'sale'/)
})
