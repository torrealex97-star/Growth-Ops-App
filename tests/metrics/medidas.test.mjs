import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clavesDeCategoria,
  coberturaDeCategoria,
  fiabilidadPorMuestra,
  medidaDe,
  medirTodas,
} from '../../lib/metrics/medidas.ts'
import { TODAS_LAS_METRICAS } from '../../lib/metrics/registro.ts'

// ---------------------------------------------------------------------------------------------
// EL MOTIVO TIENE QUE LLEGAR A LA TARJETA. Si se pierde en la traducción, la tarjeta pone un guion y
// nadie sabe si no hay datos, si falló la lectura o si el negocio hizo cero.
// ---------------------------------------------------------------------------------------------

test('una medición sin valor llega con su motivo y marcada como sin datos', () => {
  const [m] = medirTodas({ cash_roas: { valor: null, muestra: null, motivo: 'Sin datos de campañas.' } })
  assert.equal(m.value, null)
  assert.equal(m.estadoDato, 'sin_datos')
  assert.equal(m.notaDato, 'Sin datos de campañas.')
})

test('una medición con valor llega como dato bueno', () => {
  const [m] = medirTodas({ cash_roas: { valor: 2.4, muestra: 120 } })
  assert.equal(m.value, 2.4)
  assert.equal(m.estadoDato, 'ok')
  assert.equal(m.notaDato, undefined)
})

// Un 0 medido NO es un hueco: es un dato. Confundirlos es el error que este sistema entero evita.
test('un cero medido se pinta como cero, no como hueco', () => {
  const [m] = medirTodas({ ad_spend: { valor: 0, muestra: 30 } })
  assert.equal(m.value, 0)
  assert.equal(m.estadoDato, 'ok')
})

// ---------------------------------------------------------------------------------------------
// EL ORDEN LO PONE EL REGISTRO. Las claves de un objeto salen en el orden en que se insertaron, así que
// el panel reordenaría sus tarjetas según cómo se calculó, y eso se lee como si algo hubiera cambiado.
// ---------------------------------------------------------------------------------------------

test('el orden de las tarjetas es el del registro, no el del objeto de mediciones', () => {
  const alReves = { cpm: { valor: 5, muestra: 10 }, cash_collected: { valor: 100, muestra: 3 } }
  const claves = medirTodas(alReves).map((m) => m.key)
  const esperado = TODAS_LAS_METRICAS.filter((d) => claves.includes(d.key)).map((d) => d.key)
  assert.deepEqual(claves, esperado)
})

test('una clave que no está en el registro no se pinta', () => {
  assert.deepEqual(medirTodas({ inventada_xyz: { valor: 1, muestra: 1 } }), [])
})

test('se puede filtrar por categoría para no pintar el registro entero en cada pantalla', () => {
  const todas = { cash_collected: { valor: 1, muestra: 1 }, ctr: { valor: 2, muestra: 1 } }
  const soloGlobal = medirTodas(todas, { soloCategoria: 'global' })
  assert.ok(soloGlobal.length >= 1)
  assert.ok(soloGlobal.every((m) => m.category === 'global'))
  assert.ok(clavesDeCategoria('global').includes('cash_collected'))
})

// ---------------------------------------------------------------------------------------------
// LA FIABILIDAD USA LOS MISMOS CORTES QUE EL MOTOR. Si la tarjeta dijera "alta" sobre una muestra que el
// motor considera corta, el panel y el diagnóstico estarían diciendo cosas distintas del mismo número.
// ---------------------------------------------------------------------------------------------

test('la fiabilidad sigue los mismos umbrales que el diagnóstico', () => {
  assert.equal(fiabilidadPorMuestra(null), 'baja')
  assert.equal(fiabilidadPorMuestra(19), 'baja')
  assert.equal(fiabilidadPorMuestra(20), 'media')
  assert.equal(fiabilidadPorMuestra(99), 'media')
  assert.equal(fiabilidadPorMuestra(100), 'alta')
})

test('la fiabilidad llega a la métrica medida', () => {
  const [poca] = medirTodas({ cash_roas: { valor: 2, muestra: 3 } })
  assert.equal(poca.dataReliability, 'baja')
  const [mucha] = medirTodas({ cash_roas: { valor: 2, muestra: 500 } })
  assert.equal(mucha.dataReliability, 'alta')
})

// ---------------------------------------------------------------------------------------------
// LA COBERTURA. Sin ella, una pantalla con tarjetas en gris parece rota en vez de incompleta.
// ---------------------------------------------------------------------------------------------

test('la cobertura distingue lo medido de los huecos', () => {
  const medidas = medirTodas({
    cash_collected: { valor: 100, muestra: 5 },
    cash_roas: { valor: null, muestra: null, motivo: 'Sin campañas.' },
    ctr: { valor: 3, muestra: 1000 },
  })
  const c = coberturaDeCategoria(medidas)
  assert.equal(c.total, 3)
  assert.equal(c.medidas, 2)
  assert.equal(c.huecos, 1)
})

test('se puede localizar una métrica concreta para colocarla a mano', () => {
  const medidas = medirTodas({ cash_roas: { valor: 2, muestra: 120 } })
  assert.equal(medidaDe(medidas, 'cash_roas').value, 2)
  assert.equal(medidaDe(medidas, 'no_existe'), undefined)
})

test('el valor anterior se pasa para poder pintar la variación', () => {
  const [m] = medirTodas(
    { cash_roas: { valor: 3, muestra: 120 } },
    { anteriores: { cash_roas: { valor: 2, muestra: 100 } } }
  )
  assert.equal(m.previousValue, 2)
  assert.equal(m.absoluteChange, 1)
})
