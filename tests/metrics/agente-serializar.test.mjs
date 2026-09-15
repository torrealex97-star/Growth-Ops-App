import assert from 'node:assert/strict'
import test from 'node:test'
import { avisoRespuestaCortada, serializarResultadoTool } from '../../lib/ai/agent/serializar.ts'

// ---------------------------------------------------------------------------------------------
// EL BUG: el gateway hacía `JSON.stringify(result).slice(0, 20000)`. Al pasarse de tamaño, el corte
// caía en mitad de una clave o de un número y el modelo recibía algo como
//
//   {"ventas":[{"id":"a1b2","importe":14
//
// JSON inválido. Un modelo que recibe eso no falla: RELLENA. Completa la estructura y presenta el
// resultado como un dato del negocio. En un agente que responde "cuánto hemos facturado" es el peor
// fallo posible, porque no se nota.
// ---------------------------------------------------------------------------------------------

const esJsonValido = (s) => {
  JSON.parse(s)
  return true
}

test('lo que cabe se manda entero y sin tocar', () => {
  const r = { total: 21984.05, ventas: 27 }
  assert.equal(serializarResultadoTool(r), JSON.stringify(r))
})

// El invariante central: pase lo que pase, JSON válido.
test('el resultado SIEMPRE es JSON válido, por grande que sea', () => {
  for (const n of [10, 500, 5000, 50000]) {
    const grande = { filas: Array.from({ length: n }, (_, i) => ({ id: `fila-${i}`, importe: i * 1.5 })) }
    const salida = serializarResultadoTool(grande)
    assert.ok(esJsonValido(salida), `con ${n} filas salió JSON inválido`)
  }
})

// Reproduce exactamente el fallo anterior: con el método viejo, el JSON se rompía.
test('el método anterior producía JSON inválido; este no', () => {
  const grande = { filas: Array.from({ length: 5000 }, (_, i) => ({ id: `fila-${i}`, importe: i })) }
  const comoAntes = JSON.stringify(grande).slice(0, 20000)
  assert.throws(() => JSON.parse(comoAntes), 'el método viejo debería romper el JSON')
  assert.ok(esJsonValido(serializarResultadoTool(grande)))
})

// Se recorta por DATOS, y se DICE. Un dato ausente y declarado es utilizable; uno disimulado envenena
// la respuesta.
test('al recortar se declara qué se recortó y cuántos elementos había', () => {
  const grande = { filas: Array.from({ length: 1787 }, (_, i) => ({ id: `fila-${i}`, texto: 'x'.repeat(50) })) }
  const salida = JSON.parse(serializarResultadoTool(grande))
  assert.ok(salida._recorte, 'falta la declaración del recorte')
  assert.ok(
    salida._recorte.detalle.some((d) => d.includes('1787')),
    'el aviso debe decir cuántos elementos había en total'
  )
  assert.match(salida._recorte.instruccion, /NO extrapoles/i)
})

// LOS TOTALES SE CONSERVAN. Es lo que permite al modelo decir "hay 1.787 filas por 12.400€" aunque
// solo vea tres: si se perdieran los agregados, tendría que sumar la muestra y extrapolar.
test('los totales del mismo objeto sobreviven al recorte de las listas', () => {
  const grande = {
    total_eur: 21984.05,
    numero_filas: 1787,
    filas: Array.from({ length: 1787 }, (_, i) => ({ id: `fila-${i}`, texto: 'y'.repeat(60) })),
  }
  const salida = JSON.parse(serializarResultadoTool(grande))
  assert.equal(salida.total_eur, 21984.05)
  assert.equal(salida.numero_filas, 1787)
  assert.ok(Array.isArray(salida.filas) && salida.filas.length < 1787)
})

test('una lista en la raíz también se recorta con envoltorio válido', () => {
  const lista = Array.from({ length: 3000 }, (_, i) => ({ id: i, texto: 'z'.repeat(40) }))
  const salida = JSON.parse(serializarResultadoTool(lista))
  assert.ok(Array.isArray(salida.muestra))
  assert.ok(salida._recorte.detalle.some((d) => d.includes('3000')))
})

// Cuando ni el envoltorio cabe, se dice que no se pudo leer. Es cierto, y es infinitamente mejor que
// una estructura mutilada: el modelo puede pedir una consulta más acotada.
test('si nada cabe se declara que no se pudo leer, con instrucción de no inventar', () => {
  const enorme = { texto: 'a'.repeat(50000) }
  const salida = JSON.parse(serializarResultadoTool(enorme))
  assert.ok(salida._recorte)
  assert.match(salida._recorte.instruccion, /NO respondas con cifras/i)
  assert.equal(salida._recorte.limite, 20000)
})

// Con referencias circulares, `JSON.stringify` LANZA. Dentro del bucle de tools eso se convertiría en
// el error de la tool entera, cuando el problema es de serialización y no del dato.
test('una referencia circular no revienta la petición', () => {
  const circular = { a: 1 }
  circular.self = circular
  const salida = serializarResultadoTool(circular)
  assert.ok(esJsonValido(salida))
  assert.ok(JSON.parse(salida)._error_serializacion)
})

test('un resultado nulo o primitivo no rompe nada', () => {
  assert.ok(esJsonValido(serializarResultadoTool(null)))
  assert.ok(esJsonValido(serializarResultadoTool(0)))
  assert.ok(esJsonValido(serializarResultadoTool('texto')))
})

// ---------------------------------------------------------------------------------------------
// EL OTRO BUG: con stop_reason 'max_tokens' el gateway devolvía el texto truncado tal cual, así que
// la respuesta llegaba cortada a media frase y nadie lo decía.
// ---------------------------------------------------------------------------------------------

test('una respuesta cortada por longitud lo avisa', () => {
  const salida = avisoRespuestaCortada('El CAC ha subido porque', 'max_tokens')
  assert.match(salida, /El CAC ha subido porque/)
  assert.match(salida, /se ha cortado por longitud/i)
})

test('una respuesta completa no lleva aviso', () => {
  const texto = 'El CAC ha subido un 12% por la caída del show rate.'
  assert.equal(avisoRespuestaCortada(texto, 'end_turn'), texto)
  assert.equal(avisoRespuestaCortada(texto, null), texto)
})

test('si se cortó antes de escribir nada, se dice en vez de devolver vacío', () => {
  assert.match(avisoRespuestaCortada('   ', 'max_tokens'), /antes de empezar/i)
})
