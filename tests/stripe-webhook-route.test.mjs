import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const RUTA = 'app/api/[tenant]/evergreen/webhooks/stripe/route.ts'
const src = read(RUTA)
const codigo = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// ---------------------------------------------------------------------------------------------
// EL CUERPO CRUDO ANTES DE TODO. La firma de Stripe se calcula sobre los bytes exactos: parsear el
// JSON y volver a serializarlo cambia el orden de claves y los espacios, y la firma deja de cuadrar
// aunque el mensaje sea legítimo.
// ---------------------------------------------------------------------------------------------

test('el cuerpo se lee crudo y antes de cualquier JSON.parse', () => {
  assert.match(codigo, /const crudo = await req\.text\(\)/)
  const leerCrudo = codigo.indexOf('await req.text()')
  const parsear = codigo.indexOf('JSON.parse(crudo)')
  assert.ok(leerCrudo > -1 && parsear > -1)
  assert.ok(leerCrudo < parsear, 'el crudo tiene que leerse antes de parsear')
  // Y nunca se usa req.json(), que ya habría perdido los bytes originales.
  assert.doesNotMatch(codigo, /req\.json\(\)/)
})

// La firma se comprueba ANTES de tocar el payload. Verificar después sería procesar lo que manda un
// remitente sin autenticar.
test('la firma se verifica antes de parsear o escribir el evento', () => {
  const verificar = codigo.indexOf('verificarFirmaStripe(')
  const parsear = codigo.indexOf('JSON.parse(crudo)')
  assert.ok(verificar > -1 && verificar < parsear, 'la firma va antes del parseo')
})

// EL SECRETO ES POR SUBCUENTA. Con un secreto compartido, el webhook de un cliente podría escribir en
// los datos de otro.
test('el secreto del webhook se lee de la configuración de la subcuenta', () => {
  assert.match(codigo, /getTenantConfigWithFallback\(tenantId, true\)/)
  assert.match(codigo, /cfg\.STRIPE_WEBHOOK_SECRET/)
  // No de una variable de entorno global.
  assert.doesNotMatch(codigo, /process\.env\.STRIPE_WEBHOOK_SECRET/)
})

// Un fallo de firma NO guarda el cuerpo: si alguien prueba a inyectar cobros hay que poder verlo, pero
// guardar el payload de un remitente no verificado es guardar lo que él quiera.
test('un fallo de firma se registra sin guardar el cuerpo ni filtrar el secreto', () => {
  const bloque = codigo.slice(codigo.indexOf('if (!firma.valida)'), codigo.indexOf('let evento'))
  assert.match(bloque, /_firma_rechazada: true/)
  assert.doesNotMatch(bloque, /payload: evento/)
  assert.doesNotMatch(bloque, /crudo(?!\.length)/, 'el cuerpo no puede acabar en el registro')
  assert.doesNotMatch(bloque, /secreto/, 'el secreto no puede aparecer en lo que se guarda')
})

// ---------------------------------------------------------------------------------------------
// LOS CÓDIGOS DE RESPUESTA IMPORTAN: Stripe reintenta ante 5xx. Devolver el código equivocado provoca
// reintentos infinitos de algo que nunca va a funcionar, o pierde eventos que sí se podrían recuperar.
// ---------------------------------------------------------------------------------------------

test('una firma inválida responde 401, que Stripe no reintenta', () => {
  assert.match(codigo, /Firma inválida[\s\S]{0,60}status: 401/)
})

// Firma válida y contenido que no se entiende: 200. El evento ES de Stripe y ya está guardado en
// crudo; un 4xx haría que lo reintentara una y otra vez sin que el reintento cambie nada.
test('un evento válido pero no interpretable responde 200 y queda guardado en crudo', () => {
  const bloque = codigo.slice(codigo.indexOf("if ('error' in n)"), codigo.indexOf('const { data: yaEsta }'))
  assert.match(bloque, /payload: evento as Record<string, unknown>/)
  assert.match(bloque, /processing_status: 'rejected'/)
  assert.match(bloque, /rejection_reason: n\.error/)
  assert.match(bloque, /registrado: true, procesado: false/)
  assert.doesNotMatch(bloque, /status: 4\d\d/)
})

// Un fallo nuestro SÍ debe provocar reintento: ahí el 500 es lo correcto.
test('un fallo de escritura responde 500 para que Stripe reintente', () => {
  assert.match(codigo, /No se pudo registrar el evento[\s\S]{0,60}status: 500/)
})

// ---------------------------------------------------------------------------------------------
// IDEMPOTENCIA. Stripe reintenta el mismo `evt_...` ante cualquier duda.
// ---------------------------------------------------------------------------------------------

test('el mismo evento dos veces no se registra dos veces', () => {
  assert.match(codigo, /\.eq\('source_event_id', n\.eventId\)/)
  assert.match(codigo, /duplicado: true/)
  // Y el 23505 cubre la carrera entre la comprobación y el insert: la base es la garantía final, no
  // esta comprobación previa.
  assert.match(codigo, /error\.code === '23505'/)
})

test('el id del evento se guarda como referencia de la fuente', () => {
  assert.match(codigo, /source_event_id: n\.eventId/)
  assert.match(codigo, /source: 'stripe'/)
})

// ---------------------------------------------------------------------------------------------
// LO QUE ESTA RUTA NO HACE, y es deliberado.
// ---------------------------------------------------------------------------------------------

// NO escribe ventas ni cobros: crear una venta exige producto y plan de pago, que un pago de Stripe no
// dice. Ese es justo el motivo por el que el registro pasa por una decisión humana. Si esta ruta los
// escribiera, estaría inventando los datos financieros que el resto del sistema se niega a inventar.
test('el webhook no crea ventas ni cobros por su cuenta', () => {
  assert.doesNotMatch(codigo, /from\('sales'\)\s*\.insert/)
  assert.doesNotMatch(codigo, /from\('collections'\)\s*\.insert/)
})

// La subcuenta tiene que existir y estar activa. Sin esto, un slug inventado escribiría con
// service_role en un tenant que no existe.
test('la subcuenta se resuelve y se comprueba que está activa', () => {
  assert.match(codigo, /\.eq\('slug', tenantSlug\)/)
  assert.match(codigo, /tenantRow\.status !== 'active'/)
})

// Se declara qué eventos cuentan como dinero: de los tres que Stripe emite por un mismo pago, solo uno
// suma, y la respuesta lo dice para poder auditarlo desde los logs de Stripe.
test('la respuesta dice si el evento mueve dinero y por qué', () => {
  assert.match(codigo, /mueve_dinero: mueveDinero\(n\)/)
  assert.match(codigo, /motivo: n\.motivo/)
})

// El secreto tiene que ser configurable desde la pantalla de integraciones, marcado como secreto para
// que no vuelva al navegador.
test('el signing secret está en el catálogo como campo secreto', () => {
  const catalogo = read('lib/integrations-catalog.ts')
  const bloque = catalogo.slice(catalogo.indexOf("key: 'STRIPE_WEBHOOK_SECRET'"))
  assert.match(bloque.slice(0, 400), /secret: true/)
  assert.match(bloque.slice(0, 400), /type: 'password'/)
  // Y NO es obligatorio: sin él se pierde el tiempo real, pero el backfill histórico sigue
  // funcionando con la Secret Key sola.
  const stripe = catalogo.slice(catalogo.indexOf("title: 'Stripe'"), catalogo.indexOf("key: 'STRIPE_WEBHOOK_SECRET'"))
  assert.match(stripe, /required: \['STRIPE_SECRET_KEY'\]/)
})
