import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const PANEL = 'components/metrics/PanelGrowth.tsx'
const PAGINA = 'app/[tenant]/analitica/page.tsx'

// ---------------------------------------------------------------------------------------------
// NI UN NÚMERO SE RECALCULA EN LA PANTALLA. Si esta vista hiciera su propia aritmética, el panel y el
// agente podrían decir cosas distintas del mismo negocio, y entonces no se cree a ninguno de los dos.
// ---------------------------------------------------------------------------------------------

test('el panel solo pinta lo que le da la ruta', () => {
  const codigo = sinComentarios(leer(PANEL))
  assert.match(codigo, /pedir<Respuesta>\(/)
  assert.match(codigo, /metricas\/brief/)
  // Nada de calcular ratios, porcentajes o diagnósticos aquí.
  assert.doesNotMatch(codigo, /diagnosticarCuelloBotella|calcularSalud|calcularAgregados/)
})

test('la restricción va primero, antes de las tarjetas', () => {
  const codigo = sinComentarios(leer(PANEL))
  const restriccion = codigo.indexOf('Restricción actual')
  const tarjetas = codigo.indexOf('<KpiCard')
  assert.ok(restriccion > -1 && restriccion < tarjetas, 'un panel que abre con veinte tarjetas no dirige a nada')
})

// ---------------------------------------------------------------------------------------------
// LA PANTALLA NO PUEDE COLGARSE: es la misma lección del layout.
// ---------------------------------------------------------------------------------------------

test('la carga tiene finally y cancelación al desmontar', () => {
  const codigo = sinComentarios(leer(PANEL))
  assert.match(codigo, /\} finally \{\s*setCargando\(false\)/)
  assert.match(codigo, /new AbortController\(\)/)
  assert.match(codigo, /return \(\) => ac\.abort\(\)/)
})

test('distingue sin permiso de error y ofrece reintento solo si sirve', () => {
  const codigo = sinComentarios(leer(PANEL))
  assert.match(codigo, /fallo\.tipo === 'permiso' \? 'sin_permiso' : 'error'/)
  assert.match(codigo, /fallo\.reintentable \?/)
  // Una cancelación por navegar no se enseña como error.
  assert.match(codigo, /if \(esFalloVisible\(res\)\) setFallo\(res\)/)
})

// ---------------------------------------------------------------------------------------------
// NO SE INVENTAN NÚMEROS, Y LOS HUECOS SE DICEN.
// ---------------------------------------------------------------------------------------------

test('el impacto se marca como estimación y no se rellena si no se pudo calcular', () => {
  const codigo = leer(PANEL)
  assert.match(codigo, /brief\.impacto\.texto/)
  assert.match(codigo, /Es una estimación, no un compromiso/)
})

test('los huecos se presentan como falta de medición, no como problema del negocio', () => {
  assert.match(leer(PANEL), /hueco de medición, no un problema del negocio/)
})

test('la salud enseña sus partes, su cobertura y su fiabilidad', () => {
  const codigo = leer(PANEL)
  assert.match(codigo, /salud\.subscores\.map/)
  assert.match(codigo, /Math\.round\(s\.cobertura \* 100\)/)
  assert.match(codigo, /fiabilidad \{s\.fiabilidad\}/)
  // Y sin nota, se dice "s/d" en vez de un 0.
  assert.match(codigo, /'s\/d'/)
})

test('se dice cuántas métricas tienen datos, para que la pantalla no parezca averiada', () => {
  const codigo = leer(PANEL)
  assert.match(codigo, /cobertura\.medidas\} de \{cobertura\.total\} con datos/)
})

// "Ver cálculo" es lo que hace que alguien se fíe de una cifra que no cuadra con su hoja de cálculo.
test('cada tarjeta puede abrir de dónde sale su número', () => {
  const codigo = sinComentarios(leer(PANEL))
  assert.match(codigo, /onDrilldown=\{\(\) => setVerCalculo\(m\.key\)\}/)
  assert.match(codigo, /Cómo se ha calculado/)
  assert.match(codigo, /filasLeidas/)
  assert.match(codigo, /muestra/)
})

// ---------------------------------------------------------------------------------------------
// LA PÁGINA. No es un dashboard paralelo: llena el índice de Analítica, que solo redirigía.
// ---------------------------------------------------------------------------------------------

test('el índice de Analítica ya no es una redirección vacía', () => {
  const codigo = sinComentarios(leer(PAGINA))
  assert.doesNotMatch(codigo, /router\.replace/)
  assert.match(codigo, /<PanelGrowth/)
})

test('los filtros de periodo son los mismos que en el resto de métricas', () => {
  const codigo = leer(PAGINA)
  for (const etiqueta of ['Hoy', '3 días', '7 días', 'Este mes', 'Trimestre', 'Año']) {
    assert.ok(codigo.includes(etiqueta), `falta el rango ${etiqueta}`)
  }
  // Accesible: el grupo se anuncia y el botón activo se declara.
  assert.match(codigo, /role="group"/)
  assert.match(codigo, /aria-pressed=\{rango === r\.id\}/)
})

test('el periodo se pasa a la ruta en vez de recalcularse en el panel', () => {
  assert.match(sinComentarios(leer(PAGINA)), /<PanelGrowth desde=\{desde\} hasta=\{hasta\} \/>/)
})
