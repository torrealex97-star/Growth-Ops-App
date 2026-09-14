import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluarCualificacion, leerIngresos, leerProblema } from '../../lib/metrics/cualificacion.ts'
import { extraerRespuestas, tieneRespuestasEstructuradas } from '../../lib/metrics/respuestas-formulario.ts'

// ---------------------------------------------------------------------------------------------
// LA DEFINICIÓN: cualificada = tiene el problema que el negocio resuelve Y declara cobrar al menos
// 1.000€/mes. Sale del formulario, así que se sabe AL RESERVAR — que es lo que permite calcular el
// coste por agenda cualificada sin esperar a que ocurra la llamada.
//
// Todas las respuestas de estos tests son LITERALES de la base de producción (473 agendas de
// Calendly). No hay ninguna inventada: si el formulario cambia, estos tests son el contrato que salta.
// ---------------------------------------------------------------------------------------------

test('las opciones cerradas de ingresos se leen por tabla, con fiabilidad alta', () => {
  for (const [respuesta, cumple] of [
    ['Entre 1.000€ y 2.000€', true],
    ['Entre 2.000€ y 3.000€', true],
    ['Más de 3.000€', true],
    ['Menos de 600€', false],
    ['Menos de 1.000€', false],
  ]) {
    const r = leerIngresos(respuesta)
    assert.equal(r.cumple, cumple, respuesta)
    assert.equal(r.fiabilidad, 'alta', respuesta)
  }
})

// "Entre 600 y 1.000€" tiene TOPE 1.000, así que no garantiza cobrar AL MENOS 1.000. Son 134 agendas
// en la base real: contarlas como cualificadas por tocar el límite en el extremo inflaría el numerador
// un 87% sobre las 154 que sí lo superan con certeza.
test('un rango cuyo techo es justo el umbral NO cumple', () => {
  const r = leerIngresos('Entre 600 y 1.000€')
  assert.equal(r.cumple, false)
  assert.equal(r.min, 600)
  assert.equal(r.max, 1000)
})

test('declarar que no hay ingresos es un dato, no un hueco', () => {
  for (const respuesta of ['Sin ingreso ', '0 ', 'Ahora mismo ninguno', 'Aun no tengo trabajo']) {
    const r = leerIngresos(respuesta)
    assert.equal(r.cumple, false, respuesta)
    assert.equal(r.fiabilidad, 'alta', respuesta)
  }
})

// "1000 bs" son bolívares. Tratarlo como mil euros movería la agenda al lado cualificado por un
// símbolo, y aplicar un tipo de cambio inventado sería peor: el número parecería exacto.
test('otra moneda no se convierte: queda sin determinar, no cumpliendo', () => {
  for (const respuesta of ['1000 bs', '200$ al mes', '230$', 'Entre 500 bs. ']) {
    const r = leerIngresos(respuesta)
    assert.equal(r.cumple, null, respuesta)
    assert.equal(r.fiabilidad, 'baja', respuesta)
    assert.match(r.motivo, /otra moneda/i)
  }
})

test('el texto libre con importe se interpreta, con fiabilidad media', () => {
  const bajo = leerIngresos('300-500€')
  assert.equal(bajo.cumple, false)
  assert.equal(bajo.fiabilidad, 'media')

  const alto = leerIngresos('unos 1.500 al mes')
  assert.equal(alto.cumple, true)
  assert.equal(alto.fiabilidad, 'media')
})

// Un texto sin importe legible NO es "no cumple": es "no se sabe".
test('una respuesta sin importe legible queda sin determinar', () => {
  const r = leerIngresos('Todo lo que se pueda ganar ')
  assert.equal(r.cumple, null)
  assert.equal(r.fiabilidad, 'baja')
})

// ---------------------------------------------------------------------------------------------
// EL PROBLEMA
// ---------------------------------------------------------------------------------------------

test('la escala 1-10 de insatisfacción decide por umbral configurable', () => {
  const alta = leerProblema([{ pregunta: 'En una escala del 1 al 10, ¿qué tan insatisfecha estás?', respuesta: '8' }])
  assert.equal(alta.tiene, true)
  assert.equal(alta.fiabilidad, 'alta')

  const baja = leerProblema([{ pregunta: 'En una escala del 1 al 10, ¿qué tan insatisfecha estás?', respuesta: '3' }])
  assert.equal(baja.tiene, false)
})

test('las opciones cerradas de "cómo te sientes" declaran el problema', () => {
  for (const respuesta of [
    'Busco una oportunidad para generar ingresos online',
    'No me siento satisfecha y quiero un cambio profesional',
    'Me gusta, pero quiero aumentar mis ingresos',
    'Siento que estoy estancada profesionalmente',
  ]) {
    const r = leerProblema([{ pregunta: '¿Cómo te sientes con tu situación laboral actual?', respuesta }])
    assert.equal(r.tiene, true, respuesta)
  }
})

// Sin ninguna de las dos preguntas no se puede afirmar nada.
test('sin preguntas sobre la situación, el problema queda sin determinar', () => {
  const r = leerProblema([{ pregunta: 'Teléfono', respuesta: '600000000' }])
  assert.equal(r.tiene, null)
  assert.equal(r.fiabilidad, 'baja')
})

// ---------------------------------------------------------------------------------------------
// EL VEREDICTO COMPLETO
// ---------------------------------------------------------------------------------------------

test('cualifica solo cuando se cumplen las DOS condiciones', () => {
  const r = evaluarCualificacion([
    { pregunta: 'En una escala del 1 al 10, ¿qué tan insatisfecha estás con tu situación actual?', respuesta: '9' },
    { pregunta: 'Nivel de ingresos aproximado mes a mes ', respuesta: 'Entre 2.000€ y 3.000€' },
  ])
  assert.equal(r.cualificada, true)
  assert.equal(r.tieneProblema, true)
  assert.equal(r.puedePagar, true)
  assert.deepEqual(r.ingresosEur, { min: 2000, max: 3000 })
})

// Una condición que falla con CERTEZA descualifica, aunque la otra no se sepa: si declara 300€, da
// igual lo insatisfecha que esté.
test('un ingreso insuficiente descualifica aunque no se sepa lo demás', () => {
  const r = evaluarCualificacion([{ pregunta: 'Nivel de ingresos mensuales aproximados', respuesta: 'Menos de 600€' }])
  assert.equal(r.cualificada, false)
  assert.equal(r.puedePagar, false)
  assert.equal(r.tieneProblema, null)
})

// EL NÚCLEO DEL MÓDULO: falta de dato no es "no cualificada". Con formularios que han cambiado tres
// veces, dar por no cualificadas a las que reservaron por una versión más corta haría que el coste por
// agenda cualificada saliera más bonito y falso.
test('sin información suficiente el veredicto es null, nunca false', () => {
  const r = evaluarCualificacion([{ pregunta: 'Teléfono ', respuesta: '600000000' }])
  assert.equal(r.cualificada, null)
  assert.equal(r.fiabilidad, 'baja')
  assert.ok(r.motivos.length >= 2, 'debe explicar por qué no se sabe')
})

test('el veredicto explica en frases por qué ha salido así', () => {
  const r = evaluarCualificacion([
    { pregunta: '¿Cómo te sientes con tu trabajo actual?', respuesta: 'Siento que estoy estancada profesionalmente' },
    { pregunta: 'Nivel de ingresos aproximado mes a mes ', respuesta: 'Entre 600 y 1.000€' },
  ])
  assert.equal(r.cualificada, false)
  assert.ok(r.motivos.some((m) => /estancada/i.test(m)))
  assert.ok(r.motivos.some((m) => /por debajo de 1000/i.test(m)))
})

test('el umbral y la escala son configurables sin tocar código', () => {
  const respuestas = [
    { pregunta: 'En una escala del 1 al 10, ¿qué tan insatisfecha estás?', respuesta: '5' },
    { pregunta: 'Nivel de ingresos aproximado mes a mes ', respuesta: 'Entre 600 y 1.000€' },
  ]
  const config = {
    ingresosMinimosEur: 600,
    patronesIngresos: ['ingresos'],
    patronesProblema: ['escala del 1 al 10'],
    insatisfaccionMinima: 5,
  }
  const r = evaluarCualificacion(respuestas, config)
  assert.equal(r.cualificada, true)
})

// ---------------------------------------------------------------------------------------------
// EXTRACCIÓN POR PROVEEDOR — formas reales del webhook.
// ---------------------------------------------------------------------------------------------

test('Calendly: las respuestas salen de invitee.questions_and_answers', () => {
  const payload = {
    invitee: {
      email: 'a@b.com',
      cancel_url: 'https://calendly.com/cancel/xyz',
      questions_and_answers: [
        { question: 'Nivel de ingresos aproximado mes a mes ', answer: 'Más de 3.000€', position: 1 },
        { question: 'Teléfono ', answer: '600000000', position: 2 },
        { question: 'Sin contestar', answer: '' },
      ],
    },
  }
  const r = extraerRespuestas(payload, 'calendly')
  assert.equal(r.length, 2, 'las preguntas sin respuesta no entran')
  assert.deepEqual(r[0], { pregunta: 'Nivel de ingresos aproximado mes a mes', respuesta: 'Más de 3.000€' })
  // Y no se filtra nada del payload que no sea una respuesta.
  assert.ok(!JSON.stringify(r).includes('cancel_url'))
  assert.ok(tieneRespuestasEstructuradas(r))
})

// GHL no manda pares pregunta/respuesta. Partir su texto por líneas y llamar "pregunta" a la primera
// mitad sería inventar una estructura, y la cualificación acabaría leyendo ingresos de un texto que no
// los declara.
test('GHL: el texto libre se etiqueta como tal, sin fingir preguntas', () => {
  const r = extraerRespuestas({ notes: 'Quiere cambiar de trabajo', description: 'Llamada de 30 min' }, 'ghl')
  assert.equal(r.length, 1)
  assert.equal(tieneRespuestasEstructuradas(r), false)
  assert.match(r[0].pregunta, /texto libre/i)
})

test('Typeform: se resuelve el título de la pregunta desde la definición', () => {
  const payload = {
    form_response: {
      definition: { fields: [{ id: 'f1', title: '¿Cuánto facturas al mes?' }] },
      answers: [{ field: { id: 'f1', type: 'choice' }, type: 'choice', choice: { label: 'Entre 1.000€ y 2.000€' } }],
    },
  }
  const r = extraerRespuestas(payload, 'typeform')
  assert.deepEqual(r, [{ pregunta: '¿Cuánto facturas al mes?', respuesta: 'Entre 1.000€ y 2.000€' }])
})

// Vacío significa "este formulario no preguntó nada", que no es un error de lectura. No se inventa una
// entrada de relleno para que la ficha no salga vacía.
test('un payload sin respuestas devuelve lista vacía, no relleno', () => {
  assert.deepEqual(extraerRespuestas(null, 'calendly'), [])
  assert.deepEqual(extraerRespuestas({}, 'calendly'), [])
  assert.deepEqual(extraerRespuestas({ invitee: { questions_and_answers: [] } }, 'calendly'), [])
})

// Extremo a extremo con un payload de Calendly tal como llega.
test('de payload de Calendly a veredicto, sin pasos manuales', () => {
  const payload = {
    invitee: {
      questions_and_answers: [
        {
          question: '¿Cómo te sientes con tu situación laboral actual?',
          answer: 'Siento que estoy estancada profesionalmente',
        },
        { question: 'Nivel de ingresos aproximado mes a mes ', answer: 'Entre 1.000€ y 2.000€' },
      ],
    },
  }
  const r = evaluarCualificacion(extraerRespuestas(payload, 'calendly'))
  assert.equal(r.cualificada, true)
  assert.equal(r.fiabilidad, 'media', 'una mitad viene de opción cerrada y la otra de texto reconocido')
})

// En la base hay "Menos de $600": el símbolo no puede impedir leer el rango. Un TECHO por debajo del
// umbral no lo alcanza en ninguna moneda plausible, así que la ambigüedad de divisa no cambia el
// veredicto — solo importaría si la respuesta pretendiera superar el umbral.
test('un techo por debajo del umbral se lee aunque lleve símbolo de otra moneda', () => {
  const r = leerIngresos('Menos de $600 ')
  assert.equal(r.cumple, false)
  assert.equal(r.fiabilidad, 'alta')
})

// Pero una cantidad en otra moneda que SÍ pretendería superar el umbral sigue sin determinarse.
test('una cantidad en otra moneda por encima del umbral sigue sin determinar', () => {
  assert.equal(leerIngresos('1000 bs').cumple, null)
  assert.equal(leerIngresos('2000$').cumple, null)
})
