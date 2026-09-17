import assert from 'node:assert/strict'
import test from 'node:test'

// Helpers puros de la ingesta del pixel — testeados sin red ni BD.
const { classifyBot, originAllowed, newPublicKey, hashIp, isValidEventName, MinuteRateLimiter, deriveChannel } =
  await import('../lib/tracking/ingest.ts')

test('classifyBot: tres estados, nunca booleano', () => {
  assert.equal(classifyBot('Mozilla/5.0 (Macintosh) Chrome/120'), 'likely_human')
  assert.equal(classifyBot('Mozilla/5.0 compatible; Googlebot/2.1'), 'likely_bot')
  assert.equal(classifyBot('curl/8.4.0'), 'likely_bot')
  assert.equal(classifyBot('python-requests/2.31'), 'likely_bot')
  // Sin UA no es un bot: es desconocido.
  assert.equal(classifyBot(null), 'unknown')
  assert.equal(classifyBot('   '), 'unknown')
  assert.equal(classifyBot('AlgoRaro/1.0'), 'unknown')
})

test('originAllowed: allowlist exacta y localhost solo con permiso', () => {
  const origins = ['https://womendigitalclosers.com']
  assert.equal(originAllowed('https://womendigitalclosers.com', origins, false), true)
  assert.equal(originAllowed('https://womendigitalclosers.com/', origins, false), true)
  assert.equal(originAllowed('https://evil.example', origins, false), false)
  // Subdominio NO autorizado por la base (allowlist explícita)
  assert.equal(originAllowed('https://www.womendigitalclosers.com', origins, false), false)
  assert.equal(originAllowed('http://localhost:3000', origins, false), false)
  assert.equal(originAllowed('http://localhost:3000', origins, true), true)
  assert.equal(originAllowed('http://127.0.0.1:3000', origins, true), true)
  // Origin null (same-origin): permitido; en cross-origin el navegador siempre manda Origin.
  assert.equal(originAllowed(null, origins, false), true)
})

test('newPublicKey: formato exacto del constraint gop_pk_', () => {
  for (let i = 0; i < 20; i++) {
    assert.match(newPublicKey(), /^gop_pk_[A-Za-z0-9_-]{40}$/)
  }
  assert.notEqual(newPublicKey(), newPublicKey())
})

test('hashIp: determinista, dependiente de la sal y no conserva la IP', () => {
  assert.equal(hashIp('1.2.3.4', 's1'), hashIp('1.2.3.4', 's1'))
  assert.notEqual(hashIp('1.2.3.4', 's1'), hashIp('1.2.3.4', 's2'))
  assert.notEqual(hashIp('1.2.3.4', 's1'), hashIp('1.2.3.5', 's1'))
  assert.equal(hashIp(null, 's1'), null)
  assert.match(hashIp('1.2.3.4', 's1'), /^[0-9a-f]{8}$/)
})

test('isValidEventName: snake_case del allowlist', () => {
  assert.equal(isValidEventName('page_view'), true)
  assert.equal(isValidEventName('appointment_booked'), true)
  assert.equal(isValidEventName('PageView'), false)
  assert.equal(isValidEventName('x'), false)
  assert.equal(isValidEventName('2bad'), false)
  assert.equal(isValidEventName('con espacios'), false)
})

test('MinuteRateLimiter: corta al límite y resetea la ventana', () => {
  const lim = new MinuteRateLimiter(60_000)
  for (let i = 0; i < 3; i++) assert.equal(lim.allow('k', 3, 1_000), true)
  assert.equal(lim.allow('k', 3, 2_000), false)
  assert.equal(lim.allow('otra', 3, 2_000), true)
  assert.equal(lim.allow('k', 3, 61_001), true)
})

test('deriveChannel: utm > referrer social > google > host > direct', () => {
  assert.equal(deriveChannel('meta', null), 'meta')
  assert.equal(deriveChannel(null, 'https://l.instagram.com/x'), 'instagram')
  assert.equal(deriveChannel(null, 'https://www.google.com/'), 'google')
  assert.equal(deriveChannel(null, 'https://blog.ejemplo.com/post'), 'blog.ejemplo.com')
  assert.equal(deriveChannel(null, null), 'direct')
  assert.equal(deriveChannel('', 'no-es-una-url'), 'referral')
})
