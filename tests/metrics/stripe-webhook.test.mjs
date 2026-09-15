import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import {
  mueveDinero,
  normalizarEventoStripe,
  TOLERANCIA_FIRMA_SEGUNDOS,
  verificarFirmaStripe,
} from '../../lib/stripe/webhook.ts'

const SECRETO = 'whsec_pruebaDeSecretoDeWebhook1234567890'

/** Firma un cuerpo como lo haría Stripe. Es criptografía real: esto NO es un fixture. */
const firmar = (cuerpo, secreto = SECRETO, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secreto).update(`${t}.${cuerpo}`, 'utf8').digest('hex')}`

// ---------------------------------------------------------------------------------------------
// LA FIRMA. Estos tests no usan payloads de mentira: generan la firma con el mismo algoritmo que
// Stripe y comprueban que la verificación la acepta, y que rechaza todo lo demás.
// ---------------------------------------------------------------------------------------------

test('una firma auténtica se acepta', () => {
  const cuerpo = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' })
  assert.deepEqual(verificarFirmaStripe(cuerpo, firmar(cuerpo), SECRETO), { valida: true })
})

// EL CUERPO TIENE QUE SER EL CRUDO, BYTE A BYTE. Si la ruta parseara el JSON y lo volviera a
// serializar, el orden de claves o los espacios cambiarían y la firma dejaría de cuadrar aunque el
// mensaje fuera legítimo. Este test demuestra por qué la ruta usa req.text() y no req.json().
test('reserializar el JSON invalida la firma: el cuerpo tiene que ser el crudo', () => {
  const crudo = '{"id":"evt_1",  "type":"payment_intent.succeeded"}'
  const cabecera = firmar(crudo)
  assert.equal(verificarFirmaStripe(crudo, cabecera, SECRETO).valida, true)
  // Mismo objeto, otra representación: la firma ya no vale.
  const reserializado = JSON.stringify(JSON.parse(crudo))
  assert.equal(verificarFirmaStripe(reserializado, cabecera, SECRETO).valida, false)
})

test('un cuerpo manipulado se rechaza', () => {
  const cuerpo = JSON.stringify({ id: 'evt_1', amount: 100 })
  const cabecera = firmar(cuerpo)
  const manipulado = JSON.stringify({ id: 'evt_1', amount: 999999 })
  const r = verificarFirmaStripe(manipulado, cabecera, SECRETO)
  assert.equal(r.valida, false)
  assert.equal(r.codigo, 'no_coincide')
})

test('otro secreto se rechaza', () => {
  const cuerpo = '{"id":"evt_1"}'
  const r = verificarFirmaStripe(cuerpo, firmar(cuerpo, 'whsec_otroSecretoDistinto0987654321'), SECRETO)
  assert.equal(r.valida, false)
  assert.equal(r.codigo, 'no_coincide')
})

// PROTECCIÓN DE REPETICIÓN. Sin comprobar el timestamp, una petición legítima capturada sirve para
// siempre: quien la tenga puede reenviarla indefinidamente y cada reenvío pasaría la firma.
test('una firma vieja se rechaza aunque el HMAC sea correcto', () => {
  const cuerpo = '{"id":"evt_1"}'
  const ahora = 1_800_000_000
  const cabecera = firmar(cuerpo, SECRETO, ahora - TOLERANCIA_FIRMA_SEGUNDOS - 1)
  const r = verificarFirmaStripe(cuerpo, cabecera, SECRETO, { ahoraSegundos: ahora })
  assert.equal(r.valida, false)
  assert.equal(r.codigo, 'caducada')
  // Y dentro de la ventana sí pasa.
  const reciente = firmar(cuerpo, SECRETO, ahora - 10)
  assert.equal(verificarFirmaStripe(cuerpo, reciente, SECRETO, { ahoraSegundos: ahora }).valida, true)
})

// Una marca muy en el FUTURO también es sospechosa, y delata un reloj desajustado en vez de aceptarse
// en silencio.
test('una firma con timestamp futuro también se rechaza', () => {
  const cuerpo = '{"id":"evt_1"}'
  const ahora = 1_800_000_000
  const cabecera = firmar(cuerpo, SECRETO, ahora + TOLERANCIA_FIRMA_SEGUNDOS + 60)
  assert.equal(verificarFirmaStripe(cuerpo, cabecera, SECRETO, { ahoraSegundos: ahora }).codigo, 'caducada')
})

// Stripe manda DOS v1 durante una rotación de secreto. Quedarse solo con la primera rompería la
// ingesta justo mientras se rota.
test('con varias firmas en la cabecera basta que una cuadre', () => {
  const cuerpo = '{"id":"evt_1"}'
  const t = Math.floor(Date.now() / 1000)
  const buena = crypto.createHmac('sha256', SECRETO).update(`${t}.${cuerpo}`, 'utf8').digest('hex')
  const cabecera = `t=${t},v1=${'0'.repeat(64)},v1=${buena}`
  assert.equal(verificarFirmaStripe(cuerpo, cabecera, SECRETO).valida, true)
})

// Sin secreto NO se acepta nada. Es el fallo que convertiría el endpoint en un buzón abierto donde
// cualquiera puede inyectar cobros.
test('sin secreto configurado no se acepta ningún evento', () => {
  const cuerpo = '{"id":"evt_1"}'
  const r = verificarFirmaStripe(cuerpo, firmar(cuerpo), undefined)
  assert.equal(r.valida, false)
  assert.equal(r.codigo, 'sin_secreto')
})

test('sin cabecera o con formato inesperado se rechaza sin lanzar', () => {
  assert.equal(verificarFirmaStripe('{}', null, SECRETO).codigo, 'sin_cabecera')
  assert.equal(verificarFirmaStripe('{}', 'basura', SECRETO).codigo, 'formato')
  assert.equal(verificarFirmaStripe('{}', 't=noesunnumero,v1=abc', SECRETO).codigo, 'formato')
  assert.equal(verificarFirmaStripe('{}', 'v1=abc', SECRETO).codigo, 'formato')
})

// ---------------------------------------------------------------------------------------------
// EL DOBLE CONTEO — el problema difícil de Stripe.
//
// Un pago de 499€ puede generar invoice.payment_succeeded + payment_intent.succeeded +
// charge.succeeded. Los tres son ciertos y hablan del MISMO dinero. Procesar los tres convierte
// 499€ en 1.497€ de cash collected, y el número resultante es creíble.
// ---------------------------------------------------------------------------------------------

const evento = (type, object, id = 'evt_x') => ({ id, type, created: 1_800_000_000, data: { object } })

test('el PaymentIntent es el evento que cuenta', () => {
  const n = normalizarEventoStripe(
    evento('payment_intent.succeeded', {
      id: 'pi_1',
      amount_received: 49900,
      currency: 'eur',
      customer: 'cus_1',
      receipt_email: 'a@b.com',
      latest_charge: 'ch_1',
    })
  )
  assert.equal(n.clase, 'cobro')
  assert.equal(n.importeEur, 499)
  assert.equal(n.referenciaPago, 'pi_1')
  assert.ok(mueveDinero(n))
  // El id del cargo entra como alternativa: el backfill histórico guardó algunas referencias así, y
  // sin esto el mismo cobro se registraría dos veces.
  assert.deepEqual(n.referenciasAlternativas, ['ch_1'])
})

test('el cargo con PaymentIntent detrás NO cuenta como dinero', () => {
  const n = normalizarEventoStripe(
    evento('charge.succeeded', { id: 'ch_1', payment_intent: 'pi_1', amount: 49900, currency: 'eur' })
  )
  assert.equal(n.clase, 'duplicado_economico')
  assert.equal(mueveDinero(n), false)
  assert.match(n.motivo, /entra por el evento del intent/i)
})

// Pero un cargo directo SIN intent sí cuenta: existen (cargos heredados) y no hay otro evento que los
// represente. Ignorarlos perdería dinero real.
test('un cargo directo sin PaymentIntent sí cuenta', () => {
  const n = normalizarEventoStripe(evento('charge.succeeded', { id: 'ch_2', amount: 19900, currency: 'eur' }))
  assert.equal(n.clase, 'cobro')
  assert.equal(n.importeEur, 199)
  assert.ok(mueveDinero(n))
})

test('la factura cobrada aporta contexto, no dinero', () => {
  const n = normalizarEventoStripe(
    evento('invoice.payment_succeeded', {
      id: 'in_1',
      payment_intent: 'pi_1',
      charge: 'ch_1',
      amount_paid: 49900,
      currency: 'eur',
    })
  )
  assert.equal(n.clase, 'duplicado_economico')
  assert.equal(mueveDinero(n), false)
  assert.deepEqual(n.referenciasAlternativas, ['pi_1', 'ch_1'])
})

// LA PRUEBA QUE IMPORTA: los tres eventos del MISMO pago suman 499€ una sola vez.
test('los tres eventos de un mismo pago suman el importe UNA vez', () => {
  const tres = [
    evento('invoice.payment_succeeded', { id: 'in_1', payment_intent: 'pi_1', amount_paid: 49900 }, 'evt_1'),
    evento('payment_intent.succeeded', { id: 'pi_1', amount_received: 49900, latest_charge: 'ch_1' }, 'evt_2'),
    evento('charge.succeeded', { id: 'ch_1', payment_intent: 'pi_1', amount: 49900 }, 'evt_3'),
  ].map(normalizarEventoStripe)

  const total = tres.filter(mueveDinero).reduce((a, n) => a + (n.importeEur ?? 0), 0)
  assert.equal(total, 499, 'el mismo pago se ha contado más de una vez')
  assert.equal(tres.filter(mueveDinero).length, 1)
})

test('un reembolso resta y apunta al pago original', () => {
  const n = normalizarEventoStripe(
    evento('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', amount: 49900, amount_refunded: 49900 })
  )
  assert.equal(n.clase, 'reembolso')
  assert.equal(n.importeEur, 499)
  assert.ok(n.referenciasAlternativas.includes('pi_1'))
})

// Un reembolso PARCIAL resta solo lo devuelto, no el cargo entero.
test('un reembolso parcial resta solo lo devuelto', () => {
  const n = normalizarEventoStripe(evento('charge.refunded', { id: 'ch_1', amount: 49900, amount_refunded: 10000 }))
  assert.equal(n.importeEur, 100)
})

// Un evento que no se entiende NO puede tumbar la ingesta de los que vienen detrás.
test('un tipo no contemplado se marca como ignorado, sin lanzar', () => {
  const n = normalizarEventoStripe(evento('payout.paid', { id: 'po_1' }))
  assert.equal(n.clase, 'ignorado')
  assert.equal(mueveDinero(n), false)
  assert.match(n.motivo, /no contemplado/i)
})

test('un payload incompleto devuelve error en vez de reventar', () => {
  assert.ok('error' in normalizarEventoStripe(null))
  assert.ok('error' in normalizarEventoStripe({ type: 'payment_intent.succeeded' }))
  assert.ok('error' in normalizarEventoStripe({ id: 'evt_1', type: 'payment_intent.succeeded' }))
})

test('el id del evento es la clave de idempotencia de la ingesta', () => {
  const n = normalizarEventoStripe(evento('payment_intent.succeeded', { id: 'pi_1', amount_received: 100 }, 'evt_abc'))
  assert.equal(n.eventId, 'evt_abc')
})

// Los importes llegan en céntimos. Un fallo aquí multiplica la facturación por cien.
test('los céntimos se convierten a euros sin arrastrar decimales', () => {
  const n = normalizarEventoStripe(evento('payment_intent.succeeded', { id: 'pi_1', amount_received: 16633 }))
  assert.equal(n.importeEur, 166.33)
})
