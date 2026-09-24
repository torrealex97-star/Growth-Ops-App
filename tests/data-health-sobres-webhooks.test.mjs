import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { SILENCIO_WEBHOOK_MS, saludWebhook } from '../lib/data-health/webhooks.ts'

// EL CONTROL NO PUEDE MENTIR: "al día" solo con evidencia real de recepción, un hueco no es un cero
// (fallo de lectura → desconocido, nunca "al día") y una integración que la subcuenta no usa no es
// avería. Auditoría del 23-sep: GHL enviaba y la app lo tragaba en silencio; nadie miraba la mitad
// receptora. Extensión 24-sep: mismo control para Calendly y Stripe, con la evidencia de cada uno.

const AHORA = Date.parse('2026-09-24T10:00:00Z')
const HACE_2H = '2026-09-24T08:00:00Z'
const HACE_30H = '2026-09-23T04:00:00Z'

// ── Reglas comunes (cualquier proveedor) ─────────────────────────────────────

test('recepción reciente → al día, con horas redondeadas', () => {
  const s = saludWebhook({ proveedor: 'ghl', configurado: true, ultimoSobre: HACE_2H, ahora: AHORA })
  assert.equal(s.estado, 'al_dia')
  assert.equal(s.horasDesde, 2)
  assert.equal(s.ultimoSobre, HACE_2H)
})

test('más de 24h sin recepción con la integración configurada → silencio (el caso real del 22-sep)', () => {
  const s = saludWebhook({ proveedor: 'ghl', configurado: true, ultimoSobre: HACE_30H, ahora: AHORA })
  assert.equal(s.estado, 'silencio')
  assert.equal(s.horasDesde, 30)
  assert.match(s.mensaje, /30 h/)
})

test('integración configurada y cero recepciones históricas → silencio (alta sin funcionar)', () => {
  const s = saludWebhook({ proveedor: 'ghl', configurado: true, ultimoSobre: null, ahora: AHORA })
  assert.equal(s.estado, 'silencio')
  assert.equal(s.horasDesde, null)
  assert.match(s.mensaje, /nunca ha recibido/)
})

test('integración no usada → sin_configurar, nunca avería', () => {
  const s = saludWebhook({ proveedor: 'ghl', configurado: false, ultimoSobre: null, ahora: AHORA })
  assert.equal(s.estado, 'sin_configurar')
})

test('sin_configurar no avisa aunque no haya recepciones', () => {
  const s = saludWebhook({ proveedor: 'ghl', configurado: false, ultimoSobre: null, ahora: AHORA })
  assert.notEqual(s.estado, 'silencio')
})

test('evidencia no leíble → desconocido, jamás "al día" (un hueco no es un cero)', () => {
  const s = saludWebhook({ proveedor: 'ghl', configurado: true, ultimoSobre: null, leido: false, ahora: AHORA })
  assert.equal(s.estado, 'desconocido')
})

test('fecha ilegible → desconocido, no se asume fresca', () => {
  const s = saludWebhook({ proveedor: 'ghl', configurado: true, ultimoSobre: 'no-es-una-fecha', ahora: AHORA })
  assert.equal(s.estado, 'desconocido')
})

test('el umbral exacto (24h) ya cuenta como silencio', () => {
  const hace24h = '2026-09-23T10:00:00Z'
  const s = saludWebhook({ proveedor: 'ghl', configurado: true, ultimoSobre: hace24h, ahora: AHORA })
  assert.equal(s.estado, 'silencio')
  assert.equal(SILENCIO_WEBHOOK_MS, 24 * 60 * 60 * 1000)
})

test('un milisegundo antes del umbral sigue al día', () => {
  const casi = new Date(AHORA - SILENCIO_WEBHOOK_MS + 1).toISOString()
  const s = saludWebhook({ proveedor: 'ghl', configurado: true, ultimoSobre: casi, ahora: AHORA })
  assert.equal(s.estado, 'al_dia')
})

test('umbral personalizable (la función no hardcodea la política)', () => {
  const s = saludWebhook({
    proveedor: 'ghl',
    configurado: true,
    ultimoSobre: HACE_2H,
    umbralMs: 3_600_000,
    ahora: AHORA,
  })
  assert.equal(s.estado, 'silencio')
})

// ── La misma regla aplica a Calendly y Stripe (mismo silencio, otro proveedor) ──

test('Calendly: 30 h sin recepción → silencio', () => {
  const s = saludWebhook({ proveedor: 'calendly', configurado: true, ultimoSobre: HACE_30H, ahora: AHORA })
  assert.equal(s.estado, 'silencio')
  assert.match(s.mensaje, /Calendly/)
})

test('Calendly: recepción reciente → al día', () => {
  const s = saludWebhook({ proveedor: 'calendly', configurado: true, ultimoSobre: HACE_2H, ahora: AHORA })
  assert.equal(s.estado, 'al_dia')
})

test('Stripe: 30 h sin recepción → silencio', () => {
  const s = saludWebhook({ proveedor: 'stripe', configurado: true, ultimoSobre: HACE_30H, ahora: AHORA })
  assert.equal(s.estado, 'silencio')
  assert.match(s.mensaje, /Stripe/)
})

test('Stripe: recepción reciente → al día', () => {
  const s = saludWebhook({ proveedor: 'stripe', configurado: true, ultimoSobre: HACE_2H, ahora: AHORA })
  assert.equal(s.estado, 'al_dia')
})

// ── Cada proveedor señala dónde mirar cuando el alta no funciona ─────────────

test('los mensajes de "nunca ha recibido" apuntan al alta de cada proveedor', () => {
  const ghl = saludWebhook({ proveedor: 'ghl', configurado: true, ultimoSobre: null, ahora: AHORA })
  const calendly = saludWebhook({ proveedor: 'calendly', configurado: true, ultimoSobre: null, ahora: AHORA })
  const stripe = saludWebhook({ proveedor: 'stripe', configurado: true, ultimoSobre: null, ahora: AHORA })
  assert.match(ghl.mensaje, /alta en GHL o el secret/)
  assert.match(calendly.mensaje, /suscripción en Calendly o la Signing Key/)
  assert.match(stripe.mensaje, /endpoint en Stripe o su firma/)
})

// ── Route y panel: la evidencia de cada webhook es la suya (regresión estática) ──

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = join(aqui, '..')
const leer = (p) => readFileSync(join(raiz, p), 'utf8')

const route = leer('app/api/[tenant]/evergreen/settings/data-health/route.ts')
const panel = leer('components/settings/DataHealthPanel.tsx')

test('la route consulta la evidencia real de cada webhook (raw_events ghl, raw_events stripe, audit_logs)', () => {
  assert.match(route, /\.eq\('source', 'ghl'\)/)
  assert.match(route, /\.eq\('source', 'stripe'\)/)
  assert.match(route, /from\('audit_logs'\)/)
  // Queries acotadas: una fecha por webhook, no el histórico (mismo criterio que el resto del panel).
  assert.match(route, /limit\(1\)/)
  assert.match(route, /limit\(50\)/)
  assert.match(route, /limit\(400\)/)
})

test('la route reutiliza las funciones canónicas de evidencia (sin duplicar la huella de Calendly)', () => {
  assert.match(route, /eventosStripe\(/)
  assert.match(route, /recepcionCalendly\(/)
  assert.match(route, /ultimoEventoEnAudit\('audit_calendly', actas\)/)
  // El rechazo de firma de Stripe es una petición entrante, no una recepción: el filtro es el mismo
  // que usa Integraciones.
  assert.match(route, /ultimo_valido/)
})

test('la route no aborta por un fallo de evidencia: cae en desconocido y el resto de la pantalla informa', () => {
  assert.match(route, /leido: !sobreGhlResult\.error/)
  assert.match(route, /leido: !actasAuditResult\.error/)
  assert.match(route, /leido: entregasStripe !== null/)
})

test('la route decide "configurado" con credenciales de pull o secret del webhook, por proveedor', () => {
  assert.match(route, /GHL_WEBHOOK_SECRET/)
  assert.match(route, /CALENDLY_API_TOKEN\) \|\| clavesConfiguradas\.has\('CALENDLY_WEBHOOK_SECRET'\)/)
  assert.match(route, /STRIPE_SECRET_KEY\) \|\| clavesConfiguradas\.has\('STRIPE_WEBHOOK_SECRET'\)/)
})

test('la route expone las saludes de los tres webhooks entrantes', () => {
  assert.match(route, /saludWebhookGhl: saludes\.ghl/)
  assert.match(route, /saludWebhooksEntrantes: \[/)
  assert.match(route, /\{ proveedor: 'calendly', \.\.\.saludes\.calendly \}/)
  assert.match(route, /\{ proveedor: 'stripe', \.\.\.saludes\.stripe \}/)
})

test('el panel pinta la sección "Webhooks entrantes" con los tres y no inventa datos sin evidencia', () => {
  assert.match(panel, /Webhooks entrantes/)
  assert.match(panel, /MetricWebhook label="Webhook de GHL"/)
  assert.match(panel, /ETIQUETA_WEBHOOK\[salud\.proveedor\]/)
  // Estados sin fecha no se pintan como horas: "sin recepciones" y "sin evidencia" son valores
  // distintos con significados distintos.
  assert.match(panel, /sin recepciones/)
  assert.match(panel, /sin evidencia/)
  // El fallo de lectura jamás pinta verde.
  assert.match(panel, /salud\.estado === 'silencio' \? 'bad' : salud\.estado === 'al_dia' \? 'good' : 'warn'/)
})
