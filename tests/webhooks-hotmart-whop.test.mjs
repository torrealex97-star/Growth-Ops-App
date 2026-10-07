import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { hechoDesdeSobre } from '../lib/eventos/canonico.ts'
import {
  compradorHotmart,
  derivarHotmart,
  idEventoHotmart,
  TIPOS_DE_EVENTO_HOTMART,
  toqueDesdePayloadHotmart,
} from '../lib/eventos/hotmart.ts'
import {
  compradorWhop,
  derivarWhop,
  idEventoWhop,
  TIPOS_DE_EVENTO_WHOP,
  toqueDesdePayloadWhop,
} from '../lib/eventos/whop.ts'
import { verificarFirmaHotmart } from '../lib/webhooks/hotmart.ts'
import { verificarFirmaWhop } from '../lib/webhooks/whop.ts'
import { INTEGRATION_GROUPS } from '../lib/integrations-catalog.ts'
import { WEBHOOKS_ENTRANTES } from '../lib/webhooks/entrantes.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const codigo = (p) =>
  read(p)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

// ─────────────────────────────────────────────────────────────────────────────────────────────
// HOTMART — AUTENTICACIÓN. Hotmart manda el Hottok único de la cuenta en X-HOTMART-HOTTOK.
// Sin token guardado: nada pasa (fail-closed).
// ─────────────────────────────────────────────────────────────────────────────────────────────

const HOTMART_SECRETO = 'mi-token-de-webhook-hotmart-1234567890'
const hotmartRaw = JSON.stringify({ event: 'PURCHASE_APPROVED', data: {} })

test('hotmart: el Hottok oficial valida y otro token no valida sin filtrar el secreto', () => {
  const valido = verificarFirmaHotmart(
    hotmartRaw,
    new Headers({ 'x-hotmart-hottok': HOTMART_SECRETO }),
    HOTMART_SECRETO
  )
  assert.equal(valido.valida, true)
  const v = verificarFirmaHotmart(hotmartRaw, new Headers({ 'x-hotmart-hottok': 'otro-token' }), HOTMART_SECRETO)
  assert.equal(v.valida, false)
  assert.ok(!v.motivo.includes(HOTMART_SECRETO), 'el motivo nunca contiene el valor del secreto')
})

test('hotmart: Hottok es fail-closed sin secreto o sin la cabecera oficial', () => {
  const v = verificarFirmaHotmart(hotmartRaw, new Headers({ 'x-hotmart-hottok': HOTMART_SECRETO }), HOTMART_SECRETO)
  assert.equal(v.valida, true)
  assert.equal(
    verificarFirmaHotmart(hotmartRaw, new Headers({ 'x-hotmart-hottok': 'otro' }), HOTMART_SECRETO).valida,
    false
  )
  // Sin secreto guardado en el panel NO se acepta nada, ni siquiera con la cabecera "correcta".
  const sinSecreto = verificarFirmaHotmart(hotmartRaw, new Headers({ 'x-hotmart-hottok': HOTMART_SECRETO }), undefined)
  assert.equal(sinSecreto.valida, false)
  // Sin cabeceras tampoco: el token del webhook es obligatorio en el alta.
  assert.equal(verificarFirmaHotmart(hotmartRaw, new Headers(), HOTMART_SECRETO).valida, false)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHOP — FIRMA (Standard Webhooks): HMAC-SHA256 de {id}.{timestamp}.{cuerpo crudo}, base64, con
// ventana anti-replay de 5 minutos.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const WHOP_SECRETO = 'ws_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const whopRaw = JSON.stringify({ id: 'msg_1', type: 'payment.succeeded', data: {} })

function whopCabeceras(raw, secreto, opts = {}) {
  const id = opts.id ?? 'msg_1'
  const ts = Math.floor(Date.now() / 1000) + (opts.desvioSegundos ?? 0)
  const mac = crypto.createHmac('sha256', secreto).update(`${id}.${ts}.${raw}`).digest('base64')
  return new Headers({
    'webhook-id': id,
    'webhook-timestamp': String(ts),
    'webhook-signature': `v1,${mac}`,
  })
}

test('whop: la firma Standard Webhooks valida y el anti-replay rechaza entregas viejas', () => {
  const v = verificarFirmaWhop(whopRaw, whopCabeceras(whopRaw, WHOP_SECRETO), WHOP_SECRETO)
  assert.equal(v.valida, true)

  const vieja = verificarFirmaWhop(
    whopRaw,
    whopCabeceras(whopRaw, WHOP_SECRETO, { desvioSegundos: -301 }),
    WHOP_SECRETO
  )
  assert.equal(vieja.valida, false, 'una entrega reenviada 5+ minutos después se rechaza')
  assert.match(vieja.motivo, /ventana|anti-replay/i)

  // El cuerpo crudo manda: un espacio de más invalida.
  const cambiado = verificarFirmaWhop(whopRaw + ' ', whopCabeceras(whopRaw, WHOP_SECRETO), WHOP_SECRETO)
  assert.equal(cambiado.valida, false)

  // Sin las tres cabeceras no hay verificación posible.
  assert.equal(verificarFirmaWhop(whopRaw, new Headers(), WHOP_SECRETO).valida, false)
  // Fail-closed sin secreto guardado.
  assert.equal(verificarFirmaWhop(whopRaw, whopCabeceras(whopRaw, WHOP_SECRETO), undefined).valida, false)
  // Esquema distinto (no v1) no valida.
  const otro = new Headers({
    'webhook-id': 'msg_1',
    'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
    'webhook-signature': 'v9,AAAA',
  })
  assert.equal(verificarFirmaWhop(whopRaw, otro, WHOP_SECRETO).valida, false)
  // El motivo nunca contiene el secreto.
  const mala = verificarFirmaWhop(whopRaw, whopCabeceras(whopRaw, 'ws_otra-clave'), WHOP_SECRETO)
  assert.equal(mala.valida, false)
  assert.ok(!mala.motivo.includes(WHOP_SECRETO))
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// IDEMPOTENCIA POR ID DE EVENTO: el reintento del proveedor cae en la misma fila.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('el id del evento: id real del sobre, cabecera de respaldo y huella determinista al final', () => {
  // Hotmart: el sobre v2 trae id.
  assert.equal(idEventoHotmart({ id: 'evt_abc', event: 'PURCHASE_APPROVED' }), 'evt_abc')
  // Sin id: huella determinista de lo que define el hecho. El MISMO hecho dos veces → MISMA huella;
  // dos hechos distintos (evento distinto sobre la misma transacción) → huellas distintas.
  const sinId = {
    event: 'PURCHASE_APPROVED',
    data: { purchase: { transaction: 'HP1', order_date: '2026-10-06T12:00:00Z', status: 'APPROVED' } },
  }
  const huella1 = idEventoHotmart(sinId)
  assert.match(huella1, /^hf_[0-9a-f]{40}$/)
  assert.equal(idEventoHotmart({ ...sinId }), huella1)
  assert.notEqual(idEventoHotmart({ ...sinId, event: 'PURCHASE_REFUNDED' }), huella1)

  // Whop: id del sobre, y sin él la cabecera webhook-id (los reintentos la repiten).
  assert.equal(idEventoWhop({ id: 'msg_abc' }), 'msg_abc')
  assert.equal(idEventoWhop({ type: 'payment.succeeded' }, 'msg_de_cabecera'), 'msg_de_cabecera')
  const huellaWhop = idEventoWhop({ type: 'payment.succeeded', data: { id: 'pay_1' } })
  assert.match(huellaWhop, /^hf_/)
  assert.equal(idEventoWhop({ type: 'payment.succeeded', data: { id: 'pay_1' } }), huellaWhop)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DERIVACIÓN: tipo, clase y propiedades SIN PII. El hecho es para analítica; la identidad del
// comprador solo vive en raw_events y en contacts.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const hotmartCompra = {
  id: 'evt_1',
  creation_date: 1791350400000,
  event: 'PURCHASE_APPROVED',
  version: '2.0.0',
  data: {
    buyer: { email: 'Maria.Example@Gmail.com', name: 'María García', phone: '+34600111222', document: '12345678Z' },
    product: { id: 12345, name: 'Programa Escalix' },
    purchase: {
      transaction: 'HP98765',
      status: 'APPROVED',
      order_date: '2026-10-06T12:00:00Z',
      approved_date: '2026-10-06T12:01:00Z',
      price: { value: 997, currency_value: 'EUR' },
    },
  },
}

const whopPago = {
  id: 'msg_1',
  type: 'payment.succeeded',
  timestamp: '2026-10-06T12:05:00.000Z',
  account_id: 'biz_1',
  data: {
    id: 'pay_1',
    status: 'paid',
    total: 50,
    currency: 'usd',
    paid_at: '2026-10-06T12:00:00.000Z',
    customer_phone: '+15551112345',
    user: { email: 'Marcus.Example@Whop.com', name: 'Marcus Webb', username: 'marcuswebb' },
    product: { id: 'prod_1', title: 'Comunidad Inner' },
    membership: { id: 'mem_1', status: 'active' },
  },
}

test('hotmart: tipo y clase económicos, fecha del pedido y propiedades sin PII', () => {
  const d = derivarHotmart(hotmartCompra, '2026-10-07T00:00:00.000Z')
  assert.ok(d)
  assert.equal(d.tipo, 'hotmart.compra.aprobada')
  assert.equal(d.clase, 'dinero')
  // CUÁNDO OCURRIÓ: la fecha del pedido, no la de recepción (una compra de ayer que entra hoy por
  // un reintento pertenece a ayer).
  assert.equal(d.ocurridoEn, '2026-10-06T12:00:00.000Z')

  const s = JSON.stringify(d.propiedades)
  assert.doesNotMatch(s, /Maria\.Example|Gmail\.com|María|García|34600111222|12345678Z/, 'el hecho no lleva PII')
  assert.equal(d.propiedades.transaccion, 'HP98765')
  assert.equal(d.propiedades.producto_id_externo, '12345')
  assert.equal(d.propiedades.producto_nombre, 'Programa Escalix')
  // El importe es TRANSCRIPCIÓN de lo que Hotmandó, con su moneda: sin conversiones inventadas.
  assert.equal(d.propiedades.importe_declarado, 997)
  assert.equal(d.propiedades.moneda, 'EUR')

  // Clases: reembolso/disputa son devolución, el resto estado.
  assert.equal(derivarHotmart({ ...hotmartCompra, event: 'PURCHASE_REFUNDED' }, 'x').clase, 'devolucion')
  assert.equal(derivarHotmart({ ...hotmartCompra, event: 'PURCHASE_CANCELED' }, 'x').clase, 'estado')
  // El vocabulario declara todo lo que el mapeo produce (la migración es su espejo).
  const vocabulario = new Set(TIPOS_DE_EVENTO_HOTMART.map((t) => t.nombre))
  for (const nombre of ['hotmart.compra.aprobada', 'hotmart.compra.reembolsada', 'hotmart.evento.recibido']) {
    assert.ok(vocabulario.has(nombre), `${nombre} declarado en TIPOS_DE_EVENTO_HOTMART`)
  }
  const desconocido = derivarHotmart({ event: 'ALGO_NUEVO' }, 'x')
  assert.equal(desconocido.tipo, 'hotmart.evento.recibido', 'lo desconocido se guarda sin inventarle semántica')
})

test('hotmart: creation_date documentado en milisegundos se usa cuando no hay fecha de compra', () => {
  const d = derivarHotmart(
    { id: 'evt_fecha', event: 'PURCHASE_APPROVED', creation_date: 1791350400000, data: {} },
    '2026-10-08T00:00:00.000Z'
  )
  assert.equal(d.ocurridoEn, '2026-10-07T05:20:00.000Z')
})

test('whop: tipo y clase, fecha del pago e importe transcrito sin PII', () => {
  const d = derivarWhop(whopPago, '2026-10-07T00:00:00.000Z', 'msg_1')
  assert.ok(d)
  assert.equal(d.tipo, 'whop.pago.recibido')
  assert.equal(d.clase, 'dinero')
  assert.equal(d.ocurridoEn, '2026-10-06T12:00:00.000Z')

  const s = JSON.stringify(d.propiedades)
  assert.doesNotMatch(s, /Marcus\.Example|Whop\.com|Marcus|Webb|marcuswebb|15551112345/, 'el hecho no lleva PII')
  assert.equal(d.propiedades.pago_id, 'pay_1')
  assert.equal(d.propiedades.membresia_id, 'mem_1')
  assert.equal(d.propiedades.producto_nombre, 'Comunidad Inner')
  assert.equal(d.propiedades.importe_declarado, 50, 'el importe se transcribe tal cual, sin conversión de unidades')
  assert.equal(d.propiedades.moneda, 'usd')

  assert.equal(derivarWhop({ ...whopPago, type: 'refund.created' }, 'x').clase, 'devolucion')
  assert.equal(derivarWhop({ ...whopPago, type: 'membership.activated' }, 'x').clase, 'estado')
  assert.equal(derivarWhop({ type: 'otra.cosa' }, 'x').tipo, 'whop.evento.recibido')
  assert.equal(derivarWhop({}, 'x'), null, 'un sobre sin tipo no se entiende')
  assert.equal(derivarHotmart({}, 'x'), null)
})

test('el comprador se extrae normalizado y el toque lee las UTMs si el payload las trae', () => {
  const h = compradorHotmart(hotmartCompra)
  assert.equal(h.email, 'maria.example@gmail.com', 'el email se normaliza a minúsculas')
  assert.equal(h.fullName, 'María García')

  const w = compradorWhop(whopPago)
  assert.equal(w.email, 'marcus.example@whop.com')
  assert.equal(w.phone, '+15551112345')

  // UTMs: si Hotmart/Whop las mandan (hoy o mañana), leerToque las encuentra a través del
  // reesculpido del motor. Si no las traen, toque vacío ⇒ sin escritura (cero consultas).
  const conUtm = { data: { utm_source: 'ig', utm_medium: 'bio' } }
  const toque = toqueDesdePayloadHotmart(conUtm)
  assert.equal(toque.utm_source, 'ig')
  const toqueWhop = toqueDesdePayloadWhop(whopPago)
  assert.equal(toqueWhop.utm_source, undefined, 'sin UTMs en el payload, no se inventa ninguna')
  const origenHotmart = toqueDesdePayloadHotmart({
    data: { purchase: { origin: { src: 'meta', sck: 'anuncio-42', xcod: 'fallback' } } },
  })
  assert.equal(origenHotmart.utm_source, 'meta')
  assert.equal(origenHotmart.utm_content, 'anuncio-42')
})

test('el hecho canónico respeta la fecha que decide la derivación', () => {
  const conOverride = hechoDesdeSobre({
    tenantId: 't',
    source: 'hotmart',
    sourceEventId: 'evt_1',
    rawEventId: 'r1',
    tipo: 'hotmart.compra.aprobada',
    payload: {},
    recibidoEn: '2026-10-07T00:00:00.000Z',
    propiedades: {},
    ocurridoEn: '2026-10-06T12:00:00.000Z',
  })
  assert.equal(conOverride.occurred_at, '2026-10-06T12:00:00.000Z')
  // Sin override: la heurística genérica de siempre (recibidoEn si el payload no dice fecha).
  const sinOverride = hechoDesdeSobre({
    tenantId: 't',
    source: 'whop',
    sourceEventId: 'msg_1',
    rawEventId: 'r1',
    tipo: 'whop.pago.recibido',
    payload: {},
    recibidoEn: '2026-10-07T00:00:00.000Z',
    propiedades: {},
  })
  assert.equal(sinOverride.occurred_at, '2026-10-07T00:00:00.000Z')
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CONTRATO DE LAS RUTAS Y DEL MOTOR. Mismo endurecimiento que el webhook de Stripe: el cuerpo
// crudo antes de todo, la firma antes de parsear, el secreto POR SUBCUENTA (nunca del entorno),
// 401 opaco y uniforme, idempotencia en base y NINGUNA escritura de ventas ni cobros.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const RUTA_HOTMART = 'app/api/[tenant]/evergreen/webhooks/hotmart/route.ts'
const RUTA_WHOP = 'app/api/[tenant]/evergreen/webhooks/whop/route.ts'
const MOTOR = 'lib/webhooks/entradaCompras.ts'

for (const [ruta, fuente, verificar] of [
  [RUTA_HOTMART, 'hotmart', 'verificarFirmaHotmart'],
  [RUTA_WHOP, 'whop', 'verificarFirmaWhop'],
]) {
  test(`${fuente}: la ruta es fina y delega en el motor compartido`, () => {
    const src = codigo(ruta)
    assert.match(src, new RegExp(`fuente: '${fuente}'`))
    assert.match(src, new RegExp(verificar))
    assert.match(src, /procesarEntradaCompra\(\{/)
    // La ruta no parsea ni decide nada por su cuenta: el motor es la única implementación.
    assert.doesNotMatch(src, /JSON\.parse/)
    assert.match(src, /export const runtime = 'nodejs'/)
  })
}

test('el motor lee el cuerpo crudo antes de parsearlo y verifica la firma antes de tocar el payload', () => {
  const src = codigo(MOTOR)
  const crudo = src.indexOf('const crudo = await req.text()')
  const verificar = src.indexOf('= verificar(')
  const parsear = src.indexOf('JSON.parse(crudo)')
  assert.ok(crudo > -1 && parsear > -1)
  assert.ok(crudo < parsear, 'el crudo se lee antes de parsear')
  assert.ok(verificar > -1 && verificar < parsear, 'la firma se verifica antes del parseo')
  assert.doesNotMatch(src, /req\.json\(\)/)
})

test('el secreto del webhook es por subcuenta y nunca viene del entorno', () => {
  const src = codigo(MOTOR)
  assert.match(src, /getTenantConfigWithFallback\(tenantId, true\)/)
  assert.doesNotMatch(src, /process\.env\.(HOTMART|WHOP)_WEBHOOK_SECRET/)
  // Y las claves existen en el catálogo como secretos, pero NO son obligatorias del grupo: el
  // cotejo por API funciona sin webhook (igual criterio que Stripe).
  for (const [grupoId, clave] of [
    ['hotmart', 'HOTMART_WEBHOOK_SECRET'],
    ['whop', 'WHOP_WEBHOOK_SECRET'],
  ]) {
    const g = INTEGRATION_GROUPS.find((x) => x.id === grupoId)
    assert.ok(g, `grupo ${grupoId} en el catálogo`)
    const campo = g.fields.find((f) => f.key === clave)
    assert.ok(campo, `${clave} declarado`)
    assert.equal(campo.secret, true)
    assert.equal(campo.type, 'password')
    assert.ok(!g.required?.includes(clave), `${clave} no es obligatorio: el cotejo funciona sin webhook`)
    // La dirección del webhook enseñada apunta a una ruta real y su doc existe.
    const fichero = join(root, 'app', g.webhookPath.replace('{tenant}', '[tenant]'), 'route.ts')
    assert.ok(existsSync(fichero), `${grupoId}: ${g.webhookPath} existe`)
  }
})

test('el motor responde 401 uniforme (sin oráculo de subcuentas) y registra el rechazo sin guardar el cuerpo', () => {
  const src = codigo(MOTOR)
  const rechazos = [...src.matchAll(/error: 'Firma inválida'[\s\S]{0,60}status: 401/g)]
  assert.ok(rechazos.length >= 2, 'subcuenta inexistente y firma inválida responden IGUAL')
  const bloque = src.slice(src.indexOf('if (!firma.valida)'), src.indexOf('const ahora'))
  assert.match(bloque, /_firma_rechazada: true/)
  assert.match(bloque, /Firma rechazada/)
  // El cuerpo de un remitente NO verificado no se guarda (solo su longitud).
  assert.doesNotMatch(bloque, /payload:\s*(crudo|payload)/)
  assert.match(bloque, /payload_bytes: crudo\.length/)
})

test('el motor encaja el contacto por email, estampa venta/canal solo al crear y registra la atribución', () => {
  const src = codigo(MOTOR)
  assert.match(src, /getOrCreateContact/)
  assert.match(src, /leadStatus: 'venta'/)
  assert.match(src, /leadChannel: fuente/)
  assert.match(src, /atribuirDesdePayload/)
  assert.match(src, /enEl: derivado\.ocurridoEn/, 'el toque lleva la fecha real del hecho')
  // Y el hecho canónico con la fecha de la derivación y la contactId de la proyección.
  assert.match(src, /ocurridoEn: derivado\.ocurridoEn/)
})

test('el motor NO escribe ventas ni cobros: el mapeo de producto es decisión humana', () => {
  const src = codigo(MOTOR)
  assert.doesNotMatch(src, /from\('sales'\)/)
  assert.doesNotMatch(src, /from\('collections'\)/)
  assert.match(src, /mueve_dinero: derivado\.clase === 'dinero'/)
})

test('el motor es idempotente en base: el reintento UPSERTEA el sobre y sana el parcial', () => {
  const src = codigo(MOTOR)
  assert.match(src, /onConflict: 'tenant_id,source,source_event_id', ignoreDuplicates: false/)
  // El cierre del sobre pasa por el mismo camino (todas las salidas cierran su estado).
  assert.match(src, /processing_status: fallo \? 'rejected' : 'normalized'/)
  assert.match(src, /duplicado: Boolean\(sobrePrevio\)/)
  assert.match(
    src,
    /if \(!hechoEscrito\) return responder\(\{ error: 'No se pudo registrar el hecho canónico' \}, 500\)/,
    'un fallo del hecho canónico devuelve 500 para que el proveedor reintente y sane el parcial'
  )
})

test('el catálogo declara los webhooks entrantes con evidencia real y doc existente', () => {
  for (const id of ['hotmart', 'whop']) {
    const w = WEBHOOKS_ENTRANTES.find((x) => x.id === id)
    assert.ok(w, `${id} en WEBHOOKS_ENTRANTES`)
    assert.match(w.evidencia, /^raw_/)
    assert.ok(w.doc && existsSync(join(root, w.doc.slice(1))), `${id}: la doc enlazada existe (${w.doc})`)
    // La evidencia es raw_events: el estado de recepción solo puede salir de recepciones reales.
    const src = codigo(MOTOR)
    assert.match(src, /from\('raw_events'\)/)
  }
})
