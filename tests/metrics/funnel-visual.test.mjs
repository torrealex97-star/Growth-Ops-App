import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const chart = read('../../components/os/FunnelChart.tsx')
const css = read('../../app/globals.css')

test('es una gráfica, no seis tarjetas seguidas', () => {
  // §30: el ancho de cada barra codifica el volumen, así que la reducción entre etapas SE VE.
  assert.match(chart, /width: `\$\{ws\[i\]\}%`/)
  assert.match(chart, /function anchos/)
  // Centrada (mx-auto) para que el estrechamiento se lea como un embudo.
  assert.match(chart, /funnel-bar[^"]*mx-auto/)
})

test('el ancho es proporcional a la primera etapa, con suelo visible', () => {
  // La cima es el 100 %; una etapa con muy poco volumen sigue siendo visible y clicable en vez de
  // quedar en una línea de 0 px.
  assert.match(chart, /Math\.max\(6, \(\(s\.count\.value \?\? 0\) \/ primera\) \* 100\)/)
  assert.match(chart, /stages\.find\(\(s\) => isUsable\(s\.count\)\)/)
})

test('cada etapa muestra nombre, volumen, conversión y caída', () => {
  // §31, literal: nombre / volumen / % desde la anterior / cuántos se pierden.
  assert.match(chart, /s\.stage\.label/)
  assert.match(chart, /fmt\(s\.count\.value \?\? 0\)/)
  assert.match(chart, /desde la anterior/)
  assert.match(chart, /se caen/)
  assert.match(chart, /del total/)
})

test('UN HUECO NO ES UN CERO: una fuente caída no se pinta como 0', () => {
  // Es la regla de AGENTS.md y de lib/funnels/types.ts: pintar 0 convierte "la integración está
  // caída" en "esta campaña no convierte".
  assert.match(chart, /\{usable \? fmt\(s\.count\.value \?\? 0\) : '—'\}/)
  assert.match(chart, /s\.count\.error \|\| STATUS_LABELS\[s\.count\.status\]/)
  // Y la barra sin dato sale rayada, no vacía ni llena.
  assert.match(chart, /pattern id=\{rayadoId\}/)
})

test('distingue los cinco estados de pantalla del brief (§45)', () => {
  for (const estado of ['loading', 'not_connected', 'error']) {
    assert.ok(chart.includes(`'${estado}'`), `falta el estado ${estado}`)
  }
  // PARTIAL_DATA: se pinta el embudo, diciendo qué fuente falta.
  assert.match(chart, /result\.incomplete/)
  assert.match(chart, /failedSources, \.\.\.result\.unconfiguredSources/)
  // NO_DATA no se disfraza de cero silencioso.
  assert.match(chart, /Sin datos en el periodo seleccionado/)
})

test('el color sale del token de marca, no hardcodeado por subcuenta', () => {
  // app/[tenant]/layout.tsx reescribe --primary según data-accent, así que el mismo componente sale
  // rosa en WDC y azul en Evergreen sin una línea de color por subcuenta.
  assert.match(chart, /hsl\(var\(--primary\) \/ \$\{/)
  assert.ok(!/#[0-9a-fA-F]{6}/.test(chart), 'no debe haber colores hardcodeados')
  // Un solo tono (el ancho ya codifica la magnitud): ni arcoíris ni un hue por etapa.
  assert.equal((chart.match(/var\(--primary\)/g) ?? []).length, 1)
})

test('el texto usa tokens de texto, nunca el color de la serie', () => {
  assert.match(chart, /text-foreground relative truncate/)
  assert.match(chart, /text-muted-foreground/)
})

test('la animación es CSS, escalonada, y se desactiva si el usuario pide menos movimiento', () => {
  assert.match(css, /@keyframes funnel-bar-in/)
  assert.match(css, /animation-delay: calc\(var\(--fila, 0\) \* 60ms\)/)
  // Hace falta un bloque PROPIO: la regla global de prefers-reduced-motion pone la duración a
  // 0.001ms, pero NO anula `animation-delay`, así que sin esto la barra seguiría apareciendo con
  // hasta 300 ms de retardo para quien pidió no ver movimiento.
  assert.match(css, /\.funnel-chart \.funnel-bar \{\s*animation: none;\s*transition: none;\s*\}/)
  // Sin dependencias nuevas para animar. Se mira el IMPORT, no la mención: el componente explica en
  // un comentario por qué NO se añadió framer-motion, y eso no es usarla.
  const imports = chart.match(/^import .*$/gm) ?? []
  assert.ok(
    !imports.some((l) => /framer-motion|paper-design|'motion'/.test(l)),
    'no debe importar librerías de animación'
  )
})

test('no se instalaron librerías de animación ni de shaders', () => {
  const pkg = JSON.parse(read('../../package.json'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  // El brief pide UI premium y prohíbe explícitamente glows y gradientes de infografía (§43): un
  // fondo animado detrás de datos es ruido. Y AGENTS.md prohíbe dependencias sin necesidad real.
  for (const d of ['framer-motion', 'motion', '@paper-design/shaders-react']) {
    assert.ok(!deps[d], `${d} no debería estar instalada`)
  }
})

test('hay tabla equivalente y drilldown solo donde la etapa sabe a dónde ir', () => {
  assert.match(chart, /Ver como tabla/)
  assert.match(chart, /<table/)
  // §37: el drilldown se ofrece solo si la etapa declara destino y hay registros que abrir.
  assert.match(chart, /!!onStageClick && !!s\.stage\.drilldown && usable/)
})

test('es usable en móvil: nada con ancho mínimo mayor que la pantalla', () => {
  // §44: el embudo es vertical por naturaleza, así que apila bien; solo la tabla puede desbordar,
  // y lo hace dentro de su propio contenedor con scroll.
  assert.match(chart, /overflow-x-auto/)
  assert.ok(!/min-w-\[\d{3,}px\]/.test(chart), 'nada debe forzar un ancho mayor que un móvil')
  assert.match(chart, /flex-wrap/)
})

test('el embudo de Ads también es visual, no una lista de cifras', () => {
  const panel = read('../../components/os/AdsFunnelPanel.tsx')
  // Era `FunnelList`: siete filas de texto donde la caída entre etapas había que deducirla leyendo.
  // Ahora cada fila lleva su barra proporcional, con el MISMO lenguaje visual y el mismo CSS que
  // FunnelChart (una sola hoja de estilo para los dos embudos).
  assert.match(panel, /className="funnel-chart divide-border\/60 divide-y"/)
  assert.match(panel, /funnel-bar bg-primary\/15/)
  assert.match(panel, /width: `\$\{ancho\(s\.value\)\}%`/)
  assert.match(panel, /\['--fila' as string\]: String\(i\)/)
  // El número crudo viaja junto al formateado: sin él no se puede dibujar nada.
  assert.match(panel, /value: number \| null/)
  for (const campo of [
    'f.impresiones',
    'f.linkClicks',
    'f.visitas',
    'f.leads',
    'f.agendas',
    'f.llamadas',
    'f.cierres',
  ]) {
    assert.ok(panel.includes(`value: ${campo}`), `la etapa ${campo} no pasa su valor crudo`)
  }
})

test('los dos embudos comparten el suelo de visibilidad y el color de marca', () => {
  const panel = read('../../components/os/AdsFunnelPanel.tsx')
  // La misma regla en los dos: la cima es el 100 % y nadie baja del 6 %.
  assert.match(panel, /Math\.max\(6, \(v \/ cima\) \* 100\)/)
  assert.match(chart, /Math\.max\(6,/)
  // Color de marca por token, no hardcodeado (bg-primary/15 sale del accent del tenant).
  assert.ok(!/#[0-9a-fA-F]{6}/.test(panel.slice(panel.indexOf('function FunnelList'), panel.indexOf('const chartBox'))))
})

test('la pantalla de Funnels pinta el embudo visual, y la tabla queda como detalle', () => {
  const page = read('../../app/[tenant]/funnels/page.tsx')
  // Esto es lo que faltaba para que "los funnels se vieran": la capa de datos y la API existían,
  // pero la pantalla solo tenía una tabla.
  assert.match(page, /<FunnelChart result=\{data\} tabla=\{false\}/)
  assert.match(page, /from '@\/components\/os\/FunnelChart'/)
  // La gráfica va ANTES de la tabla.
  assert.ok(page.indexOf('<FunnelChart') < page.indexOf('<table'), 'la gráfica debe ir sobre la tabla')
  // Y la tabla sigue ahí: es el detalle (coste unitario, fuente, motivo de cada hueco).
  assert.match(page, /Coste unitario/)
  assert.match(page, /Estado y fuente/)
})

test('la pantalla usa los tipos canónicos del funnel, sin copia local', () => {
  const page = read('../../app/[tenant]/funnels/page.tsx')
  // Tenía su propio StageRow con `source: string` en vez del union de fuentes: una copia que se
  // desincroniza en silencio del módulo que calcula el funnel.
  assert.ok(!/type StageRow = \{/.test(page), 'no debe haber copia local de los tipos de etapa')
  assert.match(page, /type FunnelResponse = FunnelResult & \{ range/)
  assert.match(page, /import type \{ FunnelResult \} from '@\/lib\/funnels\/compute'/)
})
