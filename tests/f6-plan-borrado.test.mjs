import assert from 'node:assert/strict'
import test from 'node:test'

import {
  POLITICA_SIN_DECIDIR,
  PROVEEDORES_EXTERNOS,
  pasosBloqueados,
  planificarBorrado,
  puedeDeclararseCompleto,
} from '../lib/privacidad/plan-borrado.ts'

// F6 — EL PLAN DE BORRADO.
//
// La propiedad que de verdad importa no es "borra cosas": es que **no mienta**. Un informe que dice
// "hecho" sobre un store que no se tocó es peor que no tener informe, porque cierra el expediente
// de una solicitud de borrado que en realidad sigue abierta.
//
// Hoy la política de retención NO está decidida (`docs/F6-MAPA-PII.md` §7): son decisiones de
// negocio y base legal. El plan tiene que reflejarlo, no rellenarlo con un comportamiento razonable
// inventado. Estos tests fijan exactamente eso.

const completa = { raw: 'anonimizar', transcripciones: 'borrar', hechosFinancieros: 'conservar_sin_pii' }
const store = (pasos, nombre) => pasos.find((p) => p.store === nombre)

// ── SIN POLÍTICA: SE BLOQUEA, NO SE IMPROVISA ────────────────────────────────────────────────

test('sin política decidida, los tres stores que dependen de ella quedan bloqueados', () => {
  const bloqueados = pasosBloqueados(planificarBorrado(POLITICA_SIN_DECIDIR)).map((p) => p.store)
  assert.deepEqual(bloqueados.sort(), ['appointments.transcript', 'raw_events', 'sales / collections'])
})

test('sin política decidida, el borrado NO puede declararse completo', () => {
  assert.equal(puedeDeclararseCompleto(planificarBorrado(POLITICA_SIN_DECIDIR)), false)
})

test('cada bloqueo explica de qué decisión depende, no solo que está bloqueado', () => {
  for (const paso of pasosBloqueados(planificarBorrado(POLITICA_SIN_DECIDIR))) {
    assert.match(paso.motivo, /no está decidid|no está decidido/, `"${paso.store}" debe nombrar la decisión que falta`)
    assert.ok(paso.motivo.length > 60, `"${paso.store}": el motivo tiene que servirle a quien lea el informe`)
  }
})

test('lo que NO depende de la política se planifica igual: el bloqueo no paraliza el resto', () => {
  const pasos = planificarBorrado(POLITICA_SIN_DECIDIR)
  for (const nombre of ['contact_notes', 'contact_attributions', 'fathom_match_review', 'stripe_customers']) {
    assert.notEqual(store(pasos, nombre).tratamiento, 'bloqueado', `${nombre} no depende de la retención`)
  }
})

// ── CON POLÍTICA: SE DESBLOQUEA ──────────────────────────────────────────────────────────────

test('con la política completa no queda nada bloqueado y el borrado puede cerrarse', () => {
  const pasos = planificarBorrado(completa)
  assert.deepEqual(pasosBloqueados(pasos), [])
  assert.equal(puedeDeclararseCompleto(pasos), true)
})

test('la política elegida cambia el tratamiento, no solo el mensaje', () => {
  const borrando = store(planificarBorrado({ ...completa, raw: 'borrar' }), 'raw_events')
  const anonimizando = store(planificarBorrado({ ...completa, raw: 'anonimizar' }), 'raw_events')
  assert.equal(borrando.tratamiento, 'borrar')
  assert.equal(anonimizando.tratamiento, 'anonimizar')
  assert.deepEqual(anonimizando.columnas, ['payload'])
})

test('conservar transcripciones sigue vaciando las notas libres de la cita', () => {
  // Conservar la transcripción por base legal no autoriza a conservar el resto del texto libre.
  const paso = store(planificarBorrado({ ...completa, transcripciones: 'conservar' }), 'appointments.transcript')
  assert.deepEqual(paso.columnas, ['notes'])
  assert.ok(!paso.columnas.includes('transcript'))
})

// ── DECISIONES DE DISEÑO QUE NO DEBEN CAMBIARSE SIN PENSARLO ─────────────────────────────────

test('el contacto se anonimiza, nunca se borra la fila', () => {
  // Borrar la fila arrastraría claves foráneas de hechos con obligación legal (ventas, cobros).
  const paso = store(planificarBorrado(completa), 'contacts')
  assert.equal(paso.tratamiento, 'anonimizar')
  for (const col of ['full_name', 'email', 'email_normalized', 'phone', 'phone_normalized', 'instagram']) {
    assert.ok(paso.columnas.includes(col), `falta vaciar contacts.${col}`)
  }
})

test('los normalizados se vacían junto a los originales', () => {
  // Vaciar `email` y dejar `email_normalized` deja a la persona localizable por búsqueda exacta:
  // el borrado parecería hecho y no lo estaría.
  const cols = store(planificarBorrado(completa), 'contacts').columnas
  assert.equal(cols.includes('email'), cols.includes('email_normalized'))
  assert.equal(cols.includes('phone'), cols.includes('phone_normalized'))
})

test('los hechos canónicos se desvinculan, no se borran', () => {
  const paso = store(planificarBorrado(completa), 'canonical_events')
  assert.equal(paso.tratamiento, 'desvincular')
  assert.match(paso.motivo, /inmutables/)
})

test('la marca en contacts va la última', () => {
  // Si la ejecución se corta antes, queda una persona viva con parte de su PII borrada —detectable
  // y reintentable— y no una cáscara marcada como borrada que todavía conserva datos.
  const pasos = planificarBorrado(completa)
  assert.equal(pasos[pasos.length - 1].store, 'contacts')
})

test('fathom_match_review se borra también por correo, no solo por contacto', () => {
  // 108 de sus 177 filas nunca llegaron a tener contacto asociado: por contact_id se quedarían.
  assert.match(store(planificarBorrado(completa), 'fathom_match_review').motivo, /también por correo/)
})

test('todo paso declara su motivo', () => {
  for (const paso of planificarBorrado(completa)) {
    assert.ok(paso.motivo && paso.motivo.length > 30, `"${paso.store}" sin motivo utilizable`)
  }
})

test('los proveedores externos se enumeran para el informe', () => {
  // erase_person no puede borrar fuera; lo que sí debe es decir qué queda pendiente ahí, en vez de
  // sugerir que el borrado terminó.
  const nombres = PROVEEDORES_EXTERNOS.map((p) => p.nombre)
  for (const esperado of ['GHL', 'Stripe', 'Fathom']) assert.ok(nombres.includes(esperado))
  for (const p of PROVEEDORES_EXTERNOS) assert.ok(p.que.length > 5, `${p.nombre} debe decir QUÉ guarda`)
})
