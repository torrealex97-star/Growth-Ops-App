import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// EL BUG REPORTADO: el admin no tenía forma de ver cómo quedaba un VSL (thumbnail, colores, CTA)
// antes de pegar el embed en una landing, y un vídeo podía guardarse sin haber terminado de subirse
// — su `source_url` queda NULL en la BD (ver supabase/migrations/20260910110000_...sql) y el embed
// público muestra literalmente "Este vídeo aún no tiene fuente configurada." sin que nadie en el
// admin supiera por qué. Estos tests fijan las dos correcciones: preview en vivo dentro del
// formulario (sin ensuciar analíticas reales) y aviso explícito cuando falta la fuente.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const limpiar = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const player = limpiar(read('components/vsl/VslPlayer.tsx'))
const dash = limpiar(read('components/vsl/VslDashboard.tsx'))

test('VslPlayer acepta un modo preview que nunca crea sesión de tracking', () => {
  assert.match(player, /preview\??:\s*boolean/, 'el prop preview existe y es opcional')
  // La creación de sesión (fetch a /api/vsl/session) tiene que estar condicionada a !preview.
  const idxFetch = player.indexOf("fetch('/api/vsl/session'")
  assert.ok(idxFetch > -1, 'sigue existiendo la creación de sesión')
  const antes = player.slice(Math.max(0, idxFetch - 200), idxFetch)
  assert.match(antes, /if\s*\(!preview\)\s*\{/, 'la creación de sesión queda dentro de un if (!preview)')
})

test('el modo preview no escribe ni borra la posición real de "continuar viendo" del slug', () => {
  assert.match(player, /if \(preview\) return/, 'el efecto de leer la posición guardada corta en preview')
  assert.match(player, /if \(!preview\) savePos\(/, 'guardar posición está condicionado a !preview')
  assert.match(player, /if \(!preview\) clearPos\(/, 'borrar posición al terminar está condicionado a !preview')
})

test('el modo preview no contamina la prueba social "real" (viendo ahora)', () => {
  const idxReal = player.indexOf("if (mode === 'real')")
  assert.ok(idxReal > -1)
  const bloque = player.slice(idxReal, idxReal + 200)
  assert.match(bloque, /if \(preview\) return/, 'el polling de "viendo ahora" real corta en preview')
})

test('el formulario de VSL renderiza una vista previa en vivo con VslPlayer en modo preview', () => {
  assert.match(dash, /import \{ VslPlayer \}/, 'VslDashboard importa VslPlayer')
  const idxPreview = dash.indexOf('<VslPlayer')
  assert.ok(idxPreview > -1, 'se monta un VslPlayer dentro del formulario')
  const bloque = dash.slice(idxPreview, idxPreview + 120)
  assert.match(bloque, /preview/, 'el VslPlayer del formulario se monta en modo preview')
})

test('sin fuente, el listado y la tarjeta de embed avisan en vez de dejarlo en silencio', () => {
  assert.match(dash, /!video\.source_url/, 'las tarjetas del listado comprueban si falta la fuente')
  assert.match(dash, /Sin fuente/, 'hay una etiqueta visible de aviso en el listado')
  assert.match(dash, /Sube o conecta una fuente/, 'la tarjeta de embed explica por qué el código no va a funcionar')
  // El botón de copiar el snippet se deshabilita si el vídeo seleccionado no tiene fuente: copiar un
  // embed roto sin avisar es justo el bug reportado.
  const idxCopy = dash.indexOf('onClick={copySnippet}')
  assert.ok(idxCopy > -1)
  const bloque = dash.slice(idxCopy, idxCopy + 150)
  assert.match(
    bloque,
    /disabled=\{!selectedVideo\.source_url\}/,
    'el botón de copiar comprueba la fuente antes de habilitarse'
  )
})

test('guardar sin ninguna fuente de vídeo pide confirmación explícita en vez de guardarse en silencio', () => {
  const idxSave = dash.indexOf('const save = async')
  assert.ok(idxSave > -1)
  const bloque = dash.slice(idxSave, idxSave + 600)
  assert.match(bloque, /sourceUrl\.trim\(\)/, 'comprueba si hay fuente antes de guardar')
  assert.match(bloque, /confirm\(/, 'pide confirmación si no hay fuente')
})
