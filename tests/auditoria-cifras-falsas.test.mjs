import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { ANCHO_LEGIBLE, anchos } from '../lib/funnels/geometria.ts'

// TRES BUGS DE LA AUDITORÍA DE DASHBOARDS QUE HACÍAN MENTIR A LA PANTALLA.
//
// Los tres comparten forma: no rompen nada visible: enseñan un número o un dibujo equivocado, que
// es peor que un error. F24 (embudo ilegible), F25 (consulta con 400) y F17 (atribución que no
// puede reconocerse).

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

const etapa = (id, value, status = 'ok') => ({
  stage: { id, label: id },
  count: { value, status, source: 'crm' },
})

// ── F24: EL EMBUDO SE VOLVÍA ILEGIBLE SI LA PRIMERA ETAPA VALÍA CERO ─────────────────────────

test('con la cima a cero, las etapas que sí tienen datos siguen dibujándose', () => {
  // El caso real: sin impresiones registradas, pero con gente en las etapas de CRM. Antes TODAS
  // las barras salían al 1 % —cápsulas con el texto recortado— incluidas las que tenían datos.
  const ws = anchos([
    etapa('impresiones', 0),
    etapa('visitas', 0),
    etapa('leads', 120),
    etapa('citas', 50),
    etapa('ventas', 20),
  ])
  assert.equal(ws[2], 100, 'la etapa mayor marca el 100 %')
  assert.ok(ws[3] > 40 && ws[3] < 45, `citas debería rondar el 41 %, dio ${ws[3]}`)
  assert.ok(
    ws.every((w) => w >= 6),
    'ninguna barra puede quedar por debajo del suelo legible'
  )
})

test('una etapa sin dato no se dibuja como un cero ni como una raya', () => {
  const ws = anchos([etapa('impresiones', null, 'error_fuente'), etapa('leads', 100)])
  assert.ok(ws[0] >= 6, 'la barra rayada tiene que seguir viéndose')
  assert.equal(ws[1], 100)
})

test('todo a cero da barras iguales y legibles, no un embudo falso', () => {
  const ws = anchos([etapa('a', 0), etapa('b', 0)])
  assert.deepEqual(ws, [ws[0], ws[0]])
  assert.ok(ws[0] >= 6)
})

test('una barra estrecha saca su etiqueta fuera en vez de recortarla', () => {
  // La barra usa overflow-hidden y el texto vivía dentro: por debajo de cierto ancho desaparecía.
  const ws = anchos([etapa('leads', 1000), etapa('ventas', 20)])
  assert.ok(ws[1] < ANCHO_LEGIBLE, 'el 2 % está por debajo del umbral de legibilidad')
  const componente = leer('components/os/FunnelChart.tsx')
  assert.match(componente, /const estrecha = ws\[i\] < ANCHO_LEGIBLE/)
  assert.match(componente, /\{estrecha \? \(/, 'la etiqueta tiene que pintarse debajo cuando no cabe')
})

// ── F25: LA CONSULTA DE SESIONES DE VSL DEVOLVÍA 400 ─────────────────────────────────────────

test('el filtro de no-nulo va en el valor, no en el nombre de la columna', () => {
  // `not.lead_email=is.null` le pide a PostgREST una columna llamada "not.lead_email". La forma
  // correcta es `lead_email=not.is.null`. La etapa de registros enseñaba "HTTP 400".
  const src = leer('lib/funnels/queries.ts')
  assert.match(src, /searchParams\.append\(extra\.column, 'not\.is\.null'\)/)
  assert.ok(!/'not\.' \+ /.test(src), 'quedaría el operador pegado al nombre de la columna')
})

test('el 400 sigue distinguiéndose de un cero y de una tabla que no existe', () => {
  // Arreglar la consulta no puede llevarse por delante la distinción entre "falló" y "no hay".
  const src = leer('lib/funnels/queries.ts')
  assert.match(src, /errorFuente\('vsl', `vsl_sessions: HTTP \$\{res\.status\}`\)/)
  assert.match(src, /noConfigurada\('vsl'/)
})

// ── F17: DATA HEALTH NO PODÍA RECONOCER NINGUNA CAMPAÑA ATRIBUIDA ───────────────────────────

test('la campaña se compara por un nombre que sí se ha pedido a la base', () => {
  // Seleccionaba `id,synced_at` y comparaba `c.name`: undefined contra los utm_campaign reales, así
  // que NINGUNA campaña podía salir atribuida y el control inventaba huecos.
  const src = leer('app/api/[tenant]/evergreen/settings/data-health/route.ts')
  const seleccion = src.match(/\.select\('id,name,synced_at'\)/)
  assert.ok(seleccion, 'falta `name` en la consulta de campañas')
  assert.ok(src.indexOf(".select('id,name,synced_at')") < src.indexOf('conAtribucion'), 'se compara lo que se pide')
})
