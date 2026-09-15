import assert from 'node:assert/strict'
import test from 'node:test'
import { CHECK_TTL_MS, FIXES, assessIntegration, fixFor, isStale } from '../../lib/integrations/health.ts'

const AHORA = Date.parse('2026-09-13T12:00:00Z')
const hace = (ms) => new Date(AHORA - ms).toISOString()

// Facts mínimos: sin rutas programadas ni pg_cron, todo a cero, para que cada test declare solo lo
// que le importa.
const facts = (over = {}) => ({
  configuredKeys: new Set(over.keys ?? []),
  rowCounts: over.rowCounts ?? {},
  vercelScheduled: new Set(over.vercel ?? []),
  pgCronReady: over.pgCronReady ?? false,
})

const grupo = (over = {}) => ({
  id: over.id ?? 'calendly',
  required: over.required ?? ['CALENDLY_API_TOKEN'],
  testable: true,
})

// EL INVARIANTE QUE JUSTIFICA EL MÓDULO. Que exista el token no es que la integración funcione. Un
// verde por tener la credencial escrita es la misma mentira que tuvo "Meta: conectado" durante meses
// mientras nadie ejecutaba sus crons.
test('tener la credencial escrita NO pinta verde', () => {
  const h = assessIntegration(grupo(), { facts: facts({ keys: ['CALENDLY_API_TOKEN'] }), lastCheck: null, now: AHORA })
  assert.equal(h.status, 'sin_configurar', 'sin comprobar contra la API no puede salir conectada')
  assert.match(h.headline, /Sin comprobar/)
  assert.ok(h.fix, 'un estado gris sin salida deja al usuario atascado')
})

test('sin la credencial dice exactamente qué falta', () => {
  const h = assessIntegration(
    { id: 'ghl', required: ['GHL_API_TOKEN', 'GHL_LOCATION_ID', 'GHL_WEBHOOK_SECRET'], testable: true },
    { facts: facts({ keys: ['GHL_API_TOKEN'] }), now: AHORA }
  )
  assert.equal(h.status, 'sin_configurar')
  assert.deepEqual(h.missingKeys, ['GHL_LOCATION_ID', 'GHL_WEBHOOK_SECRET'])
  assert.match(h.detail, /2 de 3/, 'no dice cuánto queda por rellenar')
  assert.match(h.fix, /GHL_LOCATION_ID/)
})

test('una integración puede aceptar una de varias credenciales alternativas', () => {
  const ai = { id: 'alternativas', requiredAny: ['DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY'], testable: true }
  const sinMotor = assessIntegration(ai, { facts: facts({ keys: [] }), lastCheck: null, now: AHORA })
  assert.equal(sinMotor.status, 'sin_configurar')
  assert.deepEqual(sinMotor.missingKeys, ['DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY'])

  const conDeepSeek = assessIntegration(ai, {
    facts: facts({ keys: ['DEEPSEEK_API_KEY'] }),
    lastCheck: { ok: true, message: 'DeepSeek conectado.', checkedAt: hace(1000) },
    now: AHORA,
  })
  assert.equal(conDeepSeek.status, 'conectada')
  assert.deepEqual(conDeepSeek.missingKeys, [])
})

test('una comprobación correcta y reciente sí pinta verde', () => {
  const h = assessIntegration(grupo(), {
    facts: facts({ keys: ['CALENDLY_API_TOKEN'] }),
    lastCheck: { ok: true, message: 'Usuario: Alex', checkedAt: hace(60_000) },
    now: AHORA,
  })
  assert.equal(h.status, 'conectada')
  assert.equal(h.stale, false)
  assert.match(h.detail, /Alex/)
})

// Los tokens caducan, se rotan y se revocan sin avisar: un verde de hace tres días no es información
// sobre hoy.
test('una comprobación caducada vuelve a gris', () => {
  const h = assessIntegration(grupo(), {
    facts: facts({ keys: ['CALENDLY_API_TOKEN'] }),
    lastCheck: { ok: true, message: 'OK', checkedAt: hace(CHECK_TTL_MS + 1000) },
    now: AHORA,
  })
  assert.equal(h.status, 'sin_configurar')
  assert.equal(h.stale, true)
  assert.match(h.detail, /caducan/)
})

test('isStale trata una fecha ausente o ilegible como no comprobada', () => {
  assert.equal(isStale(null, AHORA), true)
  assert.equal(isStale('ayer por la tarde', AHORA), true, 'inventarse que está fresca es lo único peor')
  assert.equal(isStale(hace(1000), AHORA), false)
})

test('una comprobación fallida pinta rojo, con motivo y arreglo', () => {
  const h = assessIntegration(grupo(), {
    facts: facts({ keys: ['CALENDLY_API_TOKEN'] }),
    lastCheck: { ok: false, message: 'Token inválido', checkedAt: hace(1000), code: 'token_invalido' },
    now: AHORA,
  })
  assert.equal(h.status, 'error')
  assert.match(h.detail, /Token inválido/)
  assert.match(h.fix, /Genera una nueva/)
})

// El fallo real que originó todo esto: credenciales perfectas, API respondiendo, y los datos no
// llegaban porque NADIE ejecutaba el cron. Eso tiene que ser rojo, no verde.
test('credenciales buenas pero sincronización sin planificador es rojo', () => {
  const h = assessIntegration(
    { id: 'meta', required: ['META_ACCESS_TOKEN'], testable: true },
    {
      facts: facts({ keys: ['META_ACCESS_TOKEN'], rowCounts: { campaigns: 0 } }),
      lastCheck: { ok: true, message: '2 cuentas', checkedAt: hace(1000) },
      now: AHORA,
    }
  )
  assert.equal(h.status, 'error')
  assert.match(h.headline, /sin sincronizar/)
  assert.match(h.detail, /vercel\.json|pg_cron/)
  // Y no se le echa la culpa al usuario por algo que no puede arreglar desde su pantalla.
  assert.match(h.fix, /no es de tus credenciales|administra la plataforma/)
})

// Una integración recién conectada no tiene datos todavía. Bajarle la luz por eso haría que el
// usuario toquetease credenciales que están perfectas.
test('recién conectada y sin datos sigue siendo verde, pero lo dice', () => {
  const h = assessIntegration(
    { id: 'meta', required: ['META_ACCESS_TOKEN'], testable: true },
    {
      facts: facts({
        keys: ['META_ACCESS_TOKEN'],
        rowCounts: { campaigns: 0, campaign_daily: 0, campaign_ads: 0 },
        vercel: ['cron/meta', 'cron/meta-daily', 'cron/meta-ads'],
      }),
      lastCheck: { ok: true, message: 'Cuenta: Evergreen.', checkedAt: hace(1000) },
      now: AHORA,
    }
  )
  assert.equal(h.status, 'conectada')
  assert.match(h.detail, /Todavía no ha traído datos/)
})

test('con datos y comprobada, el detalle no inventa problemas', () => {
  const h = assessIntegration(
    { id: 'meta', required: ['META_ACCESS_TOKEN'], testable: true },
    {
      facts: facts({
        keys: ['META_ACCESS_TOKEN'],
        rowCounts: { campaigns: 12, campaign_daily: 340, campaign_ads: 90 },
        vercel: ['cron/meta', 'cron/meta-daily', 'cron/meta-ads'],
      }),
      lastCheck: { ok: true, message: 'Cuenta: Evergreen.', checkedAt: hace(1000) },
      now: AHORA,
    }
  )
  assert.equal(h.status, 'conectada')
  assert.doesNotMatch(h.detail, /Todavía no/)
  assert.equal(h.syncs.length, 3, 'las tres sincronizaciones de Meta deberían evaluarse')
})

// El mensaje lo escribe la API externa y cambia sin avisar; el código lo pone nuestro comprobador.
test('el arreglo se elige por código, no parseando el mensaje', () => {
  assert.equal(fixFor('token_invalido', 'meta'), FIXES.token_invalido)
  assert.equal(fixFor(undefined, 'meta'), FIXES['meta:generico'])
  assert.equal(fixFor('codigo_que_no_existe', 'stripe'), FIXES['stripe:generico'])
  assert.equal(fixFor(undefined, 'grupo_sin_arreglo'), undefined, 'no se inventa un arreglo genérico')
  for (const [code, texto] of Object.entries(FIXES)) {
    assert.ok(texto.length > 30, `el arreglo de ${code} no dice qué hacer`)
  }
})
