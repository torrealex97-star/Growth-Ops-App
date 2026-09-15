import assert from 'node:assert/strict'
import test from 'node:test'
import { avisoOferta, resolverOferta, resumirOferta } from '../../lib/metrics/oferta.ts'

const SIN_SUPOSICION = { asumirOfertaEnLlamadaAsistida: false }

// ---------------------------------------------------------------------------------------------
// LA REGLA: "si el closer no marca que NO hizo la oferta, es que la hizo".
//
// Buena decisión de producto: en una llamada celebrada, presentar la oferta es la norma y no
// presentarla es la excepción. La gente marca excepciones; nadie confirma lo que siempre pasa.
//
// Pero se aplica AL LEER, no al escribir, y cada valor sabe si fue declarado o asumido — si no, se
// pierde para siempre la diferencia entre "el closer lo dijo" y "lo dimos por hecho".
// ---------------------------------------------------------------------------------------------

test('una llamada celebrada sin marcar cuenta como oferta presentada', () => {
  const r = resolverOferta({ status: 'show' })
  assert.equal(r.valor, true)
  assert.equal(r.origen, 'asumido')
  assert.match(r.motivo, /nadie marcó lo contrario/i)
})

// LO DECLARADO MANDA SIEMPRE. Una suposición no puede pisar lo que una persona afirmó.
test('lo que el closer marca gana a la suposición', () => {
  assert.deepEqual(
    {
      v: resolverOferta({ status: 'show', offered: true }).valor,
      o: resolverOferta({ status: 'show', offered: true }).origen,
    },
    { v: true, o: 'declarado' }
  )
  const no = resolverOferta({ status: 'show', offered: false })
  assert.equal(no.valor, false)
  assert.equal(no.origen, 'declarado')
})

// El resultado puede decir lo mismo sin haber tocado el botón de la oferta.
test('marcar "no cualificado" ya dice que no hubo oferta', () => {
  const r = resolverOferta({ status: 'show', result: 'no_cualificado' })
  assert.equal(r.valor, false)
  assert.equal(r.origen, 'declarado')
})

// LA SUPOSICIÓN NO INVENTA OFERTAS DONDE NO HUBO LLAMADA. Ahí el `false` es un hecho, no una
// suposición, y se distingue con el origen.
test('sin llamada celebrada no hay oferta, y es un hecho, no una suposición', () => {
  for (const status of ['no_show', 'cancelled', 'cancelled_lead', 'cancelled_admin']) {
    const r = resolverOferta({ status })
    assert.equal(r.valor, false, status)
    assert.equal(r.origen, 'derivado', status)
  }
})

// Y tampoco se estira a llamadas que aún no han ocurrido: una cita de mañana no tiene oferta.
test('una llamada que todavía no se ha celebrado no tiene oferta ni asumida', () => {
  for (const status of ['scheduled', 'confirmed']) {
    const r = resolverOferta({ status })
    assert.equal(r.valor, null, status)
    assert.equal(r.origen, 'sin_dato', status)
  }
})

// La suposición es una decisión de negocio, no una verdad: en un equipo donde presentar la oferta no
// sea la norma, inflaría el Pitch Rate sistemáticamente.
test('la suposición se puede apagar por configuración', () => {
  const r = resolverOferta({ status: 'show' }, SIN_SUPOSICION)
  assert.equal(r.valor, null)
  assert.equal(r.origen, 'sin_dato')
  // Apagarla no afecta a lo declarado ni a lo derivado.
  assert.equal(resolverOferta({ status: 'show', offered: true }, SIN_SUPOSICION).valor, true)
  assert.equal(resolverOferta({ status: 'no_show' }, SIN_SUPOSICION).valor, false)
})

// ---------------------------------------------------------------------------------------------
// EL RESUMEN — y por qué la proporción asumida es parte del resultado.
// ---------------------------------------------------------------------------------------------

// LA CONSECUENCIA, dicha sin adornos: mientras nadie marque excepciones, el Pitch Rate es del 100%.
// Es lo que la suposición implica matemáticamente. La métrica empieza a informar cuando se marcan los
// "no", y hasta entonces el panel tiene que decir cuántas están asumidas.
test('sin ninguna excepción marcada el pitch rate es del 100%, y se dice que está asumido', () => {
  const r = resumirOferta(
    [{ status: 'show' }, { status: 'show' }, { status: 'completed' }].map((c) => resolverOferta(c))
  )
  assert.equal(r.pitchRate, 100)
  assert.equal(r.asumidas, 3)
  assert.equal(r.declaradas, 0)
  assert.equal(r.proporcionAsumida, 1)
  assert.equal(r.fiabilidad, 'baja')
  assert.match(avisoOferta(r), /empieza a informar cuando los closers marquen/i)
})

// Un Pitch Rate del 100% todo asumido y otro del 82% todo declarado tienen el mismo aspecto y valor
// informativo OPUESTO. Devolverlos sin distinguir sería la cifra creíble y falsa que hay que evitar.
test('la fiabilidad baja cuando el número descansa en la suposición', () => {
  const todoDeclarado = resumirOferta(
    [
      { status: 'show', offered: true },
      { status: 'show', offered: true },
      { status: 'show', offered: false },
    ].map((c) => resolverOferta(c))
  )
  assert.equal(todoDeclarado.fiabilidad, 'alta')
  assert.equal(todoDeclarado.proporcionAsumida, 0)
  assert.equal(avisoOferta(todoDeclarado), '', 'sin nada asumido no hay nada que matizar')

  const mixto = resumirOferta(
    [{ status: 'show', offered: true }, { status: 'show', offered: false }, { status: 'show' }].map((c) =>
      resolverOferta(c)
    )
  )
  assert.equal(mixto.asumidas, 1)
  assert.equal(mixto.fiabilidad, 'media')
  assert.match(avisoOferta(mixto), /1 de 3/)
})

test('las llamadas sin celebrar no entran en el denominador del pitch rate', () => {
  const r = resumirOferta(
    [{ status: 'show', offered: true }, { status: 'scheduled' }, { status: 'confirmed' }].map((c) => resolverOferta(c))
  )
  // Solo la celebrada es evaluable; las futuras no cuentan ni arriba ni abajo.
  assert.equal(r.evaluables, 1)
  assert.equal(r.pitchRate, 100)
})

// Un no-show SÍ entra como "sin oferta": ocurrió, y no hubo oferta. Es lo que hace que el pitch rate
// sobre el total refleje los plantones.
test('un no-show cuenta como llamada sin oferta', () => {
  const r = resumirOferta([{ status: 'show', offered: true }, { status: 'no_show' }].map((c) => resolverOferta(c)))
  assert.equal(r.evaluables, 2)
  assert.equal(r.sinOferta, 1)
  assert.equal(r.pitchRate, 50)
})

// Sin nada evaluable la tasa es null, NO 0%: un 0% diría que no se presenta ninguna oferta.
test('sin nada evaluable el pitch rate es null, no cero', () => {
  const r = resumirOferta([resolverOferta({ status: 'scheduled' })])
  assert.equal(r.evaluables, 0)
  assert.equal(r.pitchRate, null)
  assert.equal(r.fiabilidad, 'baja')
  assert.equal(avisoOferta(r), '')
})

test('un conjunto vacío no inventa una tasa', () => {
  assert.equal(resumirOferta([]).pitchRate, null)
})
