import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')
const COMPONENTE = 'components/appointments/MarcadoRapido.tsx'
const PANEL = 'components/appointments/AppointmentDetail.tsx'
const RUTA = 'app/api/[tenant]/evergreen/appointments/update/route.ts'

// ---------------------------------------------------------------------------------------------
// El marcado tiene que cerrarse en segundos o no se rellena, y si no se rellena el Pitch Rate y el
// Close Rate se quedan en NOT_TRACKED para siempre.
// ---------------------------------------------------------------------------------------------

// Sin botón "Guardar": cada clic escribe. Un formulario con botón final significa que cerrar el panel
// por error pierde el trabajo y que hay que acordarse de pulsarlo — dos razones para dejar de marcar.
test('cada clic guarda, sin botón de guardar al final', () => {
  const src = read(COMPONENTE)
  assert.match(src, /onClick=\{\(\) =>\s*\n?\s*marcar\(/)
  assert.doesNotMatch(src, />\s*Guardar\s*</)
})

// La UI decide qué MOSTRAR; qué es válido lo decide el módulo de reglas, que es el que aplica también
// la ruta. Si la pantalla reimplementara las reglas, acabarían discrepando y el 422 saldría por
// sorpresa.
test('la UI no reimplementa las reglas: importa el vocabulario del módulo canónico', () => {
  const src = read(COMPONENTE)
  assert.match(src, /from '@\/lib\/agenda\/marcado'/)
  assert.match(src, /RESULTADOS/)
  assert.match(src, /RESULTADO_LABELS/)
  // Y no lleva su propia lista de resultados escrita a mano.
  assert.doesNotMatch(src, /const RESULTADOS\s*=/)
})

// `null` no es `false`. Un botón sin pulsar se pinta sin seleccionar, no como "No": la diferencia
// entre "no asistió" y "nadie lo ha marcado" es lo que separa un Show Rate real de uno inventado.
test('un valor sin marcar no se pinta como No', () => {
  const src = read(COMPONENTE)
  // La selección se compara contra true/false explícitos, nunca por veracidad del valor.
  assert.match(src, /valor === true/)
  assert.match(src, /valor === false/)
  assert.doesNotMatch(src, /aria-pressed=\{!!valor\}/)
})

// No se pregunta lo que no se puede deducir ni lo imposible: la oferta solo si hubo llamada, y el
// seguimiento solo en una llamada celebrada que no cerró (el denominador del BAMFAM).
test('la oferta solo se pregunta si asistió, y el seguimiento solo si no hubo venta', () => {
  const src = read(COMPONENTE)
  assert.match(src, /\{asistio === true && \(/)
  assert.match(src, /\{asistio === true && resultado !== 'venta' && \(/)
})

// El panel lo ve quien puede cambiar el estado de la cita: es la misma autoridad sobre el mismo dato.
// Y va ARRIBA, antes de las acciones, porque al final del panel no se rellenaría.
test('el marcado se monta arriba del panel y con el mismo permiso que el estado', () => {
  const src = read(PANEL)
  assert.match(src, /\{canChangeStatus && \(\s*\n\s*<MarcadoRapido/)
  const marcado = src.indexOf('<MarcadoRapido')
  const acciones = src.indexOf('Acciones: unirse / reprogramar / cancelar')
  assert.ok(marcado > -1 && acciones > -1, 'faltan los bloques del panel')
  assert.ok(marcado < acciones, 'el marcado debe ir antes de las acciones')
})

// El marcado entra por su propia clave y NO por la lista de campos libres: si `offered` o `status`
// entraran por `patch`, la UI podría escribir offered:true con status:'no_show' y el Pitch Rate
// saldría por encima del 100%.
test('la ruta no acepta los campos del marcado como campos libres', () => {
  const src = read(RUTA)
  assert.match(src, /const ALLOWED = \['notes', 'recording_url', 'transcript_drive_url', 'transcript'\] as const/)
  for (const campo of ['offered', 'result', 'status', 'needs_followup']) {
    assert.doesNotMatch(
      src,
      new RegExp(`ALLOWED = \\[[^\\]]*'${campo}'`),
      `${campo} no puede estar en la lista de campos libres`
    )
  }
  assert.match(src, /construirParche\(patch\.marcado as Marcado\)/)
})

// Una combinación imposible se rechaza ANTES de escribir, con 422, para no dejar media cita en un
// estado que no puede existir.
test('una combinación imposible devuelve 422 sin escribir nada', () => {
  const src = read(RUTA)
  assert.match(
    src,
    /if \('error' in resultado\) return NextResponse\.json\(\{ error: resultado\.error \}, \{ status: 422 \}\)/
  )
  // Y la traducción ocurre antes del update.
  const traduccion = src.indexOf('construirParche(')
  const escritura = src.indexOf(".from('appointments').update(")
  assert.ok(traduccion > -1 && escritura > -1)
  assert.ok(traduccion < escritura, 'las reglas deben aplicarse antes de escribir')
})

// Lo que el servidor deduce se dice, no se hace en silencio: quien marca tiene que poder ver qué ha
// quedado escrito.
test('los avisos del servidor llegan a la interfaz', () => {
  assert.match(read(RUTA), /ok: true, avisos/)
  assert.match(read(COMPONENTE), /data\.avisos/)
})
