import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compararCualificaciones,
  cualificacionVentas,
  resumirConcordancia,
} from '../../lib/metrics/concordancia-cualificacion.ts'

// ---------------------------------------------------------------------------------------------
// DOS CUALIFICACIONES, DOS DUEÑOS. "Una la identifica marketing y la otra ventas. Casi siempre deben
// ser lo mismo, a no ser que la persona mienta en el form o el closer detecte algo."
//
// Ese "casi siempre" convierte la DISCREPANCIA en información: si marketing trae 100 agendas
// cualificadas y ventas solo confirma 40, el cuello de botella no son los closers.
// ---------------------------------------------------------------------------------------------

test('el juicio de ventas sale de lo que ya marca el closer, sin campo nuevo', () => {
  // Descartada explícitamente.
  assert.equal(cualificacionVentas({ status: 'show', result: 'no_cualificado' }), false)
  // Le presentó la oferta, que es confirmar en la práctica que merecía el pitch.
  assert.equal(cualificacionVentas({ status: 'show', offered: true }), true)
})

// No lanzar la oferta puede ser falta de tiempo o un reagendado, no un descarte. Convertirlo en `false`
// castigaría a ventas por llamadas que se quedaron a medias.
test('no haber lanzado la oferta no equivale a descartar al prospecto', () => {
  assert.equal(cualificacionVentas({ status: 'show', offered: false, result: 'seguimiento' }), null)
  assert.equal(cualificacionVentas({ status: 'show' }), null)
})

// ---------------------------------------------------------------------------------------------
// LOS CASOS QUE CONCUERDAN — lo normal y lo deseable.
// ---------------------------------------------------------------------------------------------

test('cuando las dos coinciden no hay discrepancia', () => {
  const si = compararCualificaciones(true, true, true)
  assert.equal(si.concordancia, 'concuerdan_si')
  assert.equal(si.esDiscrepancia, false)

  const no = compararCualificaciones(false, false, true)
  assert.equal(no.concordancia, 'concuerdan_no')
  assert.equal(no.esDiscrepancia, false)
})

// ---------------------------------------------------------------------------------------------
// LAS DOS DISCREPANCIAS, cada una con una lectura de negocio distinta.
// ---------------------------------------------------------------------------------------------

// Marketing sí, ventas no: o la respuesta del formulario no era cierta, o el closer vio algo que un
// formulario no puede ver. Si se repite, el filtro no filtra.
test('marketing la cualifica y ventas la descarta: el filtro no está filtrando', () => {
  const r = compararCualificaciones(true, false, true)
  assert.equal(r.concordancia, 'solo_marketing')
  assert.equal(r.esDiscrepancia, true)
  assert.match(r.implicacion, /no est[áa] filtrando/i)
})

// Marketing no, ventas sí: el umbral puede estar dejando fuera negocio real.
test('marketing la descarta y ventas le presenta la oferta: el filtro deja fuera negocio', () => {
  const r = compararCualificaciones(false, true, true)
  assert.equal(r.concordancia, 'solo_ventas')
  assert.equal(r.esDiscrepancia, true)
  assert.match(r.implicacion, /dejando fuera negocio/i)
})

// ---------------------------------------------------------------------------------------------
// LOS SILENCIOS — dos muy distintos que no se pueden colapsar.
// ---------------------------------------------------------------------------------------------

// Un no-show no tiene juicio de ventas porque no hubo nada que juzgar. No es un hueco de proceso.
test('sin llamada celebrada no falta el juicio de ventas: no había nada que juzgar', () => {
  const r = compararCualificaciones(true, null, false)
  assert.equal(r.concordancia, 'sin_dato')
  assert.equal(r.esDiscrepancia, false)
  assert.match(r.motivo, /no se celebr/i)
})

// Una llamada celebrada sin marcar SÍ es un hueco de proceso, y hay que verlo.
test('una llamada celebrada sin valoración del closer es un hueco de proceso', () => {
  const r = compararCualificaciones(true, null, true)
  assert.equal(r.concordancia, 'sin_juicio_ventas')
  assert.equal(r.esDiscrepancia, false)
  assert.match(r.implicacion, /filtrando bien/i)
})

// Sin cualificación de marketing no hay con qué comparar, y la acción es revisar el formulario.
test('sin cualificación de marketing no hay comparación posible', () => {
  const r = compararCualificaciones(null, true, true)
  assert.equal(r.concordancia, 'sin_dato')
  assert.equal(r.esDiscrepancia, false)
  assert.match(r.implicacion, /formulario/i)
})

test('sin ninguna de las dos, sin dato y sin nada que accionar', () => {
  const r = compararCualificaciones(null, null, true)
  assert.equal(r.concordancia, 'sin_dato')
  assert.equal(r.implicacion, '')
})

// ---------------------------------------------------------------------------------------------
// EL RESUMEN — y su denominador, que es lo que decide si el número miente.
// ---------------------------------------------------------------------------------------------

// EL DENOMINADOR ES LO COMPARABLE, no el total. Meter las agendas sin valoración del closer hundiría
// la tasa por falta de marcado, y el número diría "marketing y ventas no se entienden" cuando lo que
// pasa es que nadie rellenó su parte.
test('la tasa de concordancia se calcula solo sobre lo comparable', () => {
  const r = resumirConcordancia([
    compararCualificaciones(true, true, true), // concuerda
    compararCualificaciones(false, false, true), // concuerda
    compararCualificaciones(true, false, true), // discrepa
    compararCualificaciones(true, null, true), // sin juicio -> fuera del denominador
    compararCualificaciones(null, null, false), // sin dato -> fuera del denominador
  ])
  assert.equal(r.comparables, 3)
  assert.equal(r.concuerdan, 2)
  assert.equal(r.soloMarketing, 1)
  assert.equal(r.sinJuicioVentas, 1)
  assert.equal(r.sinDato, 1)
  assert.ok(Math.abs(r.tasaConcordancia - 66.67) < 0.01)
})

// Sin nada comparable la tasa es null, NO 0%. Un 0% diría que marketing y ventas nunca coinciden,
// cuando lo que pasa es que todavía no se ha comparado nada.
test('sin nada comparable la tasa es null, no cero', () => {
  const r = resumirConcordancia([compararCualificaciones(true, null, true), compararCualificaciones(null, null, false)])
  assert.equal(r.comparables, 0)
  assert.equal(r.tasaConcordancia, null)
  assert.notEqual(r.tasaConcordancia, 0)
})

test('un conjunto vacío no inventa una tasa', () => {
  assert.equal(resumirConcordancia([]).tasaConcordancia, null)
})

// Las dos discrepancias se cuentan SEPARADAS: apuntan a acciones opuestas (endurecer el filtro vs
// relajarlo), así que sumarlas en un solo "discrepancias" perdería la única información útil.
test('las dos discrepancias se cuentan por separado', () => {
  const r = resumirConcordancia([
    compararCualificaciones(true, false, true),
    compararCualificaciones(false, true, true),
  ])
  assert.equal(r.soloMarketing, 1)
  assert.equal(r.soloVentas, 1)
  assert.equal(r.comparables, 2)
  assert.equal(r.tasaConcordancia, 0, 'aquí sí es 0%: se comparó y no coincidió ninguna')
})
