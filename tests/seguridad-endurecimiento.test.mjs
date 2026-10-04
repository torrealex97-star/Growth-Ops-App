import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { rutaInternaSegura } from '../lib/security/redirect.ts'
import { esUrlPublicaSegura } from '../lib/security/safe-url.ts'
import { ipDe, limitar, reiniciarLimitador } from '../lib/security/rate-limit.ts'

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('rutaInternaSegura solo deja pasar rutas de esta app', () => {
  const d = '/t/dashboard'
  assert.equal(rutaInternaSegura('/t/settings/password', d), '/t/settings/password')
  assert.equal(rutaInternaSegura('/t/x?y=1#z', d), '/t/x?y=1#z')
  for (const malo of [
    '@evil.com',
    '//evil.com',
    '/\\evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    '/a\nb',
    '',
    null,
    undefined,
    'evil.com',
    '/%0d%0a'.replace('%0d%0a', '\r\n'),
  ]) {
    assert.equal(rutaInternaSegura(malo, d), d, String(malo))
  }
})

test('esUrlPublicaSegura bloquea localhost, redes privadas, metadatos y esquemas raros', () => {
  assert.equal(esUrlPublicaSegura('https://cdn.example.com/a.png'), true)
  for (const mala of [
    'http://cdn.example.com/a.png',
    'https://localhost/a',
    'https://127.0.0.1/a',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.5/a',
    'https://192.168.1.1/a',
    'https://172.20.0.1/a',
    'https://[::1]/a',
    'https://[fd00::1]/a',
    'https://user:pass@example.com/a',
    'https://2130706433/a',
    'https://0x7f000001/a',
    'https://db.internal/a',
    'file:///etc/passwd',
    'no es url',
  ]) {
    assert.equal(esUrlPublicaSegura(mala), false, mala)
  }
})

test('limitar corta tras el máximo y se reabre al acabar la ventana', () => {
  reiniciarLimitador()
  const t0 = 1_000_000
  for (let i = 0; i < 3; i++) assert.equal(limitar('k', 3, 60_000, t0 + i).ok, true)
  const r = limitar('k', 3, 60_000, t0 + 10)
  assert.equal(r.ok, false)
  assert.ok(r.reintentarEnSeg > 0)
  assert.equal(limitar('k', 3, 60_000, t0 + 60_001).ok, true)
  assert.equal(limitar('otra', 3, 60_000, t0 + 10).ok, true)
  assert.equal(ipDe({ get: (n) => (n === 'x-forwarded-for' ? '1.2.3.4, 5.6.7.8' : null) }), '1.2.3.4')
})

test('el callback de auth no redirige a `next` sin validar', () => {
  const s = leer('app/api/[tenant]/evergreen/auth/callback/route.ts')
  assert.match(s, /rutaInternaSegura\(searchParams\.get\('next'\)/)
  assert.doesNotMatch(s, /searchParams\.get\('next'\) \?\?/)
})

test('recuperación y firma pública llevan limitador; el chat de carruseles valida la URL', () => {
  assert.match(leer('app/api/[tenant]/evergreen/auth/recover/route.ts'), /limitar\(`recover:ip:/)
  assert.match(leer('app/api/public-contracts/sign/[token]/route.ts'), /limitar\(`firma:/)
  assert.match(leer('app/api/public-contracts/sign-student/[token]/route.ts'), /limitar\(`firma:/)
  assert.match(leer('app/api/[tenant]/evergreen/carruseles/chat/route.ts'), /esUrlPublicaSegura\(url\)/)
})

test('next.config pone cabeceras de seguridad y deja /embed enmarcable', () => {
  const s = leer('next.config.js')
  assert.match(s, /X-Content-Type-Options/)
  assert.match(s, /frame-ancestors 'self'/)
  assert.match(s, /\(\?!embed\|tracker/)
})
