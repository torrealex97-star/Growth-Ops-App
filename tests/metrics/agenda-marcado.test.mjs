import assert from 'node:assert/strict'
import test from 'node:test'
import { construirParche, esCualificada, esElegibleBamfam, RESULTADOS } from '../../lib/agenda/marcado.ts'

const parche = (m) => {
  const r = construirParche(m)
  assert.ok('patch' in r, `esperaba parche, salió error: ${r.error}`)
  return r.patch
}
const error = (m) => {
  const r = construirParche(m)
  assert.ok('error' in r, 'esperaba error y salió un parche')
  return r.error
}

// ---------------------------------------------------------------------------------------------
// DÓNDE SE ESCRIBE LA ASISTENCIA. En `status`, el mismo campo que escribiría Calendly o GHL. Si
// hubiera un `manual_show` aparte, una asistencia marcada a mano y otra confirmada por el proveedor
// contarían como dos, y reconciliarlas después sería adivinar.
// ---------------------------------------------------------------------------------------------

test('la asistencia se escribe en status, no en un campo manual paralelo', () => {
  assert.deepEqual(parche({ asistio: true }), { status: 'show' })
  assert.equal(parche({ asistio: false }).status, 'no_show')
})

// `undefined` es "sin tocar", que NO es "no asistió". Colapsarlos convertiría cada cita que nadie ha
// revisado en un no-show, y el Show Rate se hundiría solo por no haber marcado.
test('no marcar la asistencia no la pone en no-show', () => {
  const p = parche({ ofertaPresentada: true })
  assert.equal('status' in p, false)
})

// ---------------------------------------------------------------------------------------------
// LO QUE SE DEDUCE EN VEZ DE PREGUNTARSE. Tres clics para un dato contenido en el primero es
// exactamente lo que hace que nadie rellene nada.
// ---------------------------------------------------------------------------------------------

test('una venta implica asistencia y oferta, sin preguntarlas', () => {
  const r = construirParche({ resultado: 'venta' })
  assert.ok('patch' in r)
  assert.equal(r.patch.status, 'show')
  assert.equal(r.patch.offered, true)
  assert.equal(r.patch.result, 'venta')
  // Y se avisa de lo que se ha deducido, en vez de hacerlo en silencio.
  assert.ok(r.avisos.some((a) => /oferta/i.test(a)))
})

test('un no-show implica que no asistió y que no hubo oferta', () => {
  const p = parche({ resultado: 'no_show' })
  assert.equal(p.status, 'no_show')
  assert.equal(p.offered, false)
})

// "Queda en seguimiento" y "tiene hueco en el calendario" son cosas distintas, y el BAMFAM mide la
// segunda. Deducir la una de la otra inflaría la tasa con intenciones en vez de reuniones.
test('el resultado "seguimiento" no da por agendada la siguiente reunión', () => {
  const p = parche({ asistio: true, resultado: 'seguimiento' })
  assert.equal('needs_followup' in p, false)
  // Solo cuando se marca explícitamente.
  assert.equal(parche({ asistio: true, resultado: 'seguimiento', seguimientoAgendado: true }).needs_followup, true)
})

// Sin asistencia, "no hubo oferta" es un DATO, no un hueco: se escribe false explícito para que no se
// confunda con "no lo hemos registrado".
test('sin asistencia la oferta queda en false explícito, no en nulo', () => {
  assert.equal(parche({ asistio: false }).offered, false)
})

// ---------------------------------------------------------------------------------------------
// CONTRADICCIONES QUE LA UI NO DEBE PODER ENVIAR. Cada una de estas produciría una tasa por encima
// del 100% o un cierre sin llamada.
// ---------------------------------------------------------------------------------------------

test('no se puede presentar una oferta en una llamada a la que nadie asistió', () => {
  assert.match(error({ asistio: false, ofertaPresentada: true }), /no asistió/i)
})

test('no se puede vender sin oferta ni a quien no asistió', () => {
  assert.match(error({ resultado: 'venta', ofertaPresentada: false }), /sin oferta/i)
  assert.match(error({ resultado: 'venta', asistio: false }), /no asistida/i)
})

test('no se puede marcar no-show y asistencia a la vez', () => {
  assert.match(error({ asistio: true, resultado: 'no_show' }), /no.show/i)
})

// CUALIFICADA ES HABER RECIBIDO LA OFERTA: "si asiste y no se le lanza la oferta es que no estaba
// cualificada". Así que marcar las dos cosas juntas se contradice.
test('no se puede marcar "no cualificado" habiendo presentado la oferta', () => {
  assert.match(error({ asistio: true, ofertaPresentada: true, resultado: 'no_cualificado' }), /cualificada/i)
})

test('un resultado fuera del vocabulario se rechaza', () => {
  assert.match(error({ resultado: 'me_lo_invento' }), /no reconocido/i)
  // Y el vocabulario es el declarado por el negocio, sin añadidos.
  assert.deepEqual([...RESULTADOS], ['venta', 'seguimiento', 'no_interesado', 'no_cualificado', 'no_show', 'otro'])
})

test('un marcado vacío no escribe nada', () => {
  assert.match(error({}), /nada que marcar/i)
})

// ---------------------------------------------------------------------------------------------
// CUALIFICACIÓN — una sola definición, compartida por el Coste por Agenda Cualificada y el Pitch Rate.
// ---------------------------------------------------------------------------------------------

test('cualificada es haber recibido la oferta, y sin medir es null, no false', () => {
  assert.equal(esCualificada({ offered: true }), true)
  assert.equal(esCualificada({ offered: false }), false)
  // Una cita de antes de que se empezara a marcar NO es "no cualificada".
  assert.equal(esCualificada({ offered: null }), null)
  assert.equal(esCualificada({}), null)
})

// ---------------------------------------------------------------------------------------------
// BAMFAM — el denominador, declarado explícitamente.
// ---------------------------------------------------------------------------------------------

test('el denominador del BAMFAM son las asistidas que no acabaron en venta', () => {
  assert.equal(esElegibleBamfam({ status: 'show', result: 'seguimiento' }), true)
  assert.equal(esElegibleBamfam({ status: 'completed', result: 'no_interesado' }), true)
})

// Una llamada que no ocurrió no tiene nada que retomar: fuera del denominador, o la tasa se hunde con
// reuniones que nunca existieron.
test('las no celebradas quedan fuera del denominador del BAMFAM', () => {
  for (const status of ['no_show', 'cancelled', 'scheduled', null]) {
    assert.equal(esElegibleBamfam({ status, result: 'seguimiento' }), false, `status ${status}`)
  }
})

// Las que cerraron ya convirtieron: meterlas en el denominador castigaría precisamente los cierres.
test('las que acabaron en venta quedan fuera del denominador del BAMFAM', () => {
  assert.equal(esElegibleBamfam({ status: 'show', result: 'venta' }), false)
})

// ---------------------------------------------------------------------------------------------
// BUGS ENCONTRADOS AL REVISAR EL TRABAJO DEL MISMO DÍA.
// ---------------------------------------------------------------------------------------------

// "No cualificado" ES "no se le lanzó la oferta", por la definición del negocio. Antes esto no
// escribía `offered`, así que la llamada quedaba con el campo nulo —"sin medir"— cuando el closer
// acababa de declarar justo lo contrario, y el Coste por Agenda Cualificada la excluía del cómputo
// en vez de contarla como no cualificada.
test('marcar "no cualificado" registra que NO hubo oferta, no lo deja sin medir', () => {
  const p = parche({ asistio: true, resultado: 'no_cualificado' })
  assert.equal(p.offered, false)
  assert.notEqual(p.offered, undefined)
})

// Pero sigue siendo una contradicción marcarlo junto a una oferta presentada.
test('"no cualificado" con oferta presentada sigue siendo contradictorio', () => {
  assert.match(error({ asistio: true, ofertaPresentada: true, resultado: 'no_cualificado' }), /cualificada/i)
})
