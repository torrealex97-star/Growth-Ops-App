import assert from 'node:assert/strict'
import test from 'node:test'

import { manifest, normalize } from '../lib/conectores/ghl/index.ts'
import { INTEGRATION_GROUPS } from '../lib/integrations-catalog.ts'
import { idEventoGhl, tipoEventoGhl } from '../lib/eventos/ghl.ts'

// F2 — GHL SOBRE EL CONTRATO, SIN CAMBIAR LO QUE HACE.
//
// La graduación de F2 dice "GHL y Meta siguen produciendo los mismos datos". Un adaptador que
// reinterpreta el payload a su manera rompería eso en silencio: los datos seguirían entrando, pero
// distintos. Por eso el conector DELEGA en la misma derivación que usan el webhook y el reprocesado.

const cita = {
  appointmentId: 'apt_1',
  contactId: 'c_1',
  startTime: '2026-09-23T10:00:00Z',
  status: 'confirmed',
  email: 'persona@example.test',
  firstName: 'Nombre',
}

test('el conector interpreta el payload IGUAL que el webhook', () => {
  // Una segunda interpretación es una divergencia esperando a ocurrir.
  const n = normalize(cita)
  assert.equal(n.sourceEventId, idEventoGhl(cita))
  assert.equal(n.tipo, tipoEventoGhl(cita))
})

test('no arrastra datos personales', () => {
  const serializado = JSON.stringify(normalize(cita).propiedades)
  assert.ok(!serializado.includes('example.test'))
  assert.ok(!serializado.includes('Nombre'))
})

test('un payload que no es un objeto no produce evento', () => {
  assert.equal(normalize(null), null)
  assert.equal(normalize('texto'), null)
})

test('sin fecha del hecho se declara vacío, no se inventa "ahora"', () => {
  // Poner la hora de recepción movería la cita de día en cada reintento.
  assert.equal(normalize({ contactId: 'c_1' }).ocurridoEn, '')
})

// ── EL MANIFIESTO DICE LA VERDAD SOBRE GHL ───────────────────────────────────────────────────

test('las credenciales declaradas son las que exige el catálogo de Integraciones', () => {
  // Dos listas que se separan dejarían el panel pidiendo una clave que el conector no usa (o al
  // revés). Es el mismo fallo que tuvo Calendly con su secreto.
  const grupo = INTEGRATION_GROUPS.find((g) => g.id === 'ghl')
  assert.deepEqual([...manifest.requiredKeys].sort(), [...grupo.required].sort())
  assert.equal(manifest.webhookPath, grupo.webhookPath)
})

test('NO declara sincronización incremental, y eso es correcto', () => {
  // La API de GHL lista todos los contactos de la ubicación antes de tocar eventos: no cabe en los
  // 60 s de Vercel (dos pasadas acabaron en 504 y un run colgado, #112). Va por botón.
  assert.ok(!manifest.syncModes.includes('incremental'))
  assert.deepEqual([...manifest.syncModes].sort(), ['manual', 'webhook'])
  assert.notEqual(manifest.capabilities.incrementalSync, true)
})

test('NO declara escritura hacia GHL', () => {
  // Hoy nada de esta app escribe en GHL. Declararlo "por si acaso" anunciaría una capacidad que
  // nadie ha revisado, sobre el sistema de un cliente.
  assert.notEqual(manifest.capabilities.executeAction, true)
})

test('declara que recibe webhooks y en qué dirección', () => {
  assert.equal(manifest.capabilities.ingestWebhook, true)
  assert.match(manifest.webhookPath, /^\/api\/\{tenant\}\//)
})
