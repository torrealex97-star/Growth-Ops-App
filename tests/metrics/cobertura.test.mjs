import assert from 'node:assert/strict'
import test from 'node:test'
import { coberturaDe, recortarAMedido } from '../../lib/metrics/cobertura.ts'

const d = (iso) => new Date(iso)
const periodo = (from, to) => ({ from: from ? d(from) : null, to: to ? d(to) : null })

// ---------------------------------------------------------------------------------------------
// LA REGLA: lo que no se medía no cuenta hasta la fecha en que se empezó a medir.
//
// El caso real que motiva esto: `appointments.offered` existe desde siempre y está vacío en las 559
// citas históricas. El día que los closers empiecen a marcarlo, "Pitch Rate de este año" dividiría
// las ofertas de noviembre entre las asistidas de TODO el año. El resultado no describe nada.
// ---------------------------------------------------------------------------------------------

test('sin medición, la métrica es no_medido — nunca cero', () => {
  const c = coberturaDe(periodo('2026-01-01', '2026-12-31'), null)
  assert.equal(c.estado, 'no_medido')
  assert.equal(c.fraccion, 0)
  assert.equal(c.rangoCubierto, null)
  // El motivo tiene que decir que no se registra, no que no haya pasado.
  assert.match(c.motivo, /no se registra/i)
})

// Mirar marzo cuando la medición empezó en noviembre no es "0% de ofertas": es "en marzo no medíamos
// esto". Son dos frases distintas.
test('un periodo anterior a la medición no cuenta, y el motivo dice desde cuándo se mide', () => {
  const c = coberturaDe(periodo('2026-03-01', '2026-03-31'), '2026-11-01')
  assert.equal(c.estado, 'no_medido')
  assert.equal(c.fraccion, 0)
  assert.match(c.motivo, /todavía no se registraba/i)
  assert.match(c.motivo, /2026/)
})

test('un periodo que arranca ya dentro de la medición está cubierto entero', () => {
  const c = coberturaDe(periodo('2026-12-01', '2026-12-31'), '2026-11-01')
  assert.equal(c.estado, 'real')
  assert.equal(c.fraccion, 1)
  assert.deepEqual(c.rangoCubierto, { from: d('2026-12-01'), to: d('2026-12-31') })
})

// El caso que más engaña: el periodo cruza la fecha de inicio de medición.
test('un periodo a caballo es parcial y solo cubre desde que se empezó a medir', () => {
  const c = coberturaDe(periodo('2026-10-01', '2026-11-30'), '2026-11-01')
  assert.equal(c.estado, 'parcial')
  assert.equal(c.rangoCubierto.from.toISOString(), d('2026-11-01').toISOString())
  assert.equal(c.rangoCubierto.to.toISOString(), d('2026-11-30').toISOString())
  // 29 de los 60 días del periodo → alrededor de la mitad.
  assert.ok(c.fraccion > 0.4 && c.fraccion < 0.6, `fracción inesperada: ${c.fraccion}`)
  assert.match(c.motivo, /Solo se cuenta desde/i)
})

// El día exacto en que empieza la medición cuenta: la comparación es >=, no >.
test('el día en que empieza la medición está dentro', () => {
  const c = coberturaDe(periodo('2026-11-01', '2026-11-30'), '2026-11-01')
  assert.equal(c.estado, 'real')
  assert.equal(c.fraccion, 1)
})

// 'Todo' (preset 'all') no tiene límite inferior, así que con medición posterior al primer dato es
// parcial por definición. No se finge una fracción: no se sabe cuándo empieza "todo".
test('el preset Todo es parcial y no inventa una fracción', () => {
  const c = coberturaDe(periodo(null, '2026-12-31'), '2026-11-01')
  assert.equal(c.estado, 'parcial')
  assert.equal(c.fraccion, 0)
  assert.equal(c.rangoCubierto.from.toISOString(), d('2026-11-01').toISOString())
  assert.match(c.motivo, /Lo anterior existe pero no se registraba/i)
})

test('acepta la fecha como string, que es como llega de base', () => {
  const comoTexto = coberturaDe(periodo('2026-12-01', '2026-12-31'), '2026-11-01')
  const comoFecha = coberturaDe(periodo('2026-12-01', '2026-12-31'), d('2026-11-01'))
  assert.equal(comoTexto.estado, comoFecha.estado)
  assert.equal(comoTexto.fraccion, comoFecha.fraccion)
})

test('una fecha de medición inválida se trata como "no se mide", no como el día 1 de 1970', () => {
  const c = coberturaDe(periodo('2026-01-01', '2026-12-31'), 'no-es-una-fecha')
  assert.equal(c.estado, 'no_medido')
  assert.equal(c.medidoDesde, null)
})

// ---------------------------------------------------------------------------------------------
// recortarAMedido — lo que impide el número falso.
// ---------------------------------------------------------------------------------------------

// EL ERROR QUE EVITA: recortar solo el numerador. Si las ofertas salen de noviembre pero las
// asistidas siguen saliendo de todo el año, el Pitch Rate es basura. Los dos lados de la división
// tienen que usar EL MISMO rango recortado.
test('el rango recortado es el que deben usar numerador Y denominador', () => {
  const p = periodo('2026-10-01', '2026-11-30')
  const recortado = recortarAMedido(p, coberturaDe(p, '2026-11-01'))
  assert.equal(recortado.from.toISOString(), d('2026-11-01').toISOString())
  assert.equal(recortado.to.toISOString(), d('2026-11-30').toISOString())
})

test('sin medición no hay rango que consultar: null, no el periodo entero', () => {
  const p = periodo('2026-01-01', '2026-12-31')
  assert.equal(recortarAMedido(p, coberturaDe(p, null)), null)
  const anterior = periodo('2026-03-01', '2026-03-31')
  assert.equal(recortarAMedido(anterior, coberturaDe(anterior, '2026-11-01')), null)
})

test('un periodo cubierto entero se consulta tal cual, sin recortar', () => {
  const p = periodo('2026-12-01', '2026-12-31')
  assert.deepEqual(recortarAMedido(p, coberturaDe(p, '2026-11-01')), p)
})

// Frontera de mes y cambio de hora de Europe/Madrid: el recorte no puede desplazar un día. Se
// comprueba con el último instante del mes, que es donde un off-by-one se nota.
test('las fronteras de mes y el cambio de hora no desplazan el recorte', () => {
  // Fin del horario de verano en España 2026: 25 de octubre.
  const p = { from: d('2026-10-01T00:00:00+02:00'), to: d('2026-10-31T23:59:59.999+01:00') }
  const c = coberturaDe(p, d('2026-10-25T00:00:00+02:00'))
  assert.equal(c.estado, 'parcial')
  const recortado = recortarAMedido(p, c)
  assert.equal(recortado.from.toISOString(), d('2026-10-25T00:00:00+02:00').toISOString())
  assert.equal(recortado.to.toISOString(), p.to.toISOString())
})
