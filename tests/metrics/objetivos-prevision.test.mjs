import assert from 'node:assert/strict'
import test from 'node:test'
import { medirObjetivo, medirObjetivos, resumirObjetivos, TOLERANCIA_RITMO } from '../../lib/metrics/objetivos.ts'
import { HORIZONTE_MAXIMO, MINIMO_PUNTOS, preverCierrePorRunRate, preverSerie } from '../../lib/metrics/prevision.ts'

const obj = (over = {}) => ({
  key: 'facturacion',
  nombre: 'Facturación',
  periodo: 'mes',
  clase: 'acumulativa',
  valor: 40_000,
  higherIsBetter: true,
  ...over,
})

// =============================================================================================
// OBJETIVO vs REAL
// =============================================================================================

// EL ERROR QUE ESTE MÓDULO EXISTE PARA NO COMETER: dividir una TASA por lo transcurrido del periodo.
// Un close rate del 12% el día 10 no es "el 48% del objetivo del 25%": un close rate no se acumula.
test('una tasa no se ajusta por lo transcurrido ni se proyecta', () => {
  const m = medirObjetivo({
    objetivo: obj({ key: 'close_rate', nombre: 'Close rate', clase: 'tasa', valor: 25 }),
    actual: 12,
    fraccionTranscurrida: 0.33,
  })
  assert.equal(m.ritmo, null)
  assert.equal(m.proyeccionCierre, null)
  assert.equal(m.consecucion, 48, 'la consecución es actual/objetivo, sin ajustar')
  assert.match(m.nota, /sin ajustar por lo transcurrido/i)
})

test('una acumulativa sí calcula ritmo y cierre proyectado', () => {
  const m = medirObjetivo({ objetivo: obj(), actual: 20_000, fraccionTranscurrida: 0.5 })
  assert.equal(m.ritmo, 'en_linea')
  assert.equal(m.proyeccionCierre, 40_000)
  assert.match(m.nota, /cierre proyectado/i)
})

test('el ritmo distingue por delante, en línea y por detrás con su tolerancia', () => {
  const con = (actual) => medirObjetivo({ objetivo: obj(), actual, fraccionTranscurrida: 0.5 }).ritmo
  assert.equal(con(30_000), 'por_delante')
  assert.equal(con(10_000), 'por_detras')
  // El borde exacto de la tolerancia cuenta como en línea.
  const necesario = 40_000 * 0.5
  assert.equal(con(necesario + necesario * TOLERANCIA_RITMO), 'en_linea')
  assert.equal(con(necesario + necesario * TOLERANCIA_RITMO * 1.1), 'por_delante')
})

test('"proyección" se dice como proyección, no como previsión de cierre garantizada', () => {
  const m = medirObjetivo({ objetivo: obj(), actual: 5_000, fraccionTranscurrida: 0.25 })
  assert.match(m.nota, /proyectado/i)
  assert.doesNotMatch(m.nota, /vas a facturar|garantiz/i)
})

// SIN DATO NO ES CERO: un objetivo sin real medido no es un 0% de consecución.
test('sin dato medido no hay 0% de consecución ni ritmo', () => {
  const m = medirObjetivo({ objetivo: obj(), actual: null, fraccionTranscurrida: 0.5 })
  assert.equal(m.consecucion, null)
  assert.equal(m.brecha, null)
  assert.equal(m.ritmo, null)
  assert.match(m.nota, /no cuenta como 0%/i)
})

test('un objetivo permanente o un periodo cerrado no tienen ritmo', () => {
  assert.equal(
    medirObjetivo({ objetivo: obj({ periodo: 'permanente' }), actual: 100, fraccionTranscurrida: 0.5 }).ritmo,
    null
  )
  assert.equal(medirObjetivo({ objetivo: obj(), actual: 100, fraccionTranscurrida: 1 }).ritmo, null)
  assert.equal(medirObjetivo({ objetivo: obj(), actual: 100 }).ritmo, null)
})

// Un objetivo de COSTE se lee al revés: gastar 400 de un techo de 500 es cumplir de sobra.
test('en un objetivo de coste gastar menos es más consecución, no menos', () => {
  const m = medirObjetivo({
    objetivo: obj({ key: 'cac', nombre: 'CAC', clase: 'tasa', valor: 500, higherIsBetter: false }),
    actual: 400,
  })
  assert.equal(m.consecucion, 125)
  assert.equal(m.brecha, -100)
})

test('la tendencia mira la dirección buena de cada métrica', () => {
  const sube = (higherIsBetter, actual, previo) =>
    medirObjetivo({ objetivo: obj({ clase: 'tasa', higherIsBetter }), actual, previo }).tendencia
  assert.equal(sube(true, 10, 5), 'mejora')
  assert.equal(sube(true, 5, 10), 'empeora')
  assert.equal(sube(false, 10, 5), 'empeora', 'un coste que sube no es una mejora')
  assert.equal(sube(false, 5, 10), 'mejora')
  assert.equal(sube(true, 5, 5), 'plano')
  assert.equal(medirObjetivo({ objetivo: obj(), actual: 5 }).tendencia, 'sin_comparable')
})

test('dice cuánto falta por unidad de periodo restante', () => {
  const m = medirObjetivo({
    objetivo: obj(),
    actual: 25_000,
    fraccionTranscurrida: 0.5,
    unidadesRestantes: 15,
    nombreUnidadRestante: 'días',
  })
  assert.equal(m.faltaPorPeriodoRestante, 1_000)
  assert.match(m.nota, /1000 por día/)
})

test('cero unidades restantes no divide por cero', () => {
  const m = medirObjetivo({ objetivo: obj(), actual: 25_000, fraccionTranscurrida: 0.99, unidadesRestantes: 0 })
  assert.equal(m.faltaPorPeriodoRestante, null)
})

test('un objetivo de cero no produce Infinity en la consecución', () => {
  assert.equal(medirObjetivo({ objetivo: obj({ valor: 0 }), actual: 10 }).consecucion, null)
})

test('el resumen cuenta cumplidos, por detrás y huecos sin mezclarlos', () => {
  const r = resumirObjetivos(
    medirObjetivos([
      { objetivo: obj({ key: 'a' }), actual: 41_000, fraccionTranscurrida: 0.9 },
      { objetivo: obj({ key: 'b' }), actual: 5_000, fraccionTranscurrida: 0.9 },
      { objetivo: obj({ key: 'c' }), actual: null },
    ])
  )
  assert.deepEqual(
    { total: r.total, enObjetivo: r.enObjetivo, porDetras: r.porDetras, sinDatos: r.sinDatos },
    {
      total: 3,
      enObjetivo: 1,
      porDetras: 1,
      sinDatos: 1,
    }
  )
  assert.match(r.titular, /1 de 2 objetivos cumplidos/)
  assert.match(r.titular, /1 sin datos/)
})

test('sin ningún objetivo medido el resumen no inventa un 0 de N', () => {
  const r = resumirObjetivos(medirObjetivos([{ objetivo: obj(), actual: null }]))
  assert.match(r.titular, /aún no hay objetivos con datos/i)
})

// =============================================================================================
// PREVISIÓN
// =============================================================================================

const serie = (valores) => valores.map((valor, i) => ({ fecha: `d${i}`, valor }))

test('con menos del mínimo de observaciones no se prevé nada', () => {
  assert.equal(MINIMO_PUNTOS, 4)
  assert.equal(preverSerie(serie([1, 2, 3]), 2), null)
  assert.equal(preverSerie([], 2), null)
  // Dos puntos definen una recta perfecta y la recta no significa nada.
  assert.equal(preverSerie(serie([1, 10]), 5), null)
})

test('no se prevé más allá de la mitad del histórico, y se avisa del recorte', () => {
  assert.equal(HORIZONTE_MAXIMO, 0.5)
  const p = preverSerie(serie([1, 2, 3, 4, 5, 6, 7, 8]), 52)
  assert.equal(p.pasos, 4)
  assert.equal(p.pasosSolicitados, 52)
  assert.match(p.aviso, /recortado a 4/)
  assert.equal(p.puntos.filter((x) => x.tipo === 'previsto').length, 4)
})

test('sin recorte no se inventa un aviso', () => {
  assert.equal(preverSerie(serie([1, 2, 3, 4, 5, 6, 7, 8]), 3).aviso, null)
})

test('lo real y lo previsto van marcados para que el gráfico los pinte distinto', () => {
  const p = preverSerie(serie([10, 12, 14, 16]), 2)
  assert.equal(p.puntos.filter((x) => x.tipo === 'real').length, 4)
  assert.equal(p.puntos.filter((x) => x.tipo === 'previsto').length, 2)
  // El orden es cronológico: los reales primero.
  assert.equal(p.puntos[0].tipo, 'real')
  assert.equal(p.puntos.at(-1).tipo, 'previsto')
})

test('una tendencia limpia se extrapola bien y R² lo refleja', () => {
  const p = preverSerie(serie([10, 12, 14, 16, 18, 20, 22, 24]), 2)
  assert.equal(p.r2, 1)
  assert.equal(p.confianza, 'alta')
  assert.equal(p.valorFinal, 28)
  assert.match(p.explicacion, /Regresión lineal sobre 8 observaciones/)
  assert.match(p.explicacion, /al alza/)
})

// Una serie caótica admite una recta; lo que no admite es que nadie decida con ella.
test('una serie caótica se marca con confianza baja', () => {
  const p = preverSerie(serie([3, 40, 2, 80, 5, 60, 1, 70]), 2)
  assert.ok(p.r2 < 0.4)
  assert.equal(p.confianza, 'baja')
})

test('el método y su carácter de proyección se dicen siempre', () => {
  const p = preverSerie(serie([1, 2, 3, 4, 5, 6]), 2)
  assert.equal(p.metodo, 'regresion_lineal')
  assert.match(p.explicacion, /Proyección, no compromiso/i)
  assert.match(p.explicacion, /R²/)
})

test('una métrica que no puede ser negativa no se proyecta en negativo', () => {
  const p = preverSerie(serie([10, 8, 6, 4, 2, 1]), 3, { noNegativa: true })
  assert.ok(p.puntos.every((x) => x.valor >= 0))
  // Y sin la opción sí baja de cero: la decisión es de quien llama, no implícita.
  assert.ok(preverSerie(serie([10, 8, 6, 4, 2, 1]), 3).puntos.some((x) => x.valor < 0))
})

test('una serie plana no revienta el R² con una división 0/0', () => {
  const p = preverSerie(serie([5, 5, 5, 5, 5, 5]), 2)
  assert.equal(p.r2, 1)
  assert.equal(p.valorFinal, 5)
  assert.match(p.explicacion, /plana/)
})

test('las etiquetas de fecha de lo previsto las pone quien llama', () => {
  const p = preverSerie(serie([1, 2, 3, 4]), 2, { siguienteFecha: (_u, k) => `sem+${k}` })
  assert.deepEqual(
    p.puntos.filter((x) => x.tipo === 'previsto').map((x) => x.fecha),
    ['sem+1', 'sem+2']
  )
})

// ---------------------------------------------------------------------------------------------
// RUN-RATE: el método correcto para "¿cuánto voy a facturar este mes?", y distinto de la regresión.
// ---------------------------------------------------------------------------------------------

test('el run-rate proyecta el cierre y dice si alcanza el objetivo', () => {
  const r = preverCierrePorRunRate(20_000, 0.5, { objetivo: 40_000, etiquetaPeriodo: 'septiembre' })
  assert.equal(r.proyeccion, 40_000)
  assert.equal(r.alcanzaObjetivo, true)
  assert.equal(r.metodo, 'run_rate')
  assert.match(r.explicacion, /50%/)
  assert.match(r.explicacion, /Asume que el ritmo se mantiene/i)
})

// Al principio del periodo el run-rate es casi ruido: un buen día 2 proyecta un mes histórico.
test('el run-rate temprano se marca con confianza baja', () => {
  assert.equal(preverCierrePorRunRate(3_000, 0.07).confianza, 'baja')
  assert.equal(preverCierrePorRunRate(3_000, 0.4).confianza, 'media')
  assert.equal(preverCierrePorRunRate(3_000, 0.8).confianza, 'alta')
})

test('el run-rate no se calcula con una fracción imposible', () => {
  assert.equal(preverCierrePorRunRate(100, 0), null)
  assert.equal(preverCierrePorRunRate(100, -0.5), null)
  assert.equal(preverCierrePorRunRate(100, 1.4), null)
})

test('sin objetivo no se afirma si se alcanza', () => {
  assert.equal(preverCierrePorRunRate(100, 0.5).alcanzaObjetivo, null)
})
