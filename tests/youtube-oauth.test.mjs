import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('YouTube usa el callback OAuth firmado de la app, no OAuth Playground ni códigos pegados', () => {
  const oauth = read('lib/google/oauth.ts')
  const state = read('lib/google/oauth-state.ts')
  const start = read('app/api/[tenant]/evergreen/oauth/google/start/route.ts')
  const ui = read('app/[tenant]/settings/integraciones/page.tsx')

  assert.match(oauth, /GoogleProvider = 'ga4' \| 'gmail' \| 'calendar' \| 'youtube'/)
  assert.match(oauth, /youtube\.upload/)
  assert.match(oauth, /youtube\.readonly/)
  assert.match(state, /provider: 'ga4' \| 'gmail' \| 'calendar' \| 'youtube'/)
  assert.match(start, /provider !== 'youtube'/)
  assert.match(ui, /oauth\/google\/start\?provider=youtube/)
  assert.doesNotMatch(ui, /oauthplayground|YOUTUBE_OAUTH_CODE|youtube-exchange/)
})

test('el callback guarda el refresh token de YouTube cifrado bajo el contrato existente', () => {
  const callback = read('app/api/oauth/google/callback/route.ts')
  assert.match(callback, /provider === 'youtube'/)
  assert.match(callback, /key: 'YOUTUBE_REFRESH_TOKEN'/)
  assert.match(callback, /value: encryptSecret\(token\.refresh_token\)/)
  assert.match(callback, /updated_by: userId/)
  assert.match(callback, /onConflict: 'tenant_id,key'/)
})

test('YouTube usa sus credenciales históricas y el resto el cliente común de Google', () => {
  const oauth = read('lib/google/oauth.ts')
  assert.match(oauth, /provider === 'youtube' \? cfg\.YOUTUBE_CLIENT_ID : cfg\.GOOGLE_CLIENT_ID/)
  assert.match(oauth, /provider === 'youtube' \? cfg\.YOUTUBE_CLIENT_SECRET : cfg\.GOOGLE_CLIENT_SECRET/)
})

test('el cliente de YouTube ya no conserva OAuth Playground como redirect heredado', () => {
  const client = read('lib/youtube/client.ts')
  assert.match(client, /googleRedirectUri\(\)/)
  assert.doesNotMatch(client, /oauthplayground/)
})
