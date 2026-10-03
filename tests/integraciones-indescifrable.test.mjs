// Aviso de credenciales indescifrables en Integraciones (lección GHL del 29-sep).
//
// Al rotar CONFIG_ENC_KEY, los valores guardados con la clave anterior quedan muertos: el runtime
// los descarta en silencio y TODO el código ve "faltan credenciales". El detector (lib/config.ts)
// los delata y el panel los señala. Se prueban las dos piezas:
//   1. `esIndescifrable` PURO: cifrar con la clave A no es descifrable con la clave B, y sí con la A.
//   2. El FUENTE del GET: marca `indescifrable` en el estado y lo sube como `clavesIndescifrables`.
// ||= y no ??= (hermeticidad; ver ghl-conversaciones-metricas.test.mjs)
process.env.CONFIG_ENC_KEY ||= 'clave-de-test-para-roundtrip'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://supafake.local'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'clave-de-test'

import assert from 'node:assert/strict'
import test from 'node:test'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encryptSecret, esIndescifrable } from '../lib/config.ts'

const aqui = dirname(fileURLToPath(import.meta.url))
const lee = (p) => readFileSync(join(aqui, '..', p), 'utf8')

test('esIndescifrable: cifrar con A y comprobar con A no es indescifrable', () => {
  const v = encryptSecret('pit-token-real')
  assert.equal(esIndescifrable(v), false)
})

test('esIndescifrable: cifrado con otra CONFIG_ENC_KEY sí lo es', () => {
  // Simula la rotación: cifra con la clave B y comprueba con la A del import — GCM debe
  // rechazar la autenticación, igual que el token huérfano de GHL.
  const keyB = createHash('sha256').update('clave-B-distinta', 'utf8').digest()
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keyB, iv)
  const enc = Buffer.concat([c.update('valor-de-la-key-anterior', 'utf8'), c.final()])
  const huérfano = 'enc:v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')
  assert.equal(esIndescifrable(huérfano), true)
})

test('esIndescifrable: vacío, en claro y basura no indescifrable (no confunde estados)', () => {
  assert.equal(esIndescifrable(null), false)
  assert.equal(esIndescifrable(''), false)
  assert.equal(esIndescifrable('token-en-claro-viejo'), false, 'los valores pre-cifrado no se marcan')
  assert.equal(esIndescifrable('enc:v1:no-es-base64-valida'), true, 'basura con prefijo: GCM falla')
})

test('el GET de Integraciones marca el campo y sube la lista al front', () => {
  const fuente = lee('app/api/[tenant]/evergreen/settings/integraciones/route.ts')
  assert.match(fuente, /esIndescifrable\(inDb\)/, 'el estado se calcula con el detector')
  assert.match(fuente, /indescifrable: true/, 'el estado marca el campo')
  assert.match(fuente, /clavesIndescifrables/, 'la respuesta sube la lista')
  const ui = lee('app/[tenant]/settings/integraciones/page.tsx')
  assert.match(ui, /clavesIndescifrables/, 'la UI consume la lista')
  assert.match(ui, /indescifrable — vuelve a pegarlo/, 'badge rojo con la acción concreta')
  assert.match(ui, /Vuelve a pegarlas aquí/, 'banner con la acción concreta')
})
