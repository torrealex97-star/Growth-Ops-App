import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { WEBHOOKS_ENTRANTES, evaluarSecret, ultimoEventoEnAudit, eventosStripe } from '../lib/webhooks/entrantes.ts'

// ─────────────────────────────────────────────────────────────────────────────
// EL BLOQUE «WEBHOOKS ENTRANTES» NO PUEDE MENTIR.
//
// Este bloque existe porque la mitad receptora de las integraciones era
// invisible: el caso GHL demostró que un webhook puede llevar meses sin entrar
// mientras el panel decía "conectada". Cada invariante aquí abajo defiende una
// verdad concreta: que la URL enseñada existe, que el estado del secret es el
// que la ruta usa de verdad, y que la fecha del último evento sale de una
// evidencia real — nunca de las filas que también escribe el pull del cron.
// ─────────────────────────────────────────────────────────────────────────────

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('cada webhook del catálogo apunta a una ruta que existe de verdad', () => {
  // Si alguien mueve o renombra una ruta, el bloque seguiría dictando la vieja con aplomo.
  for (const w of WEBHOOKS_ENTRANTES) {
    assert.match(w.path, /^\/api\/\{tenant\}\//, `${w.id}: la ruta debe llevar {tenant}`)
    const fichero = join(root, 'app', w.path.replace('{tenant}', '[tenant]'), 'route.ts')
    assert.ok(existsSync(fichero), `${w.id}: el catálogo apunta a ${w.path}, que no existe`)
    assert.equal(w.metodo, 'POST')
    assert.ok(w.eventos.length > 0, `${w.id}: sin eventos descritos no se sabe qué dar de alta`)
  }
})

test('la cabecera que el catálogo declara es la que la ruta comprueba de verdad', () => {
  // La verdad del alta vive en el código de la ruta, no en el catálogo.
  const esperados = {
    'ghl-citas': { cabecera: 'x-ghl-secret', clave: 'GHL_WEBHOOK_SECRET' },
    calendly: { cabecera: 'calendly-webhook-signature', clave: 'CALENDLY_WEBHOOK_SECRET' },
    stripe: { cabecera: 'stripe-signature', clave: 'STRIPE_WEBHOOK_SECRET' },
    contratos: { cabecera: 'x-ghl-secret', clave: 'GHL_WEBHOOK_SECRET' },
    onboarding: { cabecera: 'x-ghl-secret', clave: 'ONBOARDING_INBOUND_SECRET' },
  }
  for (const w of WEBHOOKS_ENTRANTES) {
    const esp = esperados[w.id]
    assert.ok(esp, `webhook del catálogo sin expectativa de test: ${w.id}`)
    assert.equal(w.auth.nombre, esp.cabecera, `${w.id}: cabecera declarada ≠ cabecera que la ruta comprueba`)
    assert.equal(w.auth.configKey, esp.clave, `${w.id}: clave de configuración incorrecta`)
  }
})

test('GHL, contratos y onboarding comparten el mecanismo x-ghl-secret; Stripe y Calendly firman', () => {
  // Documenta la realidad de la casa: tres webhooks con cabecera plana (reutilizando el secret
  // de GHL) y dos con firma del proveedor. Cambiar uno sin enterarse rompe este test a propósito.
  const porId = Object.fromEntries(WEBHOOKS_ENTRANTES.map((w) => [w.id, w]))
  assert.equal(porId['ghl-citas'].auth.tipo, 'cabecera')
  assert.equal(porId.contratos.auth.tipo, 'cabecera')
  assert.equal(porId.onboarding.auth.tipo, 'cabecera')
  assert.equal(porId.stripe.auth.tipo, 'firma')
  assert.equal(porId.calendly.auth.tipo, 'firma')
  assert.equal(porId.contratos.auth.configKey, 'GHL_WEBHOOK_SECRET', 'contratos reutiliza el secret de GHL')
})

test('el webhook con secret global lo declara como aviso; los avisos de limitación están presentes', () => {
  const porId = Object.fromEntries(WEBHOOKS_ENTRANTES.map((w) => [w.id, w]))
  // Calendly: el catálogo pide la Signing Key en el panel, pero la ruta solo lee el entorno.
  // El bloque debe decirlo, o alguien la cambiaría en el panel esperando efecto inmediato.
  assert.match(porId.calendly.aviso, /entorno|Vercel/i)
  // GHL: limitación real de la plataforma (la herramienta simple no admite cabeceras).
  assert.match(porId['ghl-citas'].aviso, /Custom Webhook/i)
  // Stripe no necesita aviso: su secret sí se lee del panel.
  assert.equal(porId.stripe.aviso ?? null, null)
  // Onboarding: secreto global, no por subcuenta.
  assert.match(porId.onboarding.aviso, /global|entorno/i)
})

test('el webhook de contratos declara que aún no tiene evidencia propia (null, no inventada)', () => {
  const contratos = WEBHOOKS_ENTRANTES.find((w) => w.id === 'contratos')
  assert.equal(contratos.evidencia, null)
  // Y la ruta de verdad no escribe acta — si alguien la añade, este test obliga a actualizar
  // el catálogo para poder mostrarla.
  const ruta = readFileSync(join(root, 'app/api/[tenant]/evergreen/webhooks/contract/route.ts'), 'utf8')
  assert.doesNotMatch(ruta, /audit_logs/, 'si contratos ya escribe acta, ponle evidencia en el catálogo')
})

// ── evaluarSecret ────────────────────────────────────────────────────────────

test('evaluarSecret: panel con longitud → ok; panel sin longitud → no_descifrable (no se inventa)', () => {
  const ok = evaluarSecret({ source: 'db', length: 42 })
  assert.equal(ok.estado, 'ok')
  assert.equal(ok.longitud, 42)
  assert.equal(ok.fuente, 'panel')

  const sinLen = evaluarSecret({ source: 'db' })
  assert.equal(sinLen.estado, 'no_descifrable')
  assert.equal(sinLen.longitud, null)
  assert.match(sinLen.pista, /regrábalo|descifrar/i)
})

test('evaluarSecret: solo entorno → solo_entorno con pista honesta; vacío → sin_configurar', () => {
  const env = evaluarSecret({ source: 'env', length: 30 })
  assert.equal(env.estado, 'solo_entorno')
  assert.equal(env.fuente, 'entorno')
  // La pista dice la verdad operativa: guardar en el panel NO cambia lo que la ruta usa
  // mientras el valor del entorno siga presente (la ruta hace cfg.X || process.env.X).
  assert.match(env.pista, /no tiene efecto|usará ese valor|Vercel/i)

  const none = evaluarSecret(undefined)
  assert.equal(none.estado, 'sin_configurar')
  assert.match(none.pista, /401/)
})

// ── ultimoEventoEnAudit ──────────────────────────────────────────────────────

const acta = (created_at, action, via = undefined, entity_type = 'appointment') => ({
  entity_type,
  action,
  created_at,
  new_values: via ? { via } : null,
})

test('ghl-citas: SOLO cuenta actas marcadas con via ghl_webhook — el cron no contamina', () => {
  // El pull del cron escribe en appointments sin acta; una prueba manual histórica sí dejó
  // acta pero SIN marcador. Ninguna de las dos es recepción del webhook.
  const actas = [
    acta('2026-09-16T10:00:00Z', 'create'), // prueba humana del 16-sep: sin marcador
    acta('2026-09-20T04:20:00Z', 'create', 'cron_pull'), // marcador que NO es del webhook
    acta('2026-09-21T09:00:00Z', 'create', 'ghl_webhook'),
  ]
  const r = ultimoEventoEnAudit('audit_ghl', actas)
  assert.ok(r)
  assert.equal(r.fecha, '2026-09-21T09:00:00Z')
  assert.match(r.evidencia, /ghl_webhook/)
})

test('ghl-citas: sin actas marcadas → null (nunca ha llegado ninguno), jamás 0 ni fecha falsa', () => {
  const r = ultimoEventoEnAudit('audit_ghl', [acta('2026-09-16T10:00:00Z', 'create')])
  assert.equal(r, null)
  assert.equal(ultimoEventoEnAudit('audit_ghl', []), null)
})

test('ghl-citas: elige la más reciente entre varias recepciones', () => {
  const actas = [
    acta('2026-09-20T08:00:00Z', 'create', 'ghl_webhook'),
    acta('2026-09-21T11:30:00Z', 'update', 'ghl_webhook'),
    acta('2026-09-19T07:00:00Z', 'create', 'ghl_webhook'),
  ]
  assert.equal(ultimoEventoEnAudit('audit_ghl', actas).fecha, '2026-09-21T11:30:00Z')
})

test('calendly: cuenta las acciones que nacen de su webhook; los marcadores de GHL no son suyos', () => {
  const actas = [
    acta('2026-09-21T10:00:00Z', 'create', 'ghl_webhook'), // webhook de GHL: no es Calendly
    acta('2026-09-21T09:00:00Z', 'create'), // alta de Calendly (sin via)
    acta('2026-09-21T08:00:00Z', 'cancel'), // cancelación de Calendly
    acta('2026-09-21T07:00:00Z', 'reschedule_in'), // reprogramación entrante
    acta('2026-09-21T06:00:00Z', 'update', 'manual'), // via desconocido, pero acción válida
  ]
  const r = ultimoEventoEnAudit('audit_calendly', actas)
  assert.ok(r)
  assert.equal(r.fecha, '2026-09-21T09:00:00Z')
})

test('onboarding: solo sus tres marcadores via cuentan como recepción', () => {
  const actas = [
    acta('2026-09-20T10:00:00Z', 'update', 'otra_cos', 'sale'),
    acta('2026-09-21T10:00:00Z', 'update', 'ghl_onboarding_click', 'contract'),
    acta('2026-09-21T09:00:00Z', 'update', 'ghl_onboarding_completed', 'sale'),
  ]
  const r = ultimoEventoEnAudit('audit_onboarding', actas)
  assert.ok(r)
  assert.equal(r.fecha, '2026-09-21T10:00:00Z')
  assert.match(r.evidencia, /ghl_onboarding/)
  // Un acta de contratos SIN marcador (p.ej. firma manual) no es recepción del webhook.
  const sinMarcador = ultimoEventoEnAudit('audit_onboarding', [
    acta('2026-09-21T12:00:00Z', 'update', undefined, 'contract'),
  ])
  assert.equal(sinMarcador === null, true)
})

// ── eventosStripe ────────────────────────────────────────────────────────────

test('stripe: separa la última entrega válida del último rechazo de firma', () => {
  const rows = [
    { received_at: '2026-09-21T10:00:00Z', processing_status: 'normalized' },
    { received_at: '2026-09-21T10:05:00Z', processing_status: 'rejected' },
    { received_at: '2026-09-21T09:00:00Z', processing_status: 'normalized' },
  ]
  const r = eventosStripe(rows)
  assert.equal(r.ultimo_valido.fecha, '2026-09-21T10:00:00Z')
  assert.match(r.ultimo_valido.evidencia, /raw_events/)
  assert.equal(r.ultimo_rechazo.fecha, '2026-09-21T10:05:00Z')
  assert.match(r.ultimo_rechazo.evidencia, /rechazada/)
})

test('stripe: sin entregas válidas pero con rechazos → el rechazo se ve y "recibido" queda null', () => {
  // Exactamente el síntoma de un secret mal pegado: GHL/Stripe llama, la firma no cuadra,
  // y "0 eventos recibidos" sería falso: hay entregas, todas rechazadas.
  const r = eventosStripe([{ received_at: '2026-09-21T10:05:00Z', processing_status: 'rejected' }])
  assert.equal(r.ultimo_valido, null)
  assert.ok(r.ultimo_rechazo)
})

// ── El bloque pintado ────────────────────────────────────────────────────────

test('la página integra el bloque y el GET lo alimenta con evidencia del servidor', () => {
  const page = readFileSync(join(root, 'app/[tenant]/settings/integraciones/page.tsx'), 'utf8')
  assert.match(page, /<WebhooksEntrantesPanel webhooks=\{webhooksEntrantes\} tenant=\{tenant\} \/>/)

  const route = readFileSync(join(root, 'app/api/[tenant]/evergreen/settings/integraciones/route.ts'), 'utf8')
  // El estado se calcula en el servidor con las fuentes de evidencia reales.
  assert.match(route, /from\('audit_logs'\)/)
  assert.match(route, /from\('raw_events'\)/)
  assert.match(route, /webhooksEntrantes/)
})

test('el webhook de GHL sigue marcando sus actas con via ghl_webhook (la evidencia del bloque)', () => {
  // Si alguien quita el marcador, el bloque de Integraciones volvería a no poder distinguir
  // webhook de cron — la ciega exactamente que este feature vino a curar.
  const ruta = readFileSync(join(root, 'app/api/[tenant]/evergreen/webhooks/ghl/route.ts'), 'utf8')
  const actas = ruta.match(/audit_logs[\s\S]{0,400}?via: 'ghl_webhook'/g) ?? []
  assert.ok(actas.length >= 2, 'el webhook de GHL marca con via sus actas de create y update')
})
