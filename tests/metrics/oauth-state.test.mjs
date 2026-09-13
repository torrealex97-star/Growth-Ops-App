import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

// La clave se deriva de CONFIG_ENC_KEY, así que hay que fijarla antes de importar el módulo.
process.env.CONFIG_ENC_KEY = 'clave-de-prueba-solo-para-tests'
const { signState, verifyState, STATE_TTL_MS } = await import('../../lib/google/oauth-state.ts')

test('un state firmado se verifica y conserva la subcuenta y el proveedor', () => {
  const state = signState({ tenant: 'evergreen', provider: 'ga4' })
  const r = verifyState(state)
  assert.equal(r.ok, true)
  assert.equal(r.payload.tenant, 'evergreen')
  assert.equal(r.payload.provider, 'ga4')
})

// El ataque que esto impide: el callback no lleva la subcuenta en la ruta, así que si el state no
// estuviera firmado, cualquiera podría reclamar ser otra subcuenta y guardar SU token de Google
// como la conexión de esa subcuenta.
test('un state manipulado para cambiar de subcuenta se rechaza', () => {
  const state = signState({ tenant: 'evergreen', provider: 'ga4' })
  const [body] = state.split('.')
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  payload.tenant = 'women-digital-closer'
  const falso = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const r = verifyState(`${falso}.${state.split('.')[1]}`)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'firma')
})

test('un state inventado sin firma válida se rechaza', () => {
  const payload = Buffer.from(JSON.stringify({ tenant: 'x', provider: 'ga4', iat: Date.now() })).toString('base64url')
  assert.equal(verifyState(`${payload}.firmafalsa`).ok, false)
  assert.equal(verifyState('sinpunto').ok, false)
  assert.equal(verifyState('').ok, false)
  assert.equal(verifyState(null).ok, false)
  assert.equal(verifyState(undefined).ok, false)
  assert.equal(verifyState('a.').ok, false)
  assert.equal(verifyState('.b').ok, false)
})

test('un mac de longitud distinta da "firma", no una excepción', () => {
  // crypto.timingSafeEqual lanza si las longitudes no coinciden: hay que comprobarlo antes.
  const state = signState({ tenant: 'evergreen', provider: 'ga4' })
  const r = verifyState(`${state.split('.')[0]}.${Buffer.from('corto').toString('base64url')}`)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'firma')
})

test('un state caducado se rechaza aunque la firma sea buena', () => {
  const state = signState({ tenant: 'evergreen', provider: 'ga4' })
  const justo = verifyState(state, Date.now() + STATE_TTL_MS - 1000)
  assert.equal(justo.ok, true, 'dentro de la ventana debe valer')
  const pasado = verifyState(state, Date.now() + STATE_TTL_MS + 1000)
  assert.equal(pasado.ok, false)
  assert.equal(pasado.reason, 'caducado')
})

test('un state emitido en el futuro se rechaza', () => {
  // Indica un reloj manipulado o un state fabricado, no un flujo legítimo.
  const state = signState({ tenant: 'evergreen', provider: 'ga4' })
  const r = verifyState(state, Date.now() - 10 * 60 * 1000)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'caducado')
})

test('un proveedor no reconocido se rechaza: un flujo de GA4 no puede guardarse como Gmail', () => {
  const state = signState({ tenant: 'evergreen', provider: 'ga4' })
  const [body, mac] = state.split('.')
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  payload.provider = 'drive'
  // Se re-firma con la MISMA clave para probar la validación de contenido, no la de firma.
  const nuevoBody = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const key = crypto.createHmac('sha256', process.env.CONFIG_ENC_KEY).update('oauth-state-v1').digest()
  const nuevoMac = crypto.createHmac('sha256', key).update(nuevoBody).digest().toString('base64url')
  assert.notEqual(nuevoMac, mac)
  const r = verifyState(`${nuevoBody}.${nuevoMac}`)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'contenido')
})

test('dos states del mismo flujo no son iguales (nonce)', () => {
  const a = signState({ tenant: 'evergreen', provider: 'ga4' })
  const b = signState({ tenant: 'evergreen', provider: 'ga4' })
  assert.notEqual(a, b)
})
