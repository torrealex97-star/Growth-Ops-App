import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONFIG_DIAGNOSTICO_POR_DEFECTO,
  diagnosticarCuelloBotella,
  evaluarEscalado,
} from '../../lib/metrics/cuello-botella.ts'

/** Una métrica con lo mínimo, para que cada test solo escriba lo que está probando. */
const met = (over) => ({
  key: 'metrica',
  nombre: 'Métrica',
  nivel: 'ventas',
  valor: 10,
  objetivo: 20,
  higherIsBetter: true,
  muestra: 200,
  investigar: [],
  ...over,
})

const CFG = CONFIG_DIAGNOSTICO_POR_DEFECTO

// ---------------------------------------------------------------------------------------------
// LA TESIS DEL MÓDULO: se diagnostica de atrás hacia delante. Este es el test que justifica que el
// fichero exista; si cae, el panel vuelve a mandar al equipo a arreglar el CTR con la economía rota.
// ---------------------------------------------------------------------------------------------

test('una métrica de tráfico muy fuera de objetivo NO gana a una de economía apenas fuera', () => {
  const d = diagnosticarCuelloBotella([
    met({ key: 'ctr', nombre: 'CTR', nivel: 'trafico', valor: 0.6, objetivo: 1.5, muestra: 40_000 }),
    met({ key: 'ltgp_cac', nombre: 'LTGP:CAC', nivel: 'economia', valor: 2.8, objetivo: 3, muestra: 120 }),
  ])
  assert.equal(d.primaria.key, 'ltgp_cac')
  // El CTR no desaparece: baja a secundaria, que es donde se puede mirar sin dirigir la semana.
  assert.deepEqual(
    d.secundarias.map((s) => s.key),
    ['ctr']
  )
})

test('el orden se respeta nivel por nivel en toda la jerarquía', () => {
  const niveles = ['trafico', 'funnel', 'oportunidades', 'ventas', 'caja', 'economia']
  const d = diagnosticarCuelloBotella(
    niveles.map((nivel) => met({ key: nivel, nombre: nivel, nivel, valor: 1, objetivo: 10 }))
  )
  assert.equal(d.primaria.key, 'economia')
  assert.deepEqual(
    d.secundarias.map((s) => s.key),
    ['caja', 'ventas'],
    'las secundarias también siguen la jerarquía, no el tamaño del desvío'
  )
})

// Dentro del MISMO nivel sí manda la gravedad: ahí no hay jerarquía que decida.
test('dentro del mismo nivel desempata la gravedad y luego la muestra', () => {
  const d = diagnosticarCuelloBotella([
    met({ key: 'aviso_mucha_muestra', valor: 19, objetivo: 20, muestra: 500 }),
    met({ key: 'critico', valor: 10, objetivo: 20, muestra: 100 }),
  ])
  assert.equal(d.primaria.key, 'critico')
  assert.equal(d.primaria.severidad, 'critico')

  const empate = diagnosticarCuelloBotella([
    met({ key: 'poca', valor: 10, objetivo: 20, muestra: 30 }),
    met({ key: 'mucha', valor: 10, objetivo: 20, muestra: 400 }),
  ])
  assert.equal(empate.primaria.key, 'mucha')
})

// ---------------------------------------------------------------------------------------------
// LA REGLA DE LA MUESTRA. Un close rate del 14% con siete llamadas y otro con 430 son el mismo número
// y dos hechos distintos.
// ---------------------------------------------------------------------------------------------

test('una métrica con muestra por debajo del mínimo no se elige como primaria si hay otra con muestra', () => {
  const d = diagnosticarCuelloBotella([
    met({ key: 'economia_7_llamadas', nivel: 'economia', valor: 1, objetivo: 3, muestra: 7 }),
    met({ key: 'ventas_con_muestra', nivel: 'ventas', valor: 10, objetivo: 20, muestra: 300 }),
  ])
  // Aquí la jerarquía CEDE ante la muestra: dirigir el negocio con siete observaciones es peor que
  // mirar un nivel más adelante con trescientas.
  assert.equal(d.primaria.key, 'ventas_con_muestra')
  assert.equal(d.secundarias[0].key, 'economia_7_llamadas')
})

test('si ninguna candidata llega al mínimo se devuelve la mejor, pero marcada como posible', () => {
  const d = diagnosticarCuelloBotella([met({ valor: 1, objetivo: 20, muestra: 3 })])
  assert.equal(d.primaria.confianza, 'baja')
  assert.equal(d.primaria.certeza, 'posible')
  assert.match(d.titular, /muestra corta/i)
})

test('la certeza nunca es probable con confianza baja, y la confianza sigue los umbrales', () => {
  const casos = [
    [null, 'baja'],
    [CFG.muestraMinima - 1, 'baja'],
    [CFG.muestraMinima, 'media'],
    [CFG.muestraAlta - 1, 'media'],
    [CFG.muestraAlta, 'alta'],
  ]
  for (const [muestra, confianza] of casos) {
    const p = diagnosticarCuelloBotella([met({ valor: 1, objetivo: 20, muestra })]).primaria
    assert.equal(p.confianza, confianza, `muestra ${muestra}`)
    assert.equal(p.certeza, confianza === 'baja' ? 'posible' : 'probable')
  }
})

// Ninguna salida del motor puede afirmar una causa. Lo más que se dice es "probable".
test('el motor nunca afirma una causa: la certeza máxima es probable', () => {
  const d = diagnosticarCuelloBotella([met({ valor: 1, objetivo: 20, muestra: 100_000 })])
  assert.equal(d.primaria.certeza, 'probable')
  assert.doesNotMatch(d.titular, /la causa|porque/i)
})

// ---------------------------------------------------------------------------------------------
// FALTA DE DATO ≠ PROBLEMA DE NEGOCIO. Un cero por no medir, tratado como un cero real, manda a
// arreglar algo que nadie sabe si está roto.
// ---------------------------------------------------------------------------------------------

test('lo que no tiene dato va a sinDatos y no puede ser la restricción', () => {
  const d = diagnosticarCuelloBotella([
    met({ key: 'sin_valor', valor: null, objetivo: 20 }),
    met({ key: 'sin_objetivo', valor: 10, objetivo: null }),
  ])
  assert.equal(d.primaria, null)
  assert.deepEqual(
    d.sinDatos.map((s) => s.key),
    ['sin_valor', 'sin_objetivo']
  )
  // Se declara como hueco de medición, no como diagnóstico.
  assert.ok(d.sinDatos.every((s) => s.certeza === 'requiere_investigacion'))
  assert.match(d.titular, /sin datos/i)
  assert.doesNotMatch(d.titular, /restricción/i)
})

test('sin nada fuera de objetivo y sin huecos el titular lo dice sin inventar un problema', () => {
  const d = diagnosticarCuelloBotella([met({ valor: 30, objetivo: 20 })])
  assert.equal(d.primaria, null)
  assert.deepEqual(d.secundarias, [])
  assert.deepEqual(d.sinDatos, [])
  assert.equal(d.titular, 'Ninguna métrica está fuera de objetivo.')
})

test('una métrica en su objetivo exacto no está fuera de objetivo', () => {
  assert.equal(diagnosticarCuelloBotella([met({ valor: 20, objetivo: 20 })]).primaria, null)
})

// ---------------------------------------------------------------------------------------------
// LA DIRECCIÓN. La mitad de las métricas del negocio son mejores cuanto MÁS BAJAS (CAC, CPL, CPQBC).
// Confundir el sentido convierte un CAC excelente en una alarma.
// ---------------------------------------------------------------------------------------------

test('en una métrica de coste estar por debajo del objetivo es estar bien', () => {
  const barato = met({ key: 'cac', nombre: 'CAC', higherIsBetter: false, valor: 300, objetivo: 500 })
  assert.equal(diagnosticarCuelloBotella([barato]).primaria, null)

  const caro = diagnosticarCuelloBotella([{ ...barato, valor: 800 }]).primaria
  assert.equal(caro.severidad, 'critico')
  // Y se redacta en la dirección real: un CAC fuera de objetivo está POR ENCIMA.
  assert.match(caro.motivo, /por encima de/)
  assert.doesNotMatch(caro.motivo, /por debajo de/)
})

test('la gravedad se mide en desvío relativo, no absoluto', () => {
  const justo = diagnosticarCuelloBotella([met({ valor: 19, objetivo: 20 })]).primaria
  assert.equal(justo.severidad, 'aviso')
  // El umbral crítico es el 20% peor que el objetivo: 16 sobre 20 lo alcanza justo.
  assert.equal(diagnosticarCuelloBotella([met({ valor: 16, objetivo: 20 })]).primaria.severidad, 'critico')
  assert.equal(justo.brecha, -1)
})

test('un objetivo de cero no revienta ni produce un desvío infinito', () => {
  const d = diagnosticarCuelloBotella([met({ valor: 5, objetivo: 0 })])
  assert.equal(d.primaria, null)
})

// ---------------------------------------------------------------------------------------------
// EL IMPACTO, SIEMPRE COMO ESTIMACIÓN Y SIEMPRE CON MÉTODO.
// ---------------------------------------------------------------------------------------------

test('el impacto solo se estima para tasas sobre un volumen conocido, y siempre dice cómo', () => {
  const config = { ...CFG, volumenBase: 120, ticketMedioEur: 1500 }
  const tasa = diagnosticarCuelloBotella(
    [met({ key: 'close_rate', nombre: 'Close rate', valor: 17.5, objetivo: 25 })],
    config
  ).primaria
  assert.equal(tasa.impacto.unidadesAdicionales, 9)
  assert.equal(tasa.impacto.eurosAdicionales, 13_500)
  assert.match(tasa.impacto.metodo, /Estimación/)
  assert.match(tasa.impacto.metodo, /120/, 'el método tiene que decir sobre qué volumen se ha calculado')
})

test('sin volumen, sin tasa o en una métrica de coste no se estima impacto', () => {
  const tasa = met({ key: 'close_rate', valor: 10, objetivo: 20 })
  // Sin volumen no hay aritmética honesta posible.
  assert.equal(diagnosticarCuelloBotella([tasa]).primaria.impacto, null)
  // Un ticket medio o un CAC no son tasas: cuánto más venderías bajando el CAC no está en el dato.
  const noTasa = met({ key: 'ticket_medio', valor: 1000, objetivo: 2000 })
  assert.equal(diagnosticarCuelloBotella([noTasa], { ...CFG, volumenBase: 120 }).primaria.impacto, null)
  const coste = met({ key: 'cpl_rate', higherIsBetter: false, valor: 80, objetivo: 40 })
  assert.equal(diagnosticarCuelloBotella([coste], { ...CFG, volumenBase: 120 }).primaria.impacto, null)
})

test('sin ticket medio se estiman unidades pero no euros inventados', () => {
  const p = diagnosticarCuelloBotella([met({ key: 'close_rate', valor: 10, objetivo: 20 })], {
    ...CFG,
    volumenBase: 100,
  }).primaria
  assert.equal(p.impacto.unidadesAdicionales, 10)
  assert.equal(p.impacto.eurosAdicionales, null)
})

// ---------------------------------------------------------------------------------------------
// UNA RESTRICCIÓN, NO UNA LISTA DE VEINTE.
// ---------------------------------------------------------------------------------------------

test('nunca se devuelven más de dos secundarias, ni la primaria repetida', () => {
  const d = diagnosticarCuelloBotella(
    Array.from({ length: 9 }, (_, i) => met({ key: `m${i}`, valor: 1, objetivo: 20 }))
  )
  assert.ok(d.secundarias.length <= 2)
  assert.ok(!d.secundarias.some((s) => s.key === d.primaria.key))
})

test('la primaria arrastra qué investigar: sin eso el diagnóstico no es accionable', () => {
  const d = diagnosticarCuelloBotella([met({ valor: 1, objetivo: 20, investigar: ['Revisar el pitch'] })])
  assert.deepEqual(d.primaria.investigar, ['Revisar el pitch'])
})

test('sin métricas no se diagnostica nada y no lanza', () => {
  const d = diagnosticarCuelloBotella([])
  assert.deepEqual(d, {
    primaria: null,
    secundarias: [],
    sinDatos: [],
    titular: 'Ninguna métrica está fuera de objetivo.',
  })
})

// ---------------------------------------------------------------------------------------------
// LA DECISIÓN DE ESCALAR. Es la que mueve dinero de verdad, así que ninguna de estas ramas puede
// dar luz verde por omisión.
// ---------------------------------------------------------------------------------------------

const capacidad = (v, e = 40) => ({ utilizacionVentas: v, utilizacionEntrega: e })

test('con la economía críticamente rota hay que arreglar antes, pase lo que pase con la capacidad', () => {
  const d = diagnosticarCuelloBotella([
    met({ key: 'ltgp_cac', nombre: 'LTGP:CAC', nivel: 'economia', valor: 1, objetivo: 3, muestra: 200 }),
  ])
  const r = evaluarEscalado(d, capacidad(10, 10))
  assert.equal(r.veredicto, 'arreglar_antes')
  assert.match(r.motivos[0], /LTGP:CAC/)
})

test('al 90% de utilización toca esperar aunque la adquisición sea rentable', () => {
  const sano = diagnosticarCuelloBotella([met({ valor: 30, objetivo: 20 })])
  assert.equal(evaluarEscalado(sano, capacidad(90)).veredicto, 'esperar')
  assert.equal(evaluarEscalado(sano, capacidad(40, 95)).veredicto, 'esperar')
  // Y el techo se nombra: "esperar" sin decir por qué no sirve para decidir.
  assert.match(evaluarEscalado(sano, capacidad(40, 95)).motivos[0], /entrega/i)
})

test('sin dato de capacidad no se da luz verde: no saber si hay techo no es saber que no lo hay', () => {
  const sano = diagnosticarCuelloBotella([met({ valor: 30, objetivo: 20 })])
  assert.equal(evaluarEscalado(sano, { utilizacionVentas: null, utilizacionEntrega: null }).veredicto, 'con_cautela')
  assert.equal(evaluarEscalado(sano, { utilizacionVentas: 20, utilizacionEntrega: null }).veredicto, 'con_cautela')
  assert.match(evaluarEscalado(sano, capacidad(null)).motivos.join(' '), /falta el dato de capacidad/i)
})

test('todo en objetivo y con capacidad libre sí es luz verde', () => {
  const sano = diagnosticarCuelloBotella([met({ valor: 30, objetivo: 20 })])
  const r = evaluarEscalado(sano, capacidad(35, 40))
  assert.equal(r.veredicto, 'listo')
  assert.match(r.motivos.join(' '), /capacidad libre/i)
})

test('una restricción crítica fuera de la economía frena con cautela, no del todo', () => {
  const d = diagnosticarCuelloBotella([
    met({ key: 'show_rate', nombre: 'Show rate', nivel: 'oportunidades', valor: 30, objetivo: 65, muestra: 200 }),
  ])
  assert.equal(evaluarEscalado(d, capacidad(30)).veredicto, 'con_cautela')
})

// Una crítica con muestra de tres NO frena la inversión: sería dejar de escalar por ruido.
test('una crítica con muestra baja no basta para frenar el escalado', () => {
  const d = diagnosticarCuelloBotella([met({ nivel: 'oportunidades', valor: 1, objetivo: 20, muestra: 3 })])
  const r = evaluarEscalado(d, capacidad(30))
  assert.notEqual(r.veredicto, 'esperar')
  assert.notEqual(r.veredicto, 'arreglar_antes')
})

// La caja cuenta como economía para esta decisión: escalar sin caja es quedarse sin caja más rápido.
test('la caja críticamente rota también obliga a arreglar antes', () => {
  const d = diagnosticarCuelloBotella([
    met({ key: 'cash_roas', nombre: 'Cash ROAS', nivel: 'caja', valor: 0.4, objetivo: 2, muestra: 200 }),
  ])
  assert.equal(evaluarEscalado(d, capacidad(20)).veredicto, 'arreglar_antes')
})

test('el veredicto siempre viene con al menos un motivo', () => {
  const sano = diagnosticarCuelloBotella([met({ valor: 30, objetivo: 20 })])
  for (const cap of [
    capacidad(95),
    capacidad(30),
    capacidad(null),
    { utilizacionVentas: 75, utilizacionEntrega: 40 },
  ]) {
    assert.ok(evaluarEscalado(sano, cap).motivos.length >= 1)
  }
})
