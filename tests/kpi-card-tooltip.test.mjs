import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const TOOLTIP = 'components/metrics/MetricTooltip.tsx'
const CARD = 'components/metrics/KpiCard.tsx'
const sinComentarios = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// ---------------------------------------------------------------------------------------------
// EL TOOLTIP — 2 segundos de espera, y la misma explicación accesible en móvil.
// ---------------------------------------------------------------------------------------------

// Un tooltip inmediato convierte el barrido del ratón por doce tarjetas en recuadros saltando por la
// pantalla. El retardo hace que solo aparezca cuando alguien se ha parado a mirar.
test('el tooltip espera 2 segundos y el retardo vive en un solo sitio', () => {
  const src = read(TOOLTIP)
  assert.match(src, /export const RETARDO_TOOLTIP_MS = 2000/)
  assert.match(sinComentarios(src), /setTimeout\(\(\) => setAbierto\(true\), RETARDO_TOOLTIP_MS\)/)
})

// Salir con el ratón tiene que CANCELAR la espera pendiente: si no, pasar por encima y seguir de largo
// haría aparecer el recuadro dos segundos después, ya sin el ratón ahí.
test('salir cancela la espera pendiente, no solo cierra', () => {
  const src = sinComentarios(read(TOOLTIP))
  assert.match(src, /const alSalir = \(\) => \{\s*cancelar\(\)\s*setAbierto\(false\)/)
  assert.match(src, /onMouseLeave=\{alSalir\}/)
})

// Sin esto, salir de la pantalla con el ratón encima deja un setTimeout apuntando a un componente que
// ya no existe.
test('el temporizador se limpia al desmontar', () => {
  assert.match(sinComentarios(read(TOOLTIP)), /useEffect\(\(\) => \(\) =>[\s\S]{0,80}clearTimeout/)
})

// En móvil NO hay hover, así que el icono tiene que abrir la MISMA explicación. No es una versión
// reducida: quien usa el panel desde el móvil necesita entender los números igual.
test('en móvil la misma explicación se abre pulsando el icono', () => {
  const src = sinComentarios(read(TOOLTIP))
  assert.match(src, /<button/)
  assert.match(src, /onClick=\{\(e\) => \{[\s\S]{0,140}setAbierto\(\(v\) => !v\)/)
  // Y el área táctil no puede ser el icono de 14px a secas.
  assert.match(src, /h-6 w-6/)
})

test('el tooltip es accesible por teclado y anunciado por lectores', () => {
  const src = sinComentarios(read(TOOLTIP))
  assert.match(src, /role="tooltip"/)
  assert.match(src, /aria-expanded=\{abierto\}/)
  assert.match(src, /aria-describedby=/)
  assert.match(src, /aria-label=\{`Qué significa/)
  assert.match(src, /onFocus=/)
})

// Los cinco bloques que pide el diseño, con el objetivo solo si existe.
test('el tooltip lleva qué es, fórmula, por qué importa y fuente', () => {
  const src = read(TOOLTIP)
  for (const titulo of ['Qué es', 'Fórmula', 'Por qué importa', 'Fuente']) {
    assert.match(src, new RegExp(`titulo="${titulo}"`), titulo)
  }
})

// Un "Objetivo: —" invita a pensar que falta configurar algo, cuando puede ser que esa métrica no deba
// tener objetivo. Y decir "fiabilidad: alta" en las doce tarjetas es ruido.
test('el objetivo y la fiabilidad solo se muestran cuando aportan', () => {
  const src = sinComentarios(read(TOOLTIP))
  assert.match(src, /contenido\.objetivo \? <Bloque titulo="Objetivo">/)
  assert.match(src, /contenido\.fiabilidad !== 'alta'/)
})

// ---------------------------------------------------------------------------------------------
// LA TARJETA — y las dos cosas que NO hace.
// ---------------------------------------------------------------------------------------------

// El semáforo se lo dan calculado. Si lo decidiera aquí, dos pantallas con la misma métrica podrían
// pintarla distinto.
test('la tarjeta no decide el semáforo: lo recibe ya calculado', () => {
  const src = sinComentarios(read(CARD))
  assert.match(src, /COLOR_ESTADO\[metrica\.status\]/)
  // No reimplementa la comparación con el objetivo.
  assert.doesNotMatch(src, /calcularEstado\(/)
  assert.doesNotMatch(src, /metrica\.value >= metrica\.target/)
})

// LA DECISIÓN IMPORTANTE: sin dato se dice QUÉ FALTA, no se pinta un cero. Un 0% de Pitch Rate dice
// que el equipo no presenta ofertas; "sin medir" dice que nadie lo registra todavía.
test('sin dato la tarjeta escribe qué falta, nunca un cero', () => {
  const src = read(CARD)
  assert.match(src, /ETIQUETA_DATO\[metrica\.estadoDato\]/)
  for (const etiqueta of ['Sin datos', 'Fuente no conectada', 'Sin medir todavía', 'Datos parciales']) {
    assert.ok(src.includes(etiqueta), etiqueta)
  }
  // El valor solo se pinta cuando hay dato de verdad.
  assert.match(sinComentarios(src), /const hayDato = metrica\.value !== null && metrica\.estadoDato === 'ok'/)
})

// LA FLECHA SIGUE AL NÚMERO Y EL COLOR SIGUE AL NEGOCIO. Un CAC que baja lleva flecha hacia abajo y
// color verde. Atarlos entre sí es el error clásico de estos paneles.
test('el color de la variación sale de esMejora, no del signo', () => {
  const src = sinComentarios(read(CARD))
  assert.match(src, /const mejora = esMejora\(metrica\.higherIsBetter, metrica\.absoluteChange\)/)
  assert.match(src, /mejora === true && 'text-emerald-500'/)
  assert.match(src, /mejora === false && 'text-red-500'/)
  // Y la flecha sí va por el signo del cambio.
  assert.match(src, /metrica\.absoluteChange > 0 \? \(\s*<ArrowUp/)
})

// Un "0%" inventado por falta de periodo anterior diría que el negocio está plano.
test('la variación solo se pinta si hay con qué comparar', () => {
  assert.match(sinComentarios(read(CARD)), /hayDato && metrica\.absoluteChange !== null \?/)
})

// Pasar de 0 a 3 no da porcentaje: se cae al cambio absoluto, que es lo legible ahí.
test('sin porcentaje calculable se muestra el cambio absoluto', () => {
  assert.match(sinComentarios(read(CARD)), /metrica\.percentageChange !== null\s*\?[\s\S]{0,200}: formatearValor\(/)
})

// Sobriedad: un punto de color, no un fondo teñido. Con doce tarjetas, los fondos de color convierten
// el panel en un semáforo roto.
test('el estado es un punto de color, sin fondos teñidos ni degradados', () => {
  const src = read(CARD)
  assert.match(src, /h-2 w-2 shrink-0 rounded-full/)
  assert.doesNotMatch(src, /bg-gradient|shadow-\[0 0|drop-shadow|blur-/)
})

// Cada unidad se formatea como toca. Un ratio pintado como euros o un porcentaje sin el símbolo es
// como se malinterpreta un panel.
test('el valor se formatea según la unidad declarada', () => {
  const src = read(CARD)
  for (const unidad of ["'eur'", "'porcentaje'", "'ratio'", "'minutos'", "'dias'"]) {
    assert.ok(src.includes(`case ${unidad}:`), unidad)
  }
  assert.match(src, /if \(valor === null \|\| !Number\.isFinite\(valor\)\) return '—'/)
})

// Sin poder ver los registros que componen un número, nadie se fía de él.
test('la tarjeta permite abrir el detalle de los registros', () => {
  assert.match(read(CARD), /onDrilldown/)
  assert.match(read(CARD), /Ver los registros/)
})

// Respeta el design system en vez de traerse estilos propios.
test('la tarjeta usa los tokens del proyecto', () => {
  const src = read(CARD)
  assert.match(src, /border-border/)
  assert.match(src, /bg-card/)
  assert.match(src, /text-muted-foreground/)
  assert.match(src, /from '@\/lib\/utils'/)
})
