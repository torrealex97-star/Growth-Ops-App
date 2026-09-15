import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calcularSalud,
  calcularSubscore,
  MINIMO_DIMENSIONES,
  PESO_DIMENSION,
  puntuarRatio,
} from '../../lib/metrics/salud.ts'

const met = (over) => ({
  key: 'm',
  nombre: 'M',
  nivel: 'ventas',
  valor: 10,
  objetivo: 10,
  higherIsBetter: true,
  muestra: 200,
  investigar: [],
  ...over,
})

// ---------------------------------------------------------------------------------------------
// LA ESCALA. Tiene que ser explicable en una frase, porque alguien va a discutir la nota.
// ---------------------------------------------------------------------------------------------

test('la escala arranca en la mitad del objetivo, llega a 100 en el objetivo y no lo pasa', () => {
  assert.equal(puntuarRatio(1), 100)
  assert.equal(puntuarRatio(0.75), 50)
  assert.equal(puntuarRatio(0.5), 0)
  assert.equal(puntuarRatio(0.1), 0, 'por debajo del suelo no hay decimales con significado')
  assert.equal(puntuarRatio(3), 100, 'triplicar el objetivo no compensa otra dimensión rota')
})

// ---------------------------------------------------------------------------------------------
// REGLA 1: FALTA DE DATO NO ES UN CERO. Es la que convierte un negocio sano en una alarma roja.
// ---------------------------------------------------------------------------------------------

test('una métrica sin dato no puntúa cero: no puntúa', () => {
  const s = calcularSubscore('ventas', [met({ key: 'medida' }), met({ key: 'sin_dato', valor: null })])
  assert.equal(s.puntuacion, 100, 'el hueco no puede arrastrar la nota hacia abajo')
  assert.equal(s.componentes.find((c) => c.key === 'sin_dato').puntos, null)
  assert.equal(s.cobertura, 0.5)
  assert.match(s.componentes.find((c) => c.key === 'sin_dato').explicacion, /no cuenta como cero/i)
})

test('una dimensión sin ninguna métrica medida vale null, no cero', () => {
  const s = calcularSubscore('producto', [met({ valor: null }), met({ key: 'b', objetivo: null })])
  assert.equal(s.puntuacion, null)
  assert.equal(s.cobertura, 0)
  assert.equal(s.fiabilidad, 'baja')
})

test('sin objetivo tampoco se puntúa, y se dice que es eso', () => {
  const c = calcularSubscore('ventas', [met({ objetivo: null })]).componentes[0]
  assert.equal(c.puntos, null)
  assert.match(c.explicacion, /sin objetivo/i)
})

// ---------------------------------------------------------------------------------------------
// LAS MÉTRICAS DE COSTE VAN AL REVÉS. La mitad del panel son costes; invertir el sentido convierte
// un CAC excelente en una dimensión roja.
// ---------------------------------------------------------------------------------------------

test('en una métrica de coste gastar menos del techo puntúa alto', () => {
  const barato = calcularSubscore('adquisicion', [
    met({ key: 'cac', higherIsBetter: false, valor: 250, objetivo: 500 }),
  ])
  assert.equal(barato.puntuacion, 100)
  const caro = calcularSubscore('adquisicion', [met({ key: 'cac', higherIsBetter: false, valor: 1000, objetivo: 500 })])
  assert.equal(caro.puntuacion, 0)
  const justo = calcularSubscore('adquisicion', [met({ key: 'cac', higherIsBetter: false, valor: 500, objetivo: 500 })])
  assert.equal(justo.puntuacion, 100)
})

test('un coste de cero no divide por cero ni rompe la nota', () => {
  const s = calcularSubscore('adquisicion', [met({ higherIsBetter: false, valor: 0, objetivo: 500 })])
  assert.equal(s.puntuacion, 100)
})

test('un objetivo de cero no produce Infinity ni NaN', () => {
  for (const m of [met({ objetivo: 0 }), met({ higherIsBetter: false, valor: 10, objetivo: 0 })]) {
    const s = calcularSubscore('ventas', [m])
    assert.equal(s.puntuacion, null)
  }
})

// ---------------------------------------------------------------------------------------------
// REGLA 2: EL PESO SE RENORMALIZA Y LA COBERTURA SE DECLARA.
// ---------------------------------------------------------------------------------------------

test('el peso se renormaliza sobre lo medido, no se rellena con ceros', () => {
  // Financiera perfecta y ventas a cero, y nada más medido: la nota es la media ponderada de LAS DOS,
  // no de las cinco dimensiones con tres ceros dentro.
  const s = calcularSalud({
    financiera: [met({ valor: 10, objetivo: 10 })],
    ventas: [met({ valor: 5, objetivo: 10 })],
  })
  const esperado = Math.round(
    (100 * PESO_DIMENSION.financiera + 0 * PESO_DIMENSION.ventas) / (PESO_DIMENSION.financiera + PESO_DIMENSION.ventas)
  )
  assert.equal(s.puntuacion, esperado)
  assert.ok(s.puntuacion > 40, 'con ceros de relleno esto habría salido catastrófico')
})

test('la cobertura de peso se declara y va en el titular', () => {
  const s = calcularSalud({ financiera: [met()], ventas: [met()] })
  const cobertura = PESO_DIMENSION.financiera + PESO_DIMENSION.ventas
  assert.ok(Math.abs(s.coberturaPeso - cobertura) < 1e-9)
  assert.match(s.titular, new RegExp(`${Math.round(cobertura * 100)}%`))
})

test('con una sola dimensión medida no se da nota global: eso no es la salud del negocio', () => {
  assert.equal(MINIMO_DIMENSIONES, 2)
  const s = calcularSalud({ ventas: [met()], producto: [met({ valor: null })] })
  assert.equal(s.puntuacion, null)
  assert.equal(s.etiqueta, 'sin_datos')
  assert.deepEqual(s.sinDatos, ['producto'])
  assert.match(s.titular, /faltan datos/i)
})

test('sin ninguna dimensión no lanza y no inventa una nota', () => {
  const s = calcularSalud({})
  assert.equal(s.puntuacion, null)
  assert.deepEqual(s.subscores, [])
  assert.equal(s.peor, null)
})

// ---------------------------------------------------------------------------------------------
// AUDITABILIDAD: el requisito era que la nota se pueda descomponer. Si esto cae, vuelve a ser un
// número opaco que nadie puede discutir.
// ---------------------------------------------------------------------------------------------

test('cada subscore arrastra sus componentes con actual, objetivo, puntos y explicación', () => {
  const s = calcularSalud({
    ventas: [met({ key: 'close_rate', nombre: 'Close rate', valor: 17.5, objetivo: 25 })],
    financiera: [met({ key: 'ltgp_cac', nombre: 'LTGP:CAC', valor: 3, objetivo: 3 })],
  })
  for (const sub of s.subscores) {
    assert.ok(sub.componentes.length > 0)
    for (const c of sub.componentes) {
      assert.ok(c.nombre && c.explicacion.length > 10)
      assert.ok('actual' in c && 'objetivo' in c && 'puntos' in c && 'muestra' in c)
    }
  }
  // Y la explicación contiene los números reales, no una frase genérica.
  const close = s.subscores.find((x) => x.dimension === 'ventas').componentes[0]
  assert.match(close.explicacion, /17\.5/)
  assert.match(close.explicacion, /25/)
  assert.match(close.explicacion, /70%/, 'el % del objetivo cumplido tiene que quedar dicho')
})

test('la nota global es reproducible a mano desde los subscores publicados', () => {
  const s = calcularSalud({
    financiera: [met({ valor: 9, objetivo: 10 })],
    ventas: [met({ valor: 8, objetivo: 10 })],
    adquisicion: [met({ valor: 7, objetivo: 10 })],
  })
  const medidos = s.subscores.filter((x) => x.puntuacion !== null)
  const peso = medidos.reduce((a, x) => a + x.peso, 0)
  const aMano = Math.round(medidos.reduce((a, x) => a + x.puntuacion * x.peso, 0) / peso)
  assert.equal(s.puntuacion, aMano)
})

test('la peor dimensión medida se señala, y una sin datos nunca es la peor', () => {
  const s = calcularSalud({
    financiera: [met({ valor: 10, objetivo: 10 })],
    ventas: [met({ valor: 6, objetivo: 10 })],
    capacidad: [met({ valor: null })],
  })
  assert.equal(s.peor, 'ventas')
  assert.deepEqual(s.sinDatos, ['capacidad'])
  assert.match(s.titular, /Ventas/)
})

// ---------------------------------------------------------------------------------------------
// LAS ETIQUETAS Y LA FIABILIDAD.
// ---------------------------------------------------------------------------------------------

test('las etiquetas siguen los cortes declarados', () => {
  const con = (puntos) =>
    calcularSalud({
      financiera: [met({ valor: puntos, objetivo: 100 })],
      ventas: [met({ valor: puntos, objetivo: 100 })],
    })
  assert.equal(con(100).etiqueta, 'saludable')
  assert.equal(con(85).etiqueta, 'aceptable') // 85% del objetivo → 70/100
  assert.equal(con(75).etiqueta, 'en_riesgo') // → 50/100
  assert.equal(con(65).etiqueta, 'critico') // → 30/100
})

test('la fiabilidad baja cuando la muestra es corta, aunque la nota sea perfecta', () => {
  const s = calcularSalud({
    financiera: [met({ valor: 10, objetivo: 10, muestra: 4 })],
    ventas: [met({ valor: 10, objetivo: 10, muestra: 4 })],
  })
  assert.equal(s.puntuacion, 100)
  assert.equal(s.fiabilidad, 'baja', 'un 100 sobre cuatro observaciones no es un 100 fiable')
})

test('con cobertura y muestra amplias la fiabilidad sube a alta', () => {
  const todas = ['financiera', 'ventas', 'adquisicion', 'producto', 'capacidad']
  const s = calcularSalud(Object.fromEntries(todas.map((d) => [d, [met({ muestra: 500 })]])))
  assert.equal(s.fiabilidad, 'alta')
  assert.equal(s.coberturaPeso, 1)
})

test('la nota nunca sale de 0-100 ni con datos absurdos', () => {
  const s = calcularSalud({
    financiera: [met({ valor: 1e6, objetivo: 1 })],
    ventas: [met({ valor: -50, objetivo: 10 })],
  })
  assert.ok(s.puntuacion >= 0 && s.puntuacion <= 100)
  assert.ok(Number.isInteger(s.puntuacion))
})
