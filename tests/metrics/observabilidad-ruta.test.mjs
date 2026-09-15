import assert from 'node:assert/strict'
import test from 'node:test'
import { nuevoRequestId, normalizarRuta } from '../../lib/observability/peticion.ts'

// ---------------------------------------------------------------------------------------------
// LA RUTA SE NORMALIZA. Sin esto, /contacts/<uuid>/activities sería una etiqueta distinta por cada
// contacto: agrupar errores por ruta no serviría, y además un id de cliente acabaría en un sistema de
// terceros como parte del nombre de la etiqueta.
// ---------------------------------------------------------------------------------------------
test('los identificadores desaparecen de la etiqueta de ruta', () => {
  assert.equal(
    normalizarRuta('/api/evergreen/contacts/9f3c1e2a-4b5d-6e7f-8a9b-0c1d2e3f4a5b/activities'),
    '/api/evergreen/contacts/:id/activities'
  )
  assert.equal(normalizarRuta('/firmar/AbCdEfGhIjKlMnOpQrStUvWxYz012345'), '/firmar/:token')
  assert.equal(normalizarRuta('/api/evergreen/sales/42'), '/api/evergreen/sales/:n')
  // Y lo que no es un identificador se deja tal cual, o la etiqueta no diría nada.
  assert.equal(normalizarRuta('/evergreen/settings/integraciones'), '/evergreen/settings/integraciones')
})

test('el id de petición es corto, dictable y no adivinable', () => {
  const a = nuevoRequestId()
  assert.equal(a.length, 16)
  assert.match(a, /^[0-9a-f]{16}$/)
  // Dos seguidos no pueden coincidir: si fueran secuenciales o predecibles no servirían para correlacionar.
  assert.notEqual(a, nuevoRequestId())
})
