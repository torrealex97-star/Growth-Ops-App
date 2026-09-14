import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const aviso = read('../../components/os/StripePendientesAviso.tsx')

test('el vacío de Ventas y Alumnas se explica y enlaza a donde se resuelve', () => {
  // La cadena: Alumnas lee `sales`; `sales` no se llena sola desde Stripe porque product_id y
  // payment_plan_id son NOT NULL y un pago no dice a qué producto corresponde. El fallo NO era el
  // importador: era que la pantalla decía "No hay ventas" a secas, y eso se lee como "está roto".
  for (const rel of ['../../app/[tenant]/ventas/registro/page.tsx', '../../app/[tenant]/students/page.tsx']) {
    const page = read(rel)
    assert.match(page, /<StripePendientesAviso tenant=\{tenant\} contexto="/, `${rel} no explica su vacío`)
  }
  assert.match(aviso, /Buscar pagos sin registrar/)
  assert.match(aviso, /settings\/integraciones\?integracion=stripe/)
})

test('el aviso NO registra ventas ni adivina productos: solo cuenta y enlaza', () => {
  // Elegir producto y plan por el usuario sería inventar el importe comisionable y el plazo de
  // devolución (tercera regla de AGENTS.md).
  for (const escritura of ['.insert(', '.upsert(', '.update(', '.delete(']) {
    assert.ok(!aviso.includes(escritura), `el aviso no debe escribir nada: ${escritura}`)
  }
  assert.match(aviso, /head: true/)
  assert.match(aviso, /from\('stripe_customers'\)/)
  // Y no llama a Stripe desde la pantalla: eso es trabajo del informe, que sí pagina y tarda.
  assert.ok(!/api\.stripe\.com/.test(aviso))
})

test('si la consulta falla, no se inventa un 0 ni se muestra el aviso', () => {
  // Un hueco no es un cero, ni aquí: sin dato fiable el aviso no aparece en vez de afirmar "0".
  assert.match(aviso, /setPendientes\(error \? null : \(count \?\? 0\)\)/)
  assert.match(aviso, /if \(pendientes === null \|\| pendientes === 0\) return null/)
})

test('un pago de Stripe no se cuenta tres veces', () => {
  const clasificador = read('../../lib/finance/stripeBackfill.ts')
  // Se trabaja sobre PaymentIntent —un intent es UN flujo económico— y las referencias conocidas
  // incluyen intent id Y charge id, así que el mismo pago no entra como intent, cargo y factura.
  assert.match(clasificador, /StripeIntent/)
  assert.match(clasificador, /knownReferences: Set<string>/)
  assert.match(clasificador, /intent id y charge id/)
  // Y los estados que NO son ingreso están separados por veredicto, no colapsados.
  for (const v of ['ya_registrado', 'registrable', 'sin_contacto', 'no_es_venta', 'reembolsado']) {
    assert.ok(clasificador.includes(`'${v}'`), `falta el veredicto ${v}`)
  }
})

test('las tres lecturas de Stripe paginan de verdad', () => {
  // limit:'100' es el TAMAÑO de página, no un tope: quien pagina es stripeList con starting_after.
  for (const rel of [
    '../../app/[tenant]/evergreen/../evergreen/stripe-backfill/route.ts',
    '../../lib/finance/stripeCustomers.ts',
    '../../lib/finance/stripeReconciliation.ts',
  ].slice(1)) {
    assert.match(read(rel), /stripeList/, `${rel} no usa el cliente paginado`)
  }
  const cliente = read('../../lib/stripe/client.ts')
  assert.match(cliente, /starting_after/)
  assert.match(cliente, /has_more/)
  assert.match(cliente, /truncated/)
})
