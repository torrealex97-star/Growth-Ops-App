import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { METODOS_DE_CAPACIDAD, desajustes, erroresDeManifiesto } from '../lib/conectores/contrato.ts'
import { CONECTORES, conectorDe, pendientesDeMigrar } from '../lib/conectores/registro.ts'
import { normalize } from '../lib/conectores/_plantilla/index.ts'
import { normalize as normalizeStripe } from '../lib/conectores/stripe/index.ts'

// F2 — LA SUITE DE CONTRATO.
//
// Es la prueba que pasa TODO conector, presente y futuro: se recorre el registro, así que añadir un
// proveedor lo somete entero sin tocar este fichero. La graduación de F2 dice exactamente eso — "un
// conector nuevo consiste en declarar manifest y capabilities, implementar los métodos aplicables y
// pasar la suite de contrato".
//
// Lo que protege, en una frase: que el panel no pueda mentir sobre lo que una integración hace.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const nombre = (c) => c.manifest.provider

// ── DECLARADO vs IMPLEMENTADO, EN LOS DOS SENTIDOS ───────────────────────────────────────────

test('lo declarado en el manifiesto existe, y lo implementado está declarado', () => {
  for (const c of CONECTORES) {
    assert.deepEqual(desajustes(c), [], `${nombre(c)}: manifiesto e implementación no coinciden`)
  }
})

test('el sentido que suele olvidarse: implementar sin declarar', () => {
  // Un conector que puede ESCRIBIR en el sistema de un cliente sin declararlo deja al panel sin
  // forma de avisar. Por eso el desajuste se detecta también en esta dirección.
  const colado = {
    manifest: { ...CONECTORES[0].manifest, capabilities: {} },
    executeAction: async () => ({ ok: true, mensaje: '' }),
  }
  assert.deepEqual(desajustes(colado), [{ metodo: 'executeAction', problema: 'implementado_sin_declarar' }])
})

test('declarar de más también se detecta', () => {
  const prometido = { manifest: { ...CONECTORES[0].manifest, capabilities: { discover: true } } }
  assert.ok(desajustes(prometido).some((d) => d.metodo === 'discover' && d.problema === 'declarado_sin_implementar'))
})

// ── EL MANIFIESTO ────────────────────────────────────────────────────────────────────────────

test('todos los manifiestos son válidos', () => {
  for (const c of CONECTORES) {
    assert.deepEqual(erroresDeManifiesto(c.manifest), [], `${nombre(c)}: manifiesto inválido`)
  }
})

test('un manifiesto incompleto se rechaza con el motivo, no con un booleano', () => {
  const errores = erroresDeManifiesto({
    provider: 'Mal Nombre',
    version: 'v1',
    label: '',
    authMode: 'api_key',
    requiredKeys: [],
    supportedObjects: [],
    syncModes: [],
    capabilities: {},
  })
  assert.ok(errores.length >= 5)
  assert.ok(errores.some((e) => e.startsWith('provider:')))
  assert.ok(errores.some((e) => e.startsWith('version:')))
  assert.ok(errores.some((e) => e.startsWith('syncModes:')))
})

test('quien recibe webhooks tiene que decir en qué dirección', () => {
  // Sin la dirección, la pantalla de Integraciones no puede enseñarla y alguien la compone a mano:
  // exactamente la errata que dejó a GHL sin funcionar una semana.
  const errores = erroresDeManifiesto({
    ...CONECTORES[0].manifest,
    capabilities: { ingestWebhook: true },
    webhookPath: undefined,
  })
  assert.ok(errores.some((e) => e.includes('webhookPath')))
})

test('una dirección de webhook con forma rara no cuela', () => {
  const errores = erroresDeManifiesto({
    ...CONECTORES[0].manifest,
    capabilities: { ingestWebhook: true },
    webhookPath: '/hooks/lo-que-sea',
  })
  assert.ok(errores.some((e) => e.startsWith('webhookPath:')))
})

test('cada proveedor aparece una sola vez', () => {
  const ids = CONECTORES.map(nombre)
  assert.deepEqual([...new Set(ids)], ids, 'dos conectores con el mismo provider: uno taparía al otro')
})

// ── NORMALIZE ES PURO ────────────────────────────────────────────────────────────────────────

test('normalize devuelve lo mismo ante el mismo payload', () => {
  const fixture = JSON.parse(readFileSync(join(root, 'lib/conectores/_plantilla/fixtures/contacto.json'), 'utf8'))
  const a = normalize(fixture)
  const b = normalize(structuredClone(fixture))
  assert.deepEqual(a, b)
  assert.equal(a.sourceEventId, 'ct_000000000001')
  assert.equal(a.ocurridoEn, '2026-09-23T10:00:00.000Z')
})

test('normalize no inventa un evento cuando no entiende el payload', () => {
  assert.equal(normalize({ sin: 'id' }), null)
  assert.equal(normalize(null), null)
  assert.equal(normalize('texto'), null)
})

test('normalize no arrastra datos personales a las propiedades', () => {
  const fixture = JSON.parse(readFileSync(join(root, 'lib/conectores/_plantilla/fixtures/contacto.json'), 'utf8'))
  const serializado = JSON.stringify(normalize(fixture).propiedades)
  for (const personal of ['example.test', 'Nombre', 'Apellido']) {
    assert.ok(!serializado.includes(personal), `${personal} no puede acabar en properties`)
  }
})

test('los fixtures no llevan datos de personas reales', () => {
  // El repositorio es PÚBLICO: un fixture con el correo de un cliente dentro es una filtración.
  const fixture = readFileSync(join(root, 'lib/conectores/_plantilla/fixtures/contacto.json'), 'utf8')
  assert.match(fixture, /example\.test/, 'los correos de ejemplo van en example.test')
  assert.match(fixture, /SANITIZADO/, 'el fixture debe declarar que está sanitizado')
})

// ── LA PLANTILLA ENSEÑA LO CORRECTO ──────────────────────────────────────────────────────────

test('la plantilla resuelve lo que cada integración resolvió a su manera', () => {
  const src = readFileSync(join(root, 'lib/conectores/_plantilla/index.ts'), 'utf8')
  assert.match(src, /deadline/, 'presupuesto de tiempo: sin él la función muere y pierde el cursor')
  assert.match(src, /429/, 'límite de uso: el 429 es lo normal en una sincronización larga')
  assert.match(src, /retry-after/i, 'se espera lo que el proveedor indica, no un rato inventado')
  assert.match(src, /cursor/, 'paginación con cursor')
  assert.match(src, /incidencias/, 'un fallo parcial se cuenta, no rompe la pasada')
})

test('la plantilla pasa su propia suite', () => {
  // Si el ejemplo que todo el mundo copia no cumpliera el contrato, enseñaría a incumplirlo.
  const p = conectorDe('plantilla')
  assert.ok(p)
  assert.deepEqual(desajustes(p), [])
  assert.deepEqual(erroresDeManifiesto(p.manifest), [])
})

// ── STRIPE: NORMALIZE CONTRA UN FIXTURE REAL ──────────────────────────────

test('stripe normalize: el cobro canónico del fixture se clasifica como cobro con su importe', () => {
  const fixture = JSON.parse(readFileSync(join(root, 'lib/conectores/stripe/fixtures/pago.json'), 'utf8'))
  const n = normalizeStripe(fixture)
  assert.ok(n)
  assert.equal(n.sourceEventId, 'evt_000000000001')
  assert.equal(n.tipo, 'stripe.cobro', 'payment_intent.succeeded es el evento canónico del dinero')
  assert.equal(n.propiedades.importe_eur, 499)
  assert.equal(n.propiedades.referencia_pago, 'pi_000000000001')
  assert.deepEqual(n.propiedades.referencias_alternativas, ['ch_000000000001'])
  // Sin PII en las propiedades: el sobre completo ya está en raw_events (ver lib/eventos/stripe.ts).
  const serializado = JSON.stringify(n.propiedades)
  for (const personal of ['example.test', 'cus_000000000001']) {
    assert.ok(!serializado.includes(personal), `${personal} no puede acabar en properties`)
  }
})

test('stripe normalize es puro: mismo payload, mismo resultado', () => {
  const fixture = JSON.parse(readFileSync(join(root, 'lib/conectores/stripe/fixtures/pago.json'), 'utf8'))
  const a = normalizeStripe(fixture)
  const b = normalizeStripe(structuredClone(fixture))
  assert.deepEqual(a, b)
})

test('stripe normalize no inventa un evento cuando no entiende el payload', () => {
  assert.equal(normalizeStripe({ sin: 'id' }), null)
  assert.equal(normalizeStripe(null), null)
  assert.equal(normalizeStripe('texto'), null)
  assert.equal(normalizeStripe({ id: 'evt_x', type: 'raro.desconocido', data: null }), null)
})

test('stripe: la semántica es la del normalizador probado, no una segunda', () => {
  // De los tres eventos que Stripe emite por un mismo pago, solo uno es dinero. Esa regla vive en
  // lib/stripe/webhook.ts y el conector la conserva; copiarla aquí sería una segunda semántica que
  // acabaría divergiendo.
  const fixture = JSON.parse(readFileSync(join(root, 'lib/conectores/stripe/fixtures/pago.json'), 'utf8'))
  const duplicado = {
    ...structuredClone(fixture),
    id: 'evt_000000000002',
    type: 'charge.succeeded',
    data: {
      object: {
        object: 'charge',
        id: 'ch_000000000001',
        amount: 49900,
        currency: 'eur',
        payment_intent: 'pi_000000000001',
      },
    },
  }
  const n = normalizeStripe(duplicado)
  assert.ok(n)
  assert.equal(n.tipo, 'stripe.duplicado', 'el dinero de este evento ya entra por el PaymentIntent')
})

test('los fixtures de stripe no llevan datos de personas reales', () => {
  const fixture = readFileSync(join(root, 'lib/conectores/stripe/fixtures/pago.json'), 'utf8')
  assert.match(fixture, /example\.test/, 'los correos de ejemplo van en example.test')
  assert.match(fixture, /SANITIZADO/, 'el fixture debe declarar que está sanitizado')
})

test('stripe: salud sin credencial es configuración pendiente, no avería, y no llama a la red', async () => {
  const c = conectorDe('stripe')
  assert.ok(c)
  const r = await c.healthCheck({ sb: {}, tenantId: 't', cfg: {} })
  assert.equal(r.ok, false)
  assert.equal(r.codigo, 'sin_credenciales')
})

// ── LA LISTA DE TRABAJO SE CALCULA, NO SE ESCRIBE ────────────────────────────────────────────

test('los proveedores sin conector salen del catálogo, no de una lista a mano', () => {
  const pendientes = pendientesDeMigrar()
  assert.ok(!pendientes.includes('stripe'), 'Stripe se migró el 24-sep: no puede seguir en la lista')
  assert.ok(!pendientes.includes('ghl'), 'GHL se migró el 23-sep: no puede seguir en la lista')
  assert.ok(!pendientes.includes('meta'), 'Meta se migró el 23-sep: no puede seguir en la lista')
  assert.ok(!pendientes.includes('plantilla'), 'lo que ya tiene conector no puede seguir pendiente')
})

test('el contrato cubre exactamente las capacidades declarables', () => {
  // Si se añade una capacidad al manifiesto sin añadirla aquí, dejaría de comprobarse en silencio.
  assert.deepEqual([...METODOS_DE_CAPACIDAD].sort(), [
    'backfill',
    'discover',
    'executeAction',
    'healthCheck',
    'incrementalSync',
    'ingestWebhook',
    'reconcile',
  ])
})
