import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const donut = read('../../components/os/ShareDonut.tsx')
const trend = read('../../components/os/TrendChart.tsx')
const css = read('../../app/globals.css')

test('la paleta categórica está en tokens y NO se cicla', () => {
  // Los seis tonos pasan los seis checks del validador (banda de luminosidad, croma, separación para
  // daltonismo, suelo de visión normal y contraste) en claro Y en oscuro. Medidos, no elegidos a ojo.
  for (let i = 1; i <= 6; i++) assert.match(css, new RegExp(`--serie-${i}:`), `falta el token --serie-${i}`)
  // Definidos también para modo oscuro: no es un volteo automático.
  const oscuro = css.slice(css.lastIndexOf('.dark {'))
  assert.match(oscuro, /--serie-1:/)
  // El color identifica a la categoría: con más de seis, el resto va a "Otros" en vez de generar un
  // séptimo tono que dejaría de estar validado.
  assert.match(donut, /label: 'Otros'/)
  assert.match(donut, /positivas\.length <= maxSlices/)
})

test('el donut responde la pregunta en el centro y nunca depende solo del color', () => {
  // El total en el agujero: es el dato que se busca primero.
  assert.match(donut, /resaltada \? resaltada\.value : total/)
  // Leyenda siempre, con valor y porcentaje.
  assert.match(donut, /<ul className=/)
  assert.match(donut, /\{a\.pct < 10 \? a\.pct\.toFixed\(1\) : Math\.round\(a\.pct\)\}%/)
  // Hueco de separación entre porciones, para que los bloques no se peguen.
  assert.match(donut, /fraccion \* CIRCUNFERENCIA - 1\.5/)
  // Sin datos se dice; no se pinta un pastel vacío.
  assert.match(donut, /Sin datos en el periodo seleccionado/)
})

test('la tendencia usa UN eje y no interpola los huecos', () => {
  // Un doble eje deja que la forma de las curvas la decida la escala elegida, y con ella la
  // conclusión: dos métricas de escala distinta van en dos gráficas.
  assert.equal((trend.match(/<YAxis/g) ?? []).length, 1, 'nunca dos ejes Y')
  // HUECO ≠ CERO: un día sin dato parte la línea en vez de fingir una caída a 0.
  assert.match(trend, /connectNulls=\{false\}/)
  // Una sola serie: sin leyenda y sin un número sobre cada punto.
  assert.match(trend, /dot=\{false\}/)
  assert.ok(!/<Legend/.test(trend), 'una sola serie no lleva leyenda')
})

test('la variación se compara contra el periodo anterior y no inventa porcentajes', () => {
  // De 0 a 5 no es "+500 %": es que antes no había base con la que comparar.
  assert.match(trend, /anterior != null && anterior !== 0/)
  assert.match(trend, /sin periodo anterior con el que comparar/)
  // Con muy pocos puntos no se parte la serie para inventar un periodo previo.
  assert.match(trend, /conDato\.length < 4/)
})

test('las dos gráficas usan el color de marca de la subcuenta', () => {
  assert.match(trend, /hsl\(var\(--primary\)\)/)
  assert.match(donut, /hsl\(var\(--serie-\$\{i\}\)\)/)
  for (const c of [donut, trend]) assert.ok(!/#[0-9a-fA-F]{6}/.test(c), 'sin colores hardcodeados')
})

test('están cableadas en Gastos, con el reparto y el histórico del periodo activo', () => {
  const page = read('../../app/[tenant]/finanzas/gastos-facturas/gastos/page.tsx')
  assert.match(page, /<TrendChart/)
  assert.match(page, /<ShareDonut/)
  // Derivan del MISMO conjunto filtrado por el periodo que el resto de la pantalla.
  assert.match(page, /const gastoPorCategoria = useMemo\(\(\) => \{[\s\S]{0,400}monthItems/)
  assert.match(page, /const serieDiaria = useMemo\(\(\) => \{[\s\S]{0,400}monthItems/)
  // Un día sin gasto va a null, no a 0.
  assert.match(page, /value: porDia\.get\(date\) \?\? null/)
})
