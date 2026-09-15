import assert from 'node:assert/strict'
import test from 'node:test'
import { calcularEstado, calcularVariacion, esMejora, medir, textoObjetivo } from '../../lib/metrics/modelo.ts'
import {
  buscarMetrica,
  KEYS_DIAGNOSTICO,
  METRICAS_DIAGNOSTICO,
  METRICAS_GLOBAL,
  TODAS_LAS_METRICAS,
} from '../../lib/metrics/registro.ts'

const def = (over = {}) => ({ higherIsBetter: true, targetType: 'minimo', target: 100, ...over })

// ---------------------------------------------------------------------------------------------
// LA REGLA QUE MÁS IMPORTA: MÁS ALTO NO ES VERDE POR DEFECTO.
// ---------------------------------------------------------------------------------------------

// Un objetivo de MÍNIMO se cumple alcanzándolo o superándolo (Close Rate ≥ 25%).
test('con objetivo de mínimo, alcanzarlo o superarlo es verde', () => {
  assert.equal(calcularEstado(def(), 120), 'verde')
  assert.equal(calcularEstado(def(), 100), 'verde')
})

// Un objetivo de MÁXIMO se cumple quedándose por debajo. Es el caso del CAC, del churn y del coste
// por agenda: bajar es ganar.
test('con objetivo de máximo, quedarse por debajo es verde', () => {
  const cac = def({ higherIsBetter: false, targetType: 'maximo', target: 400 })
  assert.equal(calcularEstado(cac, 300), 'verde')
  assert.equal(calcularEstado(cac, 400), 'verde')
  assert.equal(calcularEstado(cac, 600), 'rojo')
})

// El mismo número con el mismo objetivo da semáforos OPUESTOS según el tipo. Esto es exactamente lo
// que se rompe cuando una pantalla asume que más alto es mejor.
test('el mismo valor sale verde o rojo según el tipo de objetivo', () => {
  assert.equal(calcularEstado(def({ targetType: 'minimo', target: 100 }), 150), 'verde')
  assert.equal(calcularEstado(def({ targetType: 'maximo', target: 100 }), 150), 'rojo')
})

// La tolerancia existe para que un 401 contra un objetivo de 400 no salga rojo: eso es ruido.
test('cerca del objetivo es amarillo, no rojo', () => {
  assert.equal(calcularEstado(def({ target: 100 }), 95), 'amarillo')
  assert.equal(calcularEstado(def({ target: 100 }), 80), 'rojo')

  const cac = def({ higherIsBetter: false, targetType: 'maximo', target: 400 })
  assert.equal(calcularEstado(cac, 420), 'amarillo')
})

test('un objetivo de rango tiene banda buena por arriba y por abajo', () => {
  const show = def({ targetType: 'rango', targetMin: 65, targetMax: 70 })
  assert.equal(calcularEstado(show, 67), 'verde')
  assert.equal(calcularEstado(show, 64.8), 'amarillo')
  assert.equal(calcularEstado(show, 40), 'rojo')
  // Y pasarse por arriba TAMBIÉN sale del rango: es lo que distingue un rango de un mínimo.
  assert.equal(calcularEstado(show, 95), 'rojo')
})

// ---------------------------------------------------------------------------------------------
// GRIS NO ES ROJO. "No lo sabemos" y "va mal" llevan a acciones opuestas: la primera se arregla
// conectando una fuente, la segunda cambiando el negocio.
// ---------------------------------------------------------------------------------------------

test('sin valor el semáforo es gris, nunca rojo', () => {
  assert.equal(calcularEstado(def(), null), 'gris')
  assert.equal(calcularEstado(def(), Number.NaN), 'gris')
})

test('con la fuente sin conectar es gris aunque llegue un número', () => {
  for (const estado of ['sin_datos', 'fuente_no_conectada', 'no_medido', 'parcial', 'error']) {
    assert.equal(calcularEstado(def(), 150, estado), 'gris', estado)
  }
})

// Sin objetivo declarado la métrica se enseña, pero no se finge un juicio. Inventarse un benchmark y
// pintar rojo con él es peor que no juzgar.
test('sin objetivo declarado no se inventa un semáforo', () => {
  assert.equal(calcularEstado(def({ targetType: 'ninguno', target: undefined }), 150), 'gris')
  // Y un tipo con objetivo pero sin número tampoco juzga.
  assert.equal(calcularEstado(def({ target: undefined }), 150), 'gris')
  assert.equal(calcularEstado(def({ targetType: 'rango', targetMin: 65 }), 67), 'gris')
})

// ---------------------------------------------------------------------------------------------
// VARIACIÓN — y por qué el signo no basta.
// ---------------------------------------------------------------------------------------------

test('la variación da el cambio absoluto y el porcentual', () => {
  const v = calcularVariacion(120, 100)
  assert.equal(v.absoluteChange, 20)
  assert.equal(v.percentageChange, 20)
})

// Pasar de 0 a 3 ventas no es "+∞%" ni "+100%": el porcentaje no significa nada ahí. El cambio
// absoluto sí, y es lo que se enseña.
test('desde cero no se inventa un porcentaje', () => {
  const v = calcularVariacion(3, 0)
  assert.equal(v.absoluteChange, 3)
  assert.equal(v.percentageChange, null)
})

test('sin periodo anterior no hay variación que dar', () => {
  assert.deepEqual(calcularVariacion(100, null), { absoluteChange: null, percentageChange: null })
  assert.deepEqual(calcularVariacion(null, 100), { absoluteChange: null, percentageChange: null })
})

// UN CAC QUE BAJA ES UNA FLECHA HACIA ABAJO Y UNA BUENA NOTICIA. Pintar de rojo toda flecha
// descendente es el error más común de estos paneles.
test('una bajada es buena noticia cuando lo bueno es bajar', () => {
  assert.equal(esMejora(false, -50), true, 'el CAC baja: mejora')
  assert.equal(esMejora(false, 50), false, 'el CAC sube: empeora')
  assert.equal(esMejora(true, 50), true, 'el revenue sube: mejora')
  assert.equal(esMejora(true, -50), false, 'el revenue baja: empeora')
})

test('sin cambio o sin dato no se juzga la variación', () => {
  assert.equal(esMejora(true, 0), null)
  assert.equal(esMejora(true, null), null)
})

// ---------------------------------------------------------------------------------------------
// MEDIR — la definición resuelta contra datos.
// ---------------------------------------------------------------------------------------------

test('medir une definición, valores y estado', () => {
  const d = buscarMetrica('cash_collected')
  assert.ok(d)
  const m = medir(d, { value: 21984, previousValue: 18000, dataReliability: 'alta' })
  assert.equal(m.value, 21984)
  assert.equal(m.absoluteChange, 3984)
  assert.equal(m.estadoDato, 'ok')
  assert.equal(m.dataReliability, 'alta')
  assert.equal(m.name, 'Cash Collected')
})

// Sin fuente conectada la fiabilidad no puede ser alta, diga lo que diga quien la declaró.
test('un dato no disponible nunca se presenta como fiable', () => {
  const d = buscarMetrica('cash_collected')
  const m = medir(d, { value: null, estadoDato: 'fuente_no_conectada', dataReliability: 'alta' })
  assert.equal(m.dataReliability, 'baja')
  assert.equal(m.status, 'gris')
})

test('un valor nulo sin estado declarado se marca como sin datos', () => {
  const m = medir(buscarMetrica('ventas'), { value: null })
  assert.equal(m.estadoDato, 'sin_datos')
})

// ---------------------------------------------------------------------------------------------
// EL REGISTRO — invariantes que evitan paneles que se contradicen.
// ---------------------------------------------------------------------------------------------

test('no hay dos métricas con la misma clave', () => {
  const keys = TODAS_LAS_METRICAS.map((m) => m.key)
  assert.equal(new Set(keys).size, keys.length, 'hay claves duplicadas en el registro')
})

test('toda métrica declara lo que hace falta para el tooltip', () => {
  for (const m of TODAS_LAS_METRICAS) {
    for (const campo of ['name', 'shortName', 'formula', 'description', 'whyItMatters', 'dataSource']) {
      assert.ok(String(m[campo] ?? '').trim(), `${m.key}: falta ${campo}`)
    }
    assert.equal(typeof m.higherIsBetter, 'boolean', `${m.key}: higherIsBetter es obligatorio`)
  }
})

// El que tiene que entender el tooltip no sabe finanzas: la descripción no puede ser la fórmula otra
// vez con otras palabras.
test('la descripción no repite la fórmula', () => {
  for (const m of TODAS_LAS_METRICAS) {
    assert.notEqual(m.description.trim(), m.formula.trim(), `${m.key}`)
  }
})

// Las métricas donde bajar es ganar tienen que estar declaradas como tales. Si alguien añade un coste
// nuevo y se olvida, este test lo caza.
test('los costes declaran que lo bueno es bajar', () => {
  for (const key of ['cac', 'cpqbc', 'cpc', 'cpm', 'speed_to_lead']) {
    const m = buscarMetrica(key)
    assert.ok(m, `falta la métrica ${key}`)
    assert.equal(m.higherIsBetter, false, `${key}: bajar debería ser lo bueno`)
  }
})

// CPM, CTR y CPC NO son objetivos del negocio. Van marcadas como diagnóstico y SIN objetivo, para que
// ninguna pantalla las pinte en verde como si fueran un logro.
test('las métricas de diagnóstico no llevan objetivo ni semáforo', () => {
  for (const m of METRICAS_DIAGNOSTICO) {
    assert.equal(m.targetType, 'ninguno', `${m.key}`)
    assert.equal(calcularEstado(m, 42), 'gris', `${m.key}`)
    assert.ok(KEYS_DIAGNOSTICO.has(m.key))
  }
  for (const key of ['ctr', 'cpc', 'cpm']) assert.ok(KEYS_DIAGNOSTICO.has(key), key)
})

// EL ORDEN ES LA TESIS: lo final del negocio primero, el diagnóstico al final. Quien recorra la lista
// para pintar un panel obtiene la jerarquía sin tener que acordarse de ordenarla.
test('el registro va de lo final del negocio a lo diagnóstico', () => {
  const pos = (key) => TODAS_LAS_METRICAS.findIndex((m) => m.key === key)
  assert.ok(pos('cash_collected') < pos('cac'), 'el cash va antes que el CAC')
  assert.ok(pos('cac') < pos('agendas'), 'el CAC va antes que las agendas')
  assert.ok(pos('agendas') < pos('ctr'), 'las agendas van antes que el CTR')
  // Y ninguna de diagnóstico se cuela antes de una de negocio.
  const primeraDiagnostico = TODAS_LAS_METRICAS.findIndex((m) => KEYS_DIAGNOSTICO.has(m.key))
  const ultimaNegocio = TODAS_LAS_METRICAS.map((m) => KEYS_DIAGNOSTICO.has(m.key)).lastIndexOf(false)
  assert.ok(primeraDiagnostico > ultimaNegocio)
})

// Las dos tasas de cierre NO son la misma y no pueden llamarse igual: sobre llamadas siempre sale más
// baja porque incluye las que ni llegaron a la oferta.
test('las dos tasas de cierre se distinguen por el nombre', () => {
  const ofertas = buscarMetrica('close_rate_ofertas')
  const llamadas = buscarMetrica('close_rate_llamadas')
  assert.ok(ofertas && llamadas)
  assert.notEqual(ofertas.name, llamadas.name)
  assert.notEqual(ofertas.shortName, llamadas.shortName)
  assert.notEqual(ofertas.formula, llamadas.formula)
})

// Facturación y cash son dos métricas distintas, con fuentes distintas. Es el invariante que ya costó
// una corrección de datos en producción.
test('facturación contratada y cash collected son métricas separadas', () => {
  const facturacion = buscarMetrica('contracted_revenue')
  const cash = buscarMetrica('cash_collected')
  assert.ok(facturacion && cash)
  assert.notEqual(facturacion.formula, cash.formula)
  assert.match(cash.dataSource, /pasarela|stripe/i)
})

test('el texto del objetivo se lee según su tipo', () => {
  assert.equal(textoObjetivo(buscarMetrica('cash_roas')), '≥ 2')
  assert.equal(textoObjetivo(buscarMetrica('speed_to_lead')), '≤ 5')
  assert.equal(textoObjetivo(buscarMetrica('show_rate')), '65% – 70%')
  assert.equal(textoObjetivo(buscarMetrica('ctr')), null)
})

test('las métricas globales son las del negocio, no las de canal', () => {
  assert.ok(METRICAS_GLOBAL.every((m) => m.category === 'global'))
  for (const key of ['cash_collected', 'contracted_revenue', 'cash_roas', 'ltgp_cac']) {
    assert.ok(
      METRICAS_GLOBAL.some((m) => m.key === key),
      key
    )
  }
})
