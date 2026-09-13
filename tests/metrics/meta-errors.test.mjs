import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyMetaError } from '../../lib/meta/errors.ts'

const meta = (code, sub, message = 'algo') => ({ error: { code, error_subcode: sub, message } })

// "No conecta" no es un diagnóstico. Meta dice EXACTAMENTE qué pasa en `code`/`error_subcode`, y son
// tres arreglos distintos: renovar el token, dar un permiso, o corregir la cuenta.
test('un token caducado, uno revocado y uno inválido se distinguen', () => {
  assert.equal(classifyMetaError(meta(190, 463)).code, 'token_caducado')
  assert.equal(classifyMetaError(meta(190, 467)).code, 'token_invalido')
  assert.equal(classifyMetaError(meta(190, 460)).code, 'token_invalido')
  assert.equal(classifyMetaError(meta(190)).code, 'token_invalido')
  assert.match(classifyMetaError(meta(190, 463)).message, /caducado/)
})

test('falta de permisos no se confunde con token inválido', () => {
  for (const code of [10, 200, 294]) {
    assert.equal(classifyMetaError(meta(code)).code, 'sin_permisos')
  }
  // 100 normal es un id que Meta no reconoce; con subcódigo 33, el objeto existe pero el token no lo
  // ve — eso es permisos, y mandar a corregir el id sería mandar al sitio equivocado.
  assert.equal(classifyMetaError(meta(100)).code, 'cuenta_incorrecta')
  assert.equal(classifyMetaError(meta(100, 33)).code, 'sin_permisos')
})

// EL CASO REAL que bloqueaba una cuenta: Meta devuelve código 100 con "Invalid appsecret_proof", y
// sin tratarlo aparte acabábamos diciendo "corrige el identificador de la cuenta" con un
// identificador perfecto. La firma se calcula con el App Secret: el problema es el secreto, no la
// cuenta ni el token.
test('appsecret_proof inválido señala al App Secret, no a la cuenta', () => {
  const body = { error: { code: 100, message: 'Invalid appsecret_proof provided in the API argument' } }
  const causa = classifyMetaError(body, 400)
  assert.equal(causa.code, 'proof_invalido')
  assert.match(causa.message, /App Secret/)
  assert.doesNotMatch(causa.message, /identificador/i, 'no puede mandar a corregir la cuenta')
})

test('los límites de uso no se presentan como una avería', () => {
  for (const code of [4, 17, 32, 613, 80004]) {
    assert.equal(classifyMetaError(meta(code)).code, 'limite_de_uso')
  }
})

test('una versión retirada se dice como tal', () => {
  assert.equal(classifyMetaError(meta(2635)).code, 'version_deprecada')
})

// Cuando Meta escribe un mensaje para el usuario final, es mejor que el nuestro: describe SU caso.
test('el mensaje de Meta para el usuario final tiene prioridad', () => {
  const body = { error: { code: 200, message: 'Permissions error', error_user_msg: 'Pide acceso al Business X.' } }
  assert.match(classifyMetaError(body).message, /Business X/)
})

test('un error de servidor o de red no acusa a la credencial', () => {
  assert.equal(classifyMetaError({}, 500).code, 'red')
  assert.equal(classifyMetaError(meta(1)).code, 'red')
  assert.equal(classifyMetaError(meta(2)).code, 'red')
  // Y lo desconocido se dice desconocido, en vez de inventar una causa.
  assert.equal(classifyMetaError({}, 418).code, 'respuesta_inesperada')
})
