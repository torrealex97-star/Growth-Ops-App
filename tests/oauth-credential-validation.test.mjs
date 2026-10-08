import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  isGoogleOAuthClientId,
  isMetaAppId,
  oauthCredentialValidationError,
} from '../lib/integrations/oauth-credentials.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('acepta identificadores OAuth reales y rechaza credenciales de login autocompletadas', () => {
  assert.equal(isGoogleOAuthClientId('1234567890-example.apps.googleusercontent.com'), true)
  assert.equal(isGoogleOAuthClientId('person@example.com'), false)
  assert.equal(isGoogleOAuthClientId('not-a-client-id'), false)
  assert.equal(isMetaAppId('123456789012345'), true)
  assert.equal(isMetaAppId('person@example.com'), false)
})

test('la validación de guardado señala la clave concreta sin devolver el secreto', () => {
  assert.match(oauthCredentialValidationError({ GOOGLE_CLIENT_ID: 'person@example.com' }) || '', /GOOGLE_CLIENT_ID/)
  assert.match(oauthCredentialValidationError({ YOUTUBE_CLIENT_ID: 'person@example.com' }) || '', /YOUTUBE_CLIENT_ID/)
  assert.match(oauthCredentialValidationError({ META_APP_ID: 'person@example.com' }) || '', /META_APP_ID/)
  assert.equal(
    oauthCredentialValidationError({
      GOOGLE_CLIENT_ID: '123-example.apps.googleusercontent.com',
      YOUTUBE_CLIENT_ID: '456-example.apps.googleusercontent.com',
      META_APP_ID: '123456789012345',
    }),
    null
  )
})

test('los campos de integración bloquean el autofill de gestores de contraseñas', () => {
  const page = read('app/[tenant]/settings/integraciones/page.tsx')
  assert.match(page, /name=\{`integration-\$\{f\.key\}`\}/)
  assert.match(page, /name=\{`integration-\$\{field\.key\}`\}/)
  assert.match(page, /autoComplete=\{f\.secret \? 'new-password' : 'off'\}/)
  assert.match(page, /data-1p-ignore/)
  assert.match(page, /data-lpignore="true"/)
})

test('los inicios OAuth rechazan IDs guardados con formato inválido', () => {
  const google = read('lib/google/oauth.ts')
  const meta = read('app/api/[tenant]/evergreen/oauth/meta/start/route.ts')
  assert.match(google, /isGoogleOAuthClientId\(clientId\)/)
  assert.match(meta, /isMetaAppId\(appId\)/)
})
