import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Meta e Instagram tienen OAuth nativo con callback firmado y alternativa manual', () => {
  const page = read('app/[tenant]/settings/integraciones/page.tsx')
  const start = read('app/api/[tenant]/evergreen/oauth/meta/start/route.ts')
  const callback = read('app/api/oauth/meta/callback/route.ts')
  const state = read('lib/meta/oauth-state.ts')

  assert.match(page, /oauth\/meta\/start\?surface=\$\{g\.id\}/)
  assert.match(page, /El token manual sigue disponible como alternativa/)
  assert.match(start, /requireTenant\(tenant\)/)
  assert.match(start, /signMetaState/)
  assert.match(callback, /verifyMetaState/)
  assert.match(callback, /session\.userId !== userId/)
  assert.match(callback, /encryptSecret\(token\.access_token\)/)
  assert.match(state, /timingSafeEqual/)
})

test('los permisos de anuncios e Instagram están separados y el token largo es obligatorio', () => {
  const oauth = read('lib/meta/oauth.ts')
  assert.match(oauth, /meta: \['ads_read'\]/)
  assert.match(oauth, /instagram_basic/)
  assert.match(oauth, /instagram_manage_insights/)
  assert.match(oauth, /fb_exchange_token/)
  assert.match(oauth, /AbortSignal\.timeout/)
  assert.match(oauth, /instagram_business_account\{id,username\}/)
  assert.match(oauth, /Authorization: `Bearer \$\{accessToken\}`/)
})

test('Instagram solo se autoselecciona cuando Meta devuelve exactamente una cuenta profesional', () => {
  const callback = read('app/api/oauth/meta/callback/route.ts')
  assert.match(callback, /accounts\.length === 1/)
  assert.match(callback, /IG_USER_ID/)
  assert.match(callback, /IG_PAGE_ID/)
  assert.match(callback, /instagramNeedsSelection = true/)
})

test('el callback de Meta es público solo porque se autentica con state y sesión', () => {
  const middleware = read('middleware.ts')
  assert.match(middleware, /'\/api\/oauth\/meta\/callback'/)
})
