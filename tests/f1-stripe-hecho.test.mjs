import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { TIPOS_DE_EVENTO_STRIPE, derivarStripe, propiedadesStripe, tipoEventoStripe } from '../lib/eventos/stripe.ts'
import { NORMALIZADORES } from '../lib/eventos/replay.ts'

// F1 — EL MISMO CAMINO PARA STRIPE.
//
// Lo que NO puede pasar: que esta capa cuente dinero. De los tres eventos que Stripe emite por un
// mismo pago (payment_intent.succeeded, charge.succeeded, charge.updated) solo UNO es dinero; si el
// hecho canónico los tratara igual, el cash saldría por triplicado. La clase la decide
// `lib/stripe/webhook.ts` y aquí solo se conserva.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const ruta = readFileSync(join(root, 'app/api/[tenant]/evergreen/webhooks/stripe/route.ts'), 'utf8')

const normalizado = (extra = {}) => ({
  eventId: 'evt_1',
  tipo: 'payment_intent.succeeded',
  clase: 'cobro',
  referenciaPago: 'pi_1',
  referenciasAlternativas: ['ch_1'],
  importeEur: 998.5,
  moneda: 'eur',
  email: 'persona@example.test',
  stripeCustomerId: 'cus_1',
  ocurridoEn: '2026-09-22T10:00:00.000Z',
  motivo: 'el intent liquidado es el hecho económico',
  ...extra,
})

test('la clase que decidió el normalizador se conserva en el tipo del hecho', () => {
  assert.equal(tipoEventoStripe(normalizado()), 'stripe.cobro')
  assert.equal(tipoEventoStripe(normalizado({ clase: 'reembolso' })), 'stripe.reembolso')
  // El duplicado económico NO se llama cobro: es la distinción que evita contar el dinero tres veces.
  assert.equal(tipoEventoStripe(normalizado({ clase: 'duplicado_economico' })), 'stripe.duplicado')
  assert.equal(tipoEventoStripe(normalizado({ clase: 'contexto' })), 'stripe.contexto')
  assert.equal(tipoEventoStripe(normalizado({ clase: 'ignorado' })), 'stripe.ignorado')
})

test('las propiedades llevan el dinero y sus referencias, nunca a la persona', () => {
  const props = propiedadesStripe(normalizado())
  assert.equal(props.importe_eur, 998.5)
  assert.equal(props.referencia_pago, 'pi_1')
  assert.deepEqual(props.referencias_alternativas, ['ch_1'])
  const serializado = JSON.stringify(props)
  assert.ok(!serializado.includes('example.test'), 'el correo no puede acabar en el hecho')
  assert.ok(!serializado.includes('cus_1'), 'el id de cliente de Stripe tampoco')
})

test('se conserva POR QUÉ se clasificó así', () => {
  // Sin el motivo, un "duplicado" raro obliga a volver a razonar el payload entero para auditarlo.
  assert.match(String(propiedadesStripe(normalizado()).motivo), /intent liquidado/)
})

test('un payload que no se entiende no produce hecho: devuelve null', () => {
  assert.equal(derivarStripe({ lo_que_sea: true }), null)
  assert.equal(derivarStripe(null), null)
})

test('un evento real de Stripe se deriva entero', () => {
  const derivado = derivarStripe({
    id: 'evt_9',
    type: 'payment_intent.succeeded',
    created: 1790000000,
    data: { object: { id: 'pi_9', amount_received: 99850, currency: 'eur', status: 'succeeded' } },
  })
  assert.equal(derivado.sourceEventId, 'evt_9')
  assert.equal(derivado.tipo, 'stripe.cobro')
  assert.equal(derivado.propiedades.importe_eur, 998.5)
})

test('el reprocesado sabe volver a pasar Stripe, no solo GHL', () => {
  assert.deepEqual(Object.keys(NORMALIZADORES).sort(), ['ghl', 'stripe'])
})

test('todos los tipos de Stripe están declarados en el vocabulario', () => {
  const sql = readFileSync(join(root, 'supabase/migrations/20260923090000_event_types.sql'), 'utf8')
  for (const { nombre } of TIPOS_DE_EVENTO_STRIPE) {
    assert.ok(sql.includes(`'${nombre}'`), `${nombre} no está sembrado`)
  }
})

test('el webhook de Stripe deriva el hecho DESPUÉS de guardar el sobre', () => {
  assert.ok(ruta.indexOf("from('raw_events').insert") < ruta.indexOf('EL HECHO CANÓNICO'))
  assert.match(ruta, /onConflict: 'tenant_id,source,source_event_id', ignoreDuplicates: true/)
})

test('escribir el hecho no puede tumbar la ingesta de Stripe', () => {
  const bloque = ruta.slice(ruta.indexOf('EL HECHO CANÓNICO'))
  assert.match(bloque, /catch \(e\)/)
  assert.match(bloque, /console\.warn/)
})

test('la capa de eventos NO escribe dinero', () => {
  // La semántica financiera se queda donde estaba: collections sigue naciendo de una decisión humana.
  const bloque = ruta.slice(ruta.indexOf('EL HECHO CANÓNICO'))
  assert.doesNotMatch(bloque, /from\('collections'\)/)
  assert.doesNotMatch(bloque, /from\('sales'\)/)
})
