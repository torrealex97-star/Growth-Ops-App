import assert from 'node:assert/strict'
import test from 'node:test'
import { calcularAgregados, dividir, porcentaje } from '../../lib/metrics/agregados.ts'
import { TODAS_LAS_METRICAS } from '../../lib/metrics/registro.ts'

const P = { desde: '2026-09-01', hasta: '2026-09-30' }
const vacio = { ventas: [], cobros: [], citas: [], campanas: [], contactos: [], periodo: P }
const con = (over) => calcularAgregados({ ...vacio, ...over })

const venta = (o = {}) => ({ sale_date: '2026-09-10', gross_amount: 1997, status: 'active', ...o })
const cobro = (o = {}) => ({ collected_at: '2026-09-10T10:00:00Z', gross_amount: 199.7, is_confirmed: true, ...o })
const cita = (o = {}) => ({ appointment_datetime: '2026-09-10T10:00:00Z', status: 'show', ...o })
const dia = (o = {}) => ({ date: '2026-09-10', spend: 100, impressions: 10_000, clicks: 200, leads: 10, ...o })
const contacto = (o = {}) => ({ created_at: '2026-09-10T10:00:00Z', first_contact_at: null, ...o })

// =============================================================================================
// LAS CLAVES TIENEN QUE COINCIDIR CON EL REGISTRO. Si aquí se escribe `close_rate` y el registro dice
// `close_rate_llamadas`, la métrica se queda vacía en el panel y NADIE se entera.
// =============================================================================================

test('todas las claves calculadas existen en el registro de métricas', () => {
  const delRegistro = new Set(TODAS_LAS_METRICAS.map((m) => m.key))
  for (const clave of Object.keys(con({}))) {
    assert.ok(delRegistro.has(clave), `"${clave}" no existe en lib/metrics/registro.ts`)
  }
})

// =============================================================================================
// SIN DATOS NO SE CUENTA. La regla del negocio, literal: "de lo que no haya datos no debe contar".
// =============================================================================================

test('sin ninguna fila, nada vale 0: todo vale null con su motivo', () => {
  const m = con({})
  for (const clave of ['cash_roas', 'cac', 'ctr', 'cpc', 'cpm', 'ad_spend', 'show_rate', 'cpqbc', 'aov']) {
    assert.equal(m[clave].valor, null, clave)
    assert.ok(m[clave].motivo && m[clave].motivo.length > 15, `${clave} no explica por qué falta`)
  }
})

// Esta es la distinción que evita decisiones sobre datos inexistentes: 0 € de gasto porque no se ha
// sincronizado Meta NO es 0 € de gasto.
test('sin campañas cargadas, el gasto es un hueco, no un cero', () => {
  const m = con({})
  assert.equal(m.ad_spend.valor, null)
  assert.match(m.ad_spend.motivo, /no se ha sincronizado/)
  // Y con campañas a 0 de gasto sí es un 0 medido.
  const conCero = con({ campanas: [dia({ spend: 0, impressions: 0, clicks: 0 })] })
  assert.equal(conCero.ad_spend.valor, 0)
  assert.equal(conCero.ad_spend.motivo, undefined)
})

test('una división por cero es null, nunca Infinity ni NaN', () => {
  assert.equal(dividir(10, 0, 'motivo').valor, null)
  assert.equal(dividir(0, 0, 'motivo').valor, null)
  assert.equal(porcentaje(5, 0, 'motivo').valor, null)
  // Y ningún valor calculado puede salir NaN o Infinity nunca.
  const m = con({ ventas: [venta()], cobros: [cobro()], citas: [cita()], campanas: [dia()] })
  for (const [k, v] of Object.entries(m)) {
    if (v.valor !== null) assert.ok(Number.isFinite(v.valor), `${k} = ${v.valor}`)
  }
})

// =============================================================================================
// EL DINERO. Facturación = precio COMPROMETIDO, no la suma de lo cobrado: es la corrección que ya
// costó una migración de datos.
// =============================================================================================

test('la facturación es el precio pactado y el cash es lo cobrado, y no se confunden', () => {
  const m = con({
    ventas: [venta({ gross_amount: 1997 })],
    cobros: [cobro({ gross_amount: 199.7 }), cobro({ gross_amount: 199.7 })],
  })
  assert.equal(m.contracted_revenue.valor, 1997)
  assert.equal(m.cash_collected.valor, 399.4)
  assert.equal(m.cash_collection_ratio.valor, 20)
  assert.equal(m.aov.valor, 1997)
  assert.equal(m.ventas.valor, 1)
})

test('una venta anulada o reembolsada no factura', () => {
  const m = con({ ventas: [venta(), venta({ status: 'refunded' }), venta({ status: 'cancelled' })] })
  assert.equal(m.ventas.valor, 1)
  assert.equal(m.contracted_revenue.valor, 1997)
})

test('lo de fuera del periodo no entra', () => {
  const m = con({
    ventas: [venta({ sale_date: '2026-08-31' }), venta({ sale_date: '2026-10-01' }), venta()],
    cobros: [cobro({ collected_at: '2026-08-31T23:59:59Z' }), cobro()],
  })
  assert.equal(m.ventas.valor, 1)
  assert.equal(m.cash_collected.valor, 199.7)
})

test('un cobro sin confirmar no cuenta como dinero en la cuenta', () => {
  const m = con({ cobros: [cobro(), cobro({ is_confirmed: false })] })
  assert.equal(m.cash_collected.valor, 199.7)
})

test('los importes que llegan como string de Postgres se suman como números', () => {
  const m = con({ ventas: [venta({ gross_amount: '1997.00' })], cobros: [cobro({ gross_amount: '199.70' })] })
  assert.equal(m.contracted_revenue.valor, 1997)
  assert.equal(m.cash_collected.valor, 199.7)
})

// =============================================================================================
// LOS ANUNCIOS
// =============================================================================================

test('CAC, ROAS, CTR, CPC y CPM salen de los números reales', () => {
  const m = con({
    campanas: [dia({ spend: 1000, impressions: 100_000, clicks: 2000 })],
    ventas: [venta(), venta()],
    cobros: [cobro({ gross_amount: 2000 })],
  })
  assert.equal(m.cac.valor, 500) // 1000 € / 2 ventas
  assert.equal(m.cash_roas.valor, 2) // 2000 € cobrados / 1000 € gastados
  assert.equal(m.ctr.valor, 2) // 2000 / 100000
  assert.equal(m.cpc.valor, 0.5) // 1000 / 2000
  assert.equal(m.cpm.valor, 10) // 1000 * 1000 / 100000
})

test('con gasto pero sin ventas, el CAC es un hueco y no un cero', () => {
  const m = con({ campanas: [dia({ spend: 500 })] })
  assert.equal(m.cac.valor, null)
  assert.match(m.cac.motivo, /división por cero/)
})

// =============================================================================================
// LAS CITAS. Una cita cancelada no entra en el denominador: nadie dejó de presentarse a algo que se
// canceló, y meterla hunde el show rate sin que haya pasado nada.
// =============================================================================================

test('las canceladas no entran en el denominador del show rate', () => {
  const m = con({
    citas: [cita(), cita({ status: 'no_show' }), cita({ status: 'cancelled' }), cita({ status: 'cancelled_lead' })],
  })
  assert.equal(m.agendas.valor, 2)
  assert.equal(m.show_rate.valor, 50)
  assert.equal(m.show_rate.muestra, 2)
})

test('sin citas agendadas no hay show rate', () => {
  const m = con({ citas: [cita({ status: 'cancelled' })] })
  assert.equal(m.show_rate.valor, null)
})

// `offered` nulo significa NO MARCADO, no "no hubo oferta". Tratarlo como un no inventa el dato.
test('el pitch rate solo se mide sobre las llamadas donde alguien marcó la oferta', () => {
  const sinMarcar = con({ citas: [cita(), cita(), cita()] })
  assert.equal(sinMarcar.pitch_rate.valor, null)
  assert.match(sinMarcar.pitch_rate.motivo, /Nadie ha marcado/)

  const marcadas = con({ citas: [cita({ offered: true }), cita({ offered: false }), cita()] })
  assert.equal(marcadas.pitch_rate.valor, 50, 'la no marcada queda fuera del denominador')
  assert.equal(marcadas.pitch_rate.muestra, 2)
})

test('el close rate se mide sobre llamadas asistidas y sobre ofertas, por separado', () => {
  const m = con({
    citas: [cita({ offered: true }), cita({ offered: true }), cita({ offered: false }), cita({ status: 'no_show' })],
    ventas: [venta({ appointment_id: 'a1' })],
  })
  assert.equal(m.close_rate_llamadas.valor, 33.33) // 1 venta / 3 asistidas
  assert.equal(m.close_rate_ofertas.valor, 50) // 1 venta / 2 ofertas
})

test('una venta sin cita asociada no cuenta como cierre de llamada', () => {
  const m = con({ citas: [cita()], ventas: [venta({ appointment_id: null })] })
  assert.equal(m.close_rate_llamadas.valor, 0, 'es un 0 medido: hubo llamada y no salió de ella')
})

// =============================================================================================
// LA CUALIFICACIÓN ES LA DE MARKETING (formulario), no la de ventas (oferta).
// =============================================================================================

// Las preguntas son las REALES del formulario de producción, comprobadas en la base: un fixture con
// preguntas inventadas habría pasado el test sin que la cualificación funcionara sobre datos de verdad.
const formulario = (ingresos, insatisfaccion) => ({
  invitee: {
    questions_and_answers: [
      { question: 'Nivel de ingresos aproximado mes a mes ', answer: ingresos },
      {
        question: 'En una escala del 1 al 10, ¿qué tan insatisfecha estás con tu situación actual?',
        answer: insatisfaccion,
      },
    ],
  },
})

test('la agenda cualificada sale del formulario, no de si el closer marcó la oferta', () => {
  const m = con({
    citas: [
      cita({ raw_payload: formulario('Entre 3.000 y 5.000 €', '9') }),
      cita({ raw_payload: formulario('Menos de 500 €', '9') }),
    ],
  })
  assert.equal(m.agendas_cualificadas.valor, 1)
  assert.equal(m.agendas_cualificadas.muestra, 2)
})

test('sin respuestas de formulario no se cualifica nada, y se dice', () => {
  const m = con({ citas: [cita(), cita({ offered: true })] })
  assert.equal(m.agendas_cualificadas.valor, null)
  assert.match(m.agendas_cualificadas.motivo, /respuestas de formulario/)
  // Y el CPQBC, que la tiene como denominador, tampoco se inventa.
  const conGasto = con({ citas: [cita()], campanas: [dia({ spend: 500 })] })
  assert.equal(conGasto.cpqbc.valor, null)
})

test('el CPQBC se calcula sobre las cualificadas por formulario', () => {
  const m = con({
    campanas: [dia({ spend: 600 })],
    citas: [
      cita({ raw_payload: formulario('Entre 3.000 y 5.000 €', '8') }),
      cita({ raw_payload: formulario('Entre 10.000 y 20.000 €', '9') }),
    ],
  })
  assert.equal(m.cpqbc.valor, 300)
})

// =============================================================================================
// LOS HUECOS DECLARADOS. Un panel al que le falta una métrica sin decirlo parece completo y no lo está.
// =============================================================================================

test('LTGP:CAC sigue declarado como hueco mientras no exista margen bruto por cliente', () => {
  const m = con({ ventas: [venta()], cobros: [cobro()], citas: [cita()], campanas: [dia()] })
  assert.equal(m.ltgp_cac.valor, null)
  assert.match(m.ltgp_cac.motivo, /margen bruto por cliente/)
})

test('speed to lead usa la mediana de pares válidos y no deja que un extremo arrastre el dato', () => {
  const m = con({
    contactos: [
      contacto({ first_contact_at: '2026-09-10T10:02:00Z' }),
      contacto({ first_contact_at: '2026-09-10T10:06:00Z' }),
      contacto({ first_contact_at: '2026-09-12T10:00:00Z' }),
      contacto({ first_contact_at: null }),
    ],
  })
  assert.equal(m.speed_to_lead.valor, 6)
  assert.equal(m.speed_to_lead.muestra, 3)
  assert.match(m.speed_to_lead.motivo, /3 de 4 contactos/)
})

test('speed to lead no convierte contactos sin hora válida en cero minutos', () => {
  const m = con({ contactos: [contacto(), contacto({ first_contact_at: '2026-09-10T09:59:00Z' })] })
  assert.equal(m.speed_to_lead.valor, null)
  assert.match(m.speed_to_lead.motivo, /ninguno tiene una hora de primer contacto válida/)
})

test('BAMFAM solo mide llamadas asistidas sin venta y usa el marcado de siguiente reunión', () => {
  const m = con({
    citas: [
      cita({ result: 'seguimiento', needs_followup: true }),
      cita({ result: 'no_interesado', needs_followup: false }),
      cita({ result: 'venta', needs_followup: false }),
      cita({ status: 'no_show', result: 'seguimiento', needs_followup: true }),
    ],
  })
  assert.equal(m.bamfam_rate.valor, 50)
  assert.equal(m.bamfam_rate.muestra, 2)
})

test('la concordancia compara formulario y juicio del closer solo cuando ambos existen', () => {
  const formCualificado = formulario('Entre 3.000 y 5.000 €', '8')
  const formNoCualificado = formulario('Menos de 1.000 €', '2')
  const m = con({
    citas: [
      cita({ raw_payload: formCualificado, offered: true }),
      cita({ raw_payload: formCualificado, offered: false }),
      cita({ raw_payload: formNoCualificado, offered: false }),
      cita({ raw_payload: {}, offered: true }),
    ],
  })
  assert.equal(m.tasa_concordancia_cualificacion.valor, 66.67)
  assert.equal(m.tasa_concordancia_cualificacion.muestra, 3)
  assert.match(m.tasa_concordancia_cualificacion.motivo, /3 de 4 agendas/)
})

// =============================================================================================
// EL DENOMINADOR DEL SHOW RATE, que es lo que decide si el panel dice la verdad.
//
// Comprobado en producción: 272 citas `scheduled` y 71 `confirmed` —328 ya pasadas— frente a 3 marcadas
// como `show` y NINGUNA como `no_show`. Sobre las no canceladas, el show rate saldría 0,87%: un número
// catastrófico que no significa nada, porque no es que no venga nadie, es que nadie marca la asistencia.
// Y ese 0,87% dominaría el diagnóstico y mandaría al equipo a arreglar un problema inventado.
// =============================================================================================

test('una cita pasada sin marcar NO cuenta como no-show', () => {
  const m = con({
    citas: [
      cita({ status: 'show' }),
      ...Array.from({ length: 50 }, () => cita({ status: 'scheduled' })),
      ...Array.from({ length: 20 }, () => cita({ status: 'confirmed' })),
    ],
  })
  // Lo honesto: 100% sobre una muestra de 1, no 1,4% sobre 71.
  assert.equal(m.show_rate.valor, 100)
  assert.equal(m.show_rate.muestra, 1)
})

test('sin ninguna cita resuelta no hay show rate, y el motivo lo explica', () => {
  const m = con({ citas: Array.from({ length: 30 }, () => cita({ status: 'scheduled' })) })
  assert.equal(m.show_rate.valor, null)
  assert.match(m.show_rate.motivo, /ninguna marcada como asistida/)
  assert.match(m.show_rate.motivo, /un 0% sería un problema inventado/)
  // Y las agendas sí se cuentan: existen, solo que sin resolver.
  assert.equal(m.agendas.valor, 30)
})

test('con marcado real el show rate sale sobre las resueltas', () => {
  const m = con({
    citas: [
      cita({ status: 'show' }),
      cita({ status: 'show' }),
      cita({ status: 'no_show' }),
      cita({ status: 'scheduled' }),
      cita({ status: 'cancelled' }),
    ],
  })
  assert.equal(m.show_rate.valor, 66.67)
  assert.equal(m.show_rate.muestra, 3)
})

// La cobertura del marcado es el dato más accionable del panel cuando está mal: mientras esté mal, el
// show rate, el pitch rate y el close rate sobre llamadas no se pueden calcular con nada.
test('la cobertura del marcado cuenta las pasadas sin resolver', async () => {
  const { coberturaMarcado } = await import('../../lib/metrics/agregados.ts')
  const ahora = new Date('2026-09-20T00:00:00Z')
  const c = coberturaMarcado(
    [
      cita({ appointment_datetime: '2026-09-10T10:00:00Z', status: 'show' }),
      cita({ appointment_datetime: '2026-09-11T10:00:00Z', status: 'scheduled' }),
      cita({ appointment_datetime: '2026-09-12T10:00:00Z', status: 'confirmed' }),
      // Futura: no se le puede exigir marcado todavía.
      cita({ appointment_datetime: '2026-09-25T10:00:00Z', status: 'scheduled' }),
      // Cancelada: no hay nada que marcar.
      cita({ appointment_datetime: '2026-09-13T10:00:00Z', status: 'cancelled' }),
    ],
    P,
    ahora
  )
  assert.equal(c.pasadasSinMarcar, 2)
  assert.equal(c.resueltas, 1)
  assert.equal(c.fraccionResuelta, 0.33)
})

test('sin citas pasadas no se reprocha falta de marcado', async () => {
  const { coberturaMarcado } = await import('../../lib/metrics/agregados.ts')
  const c = coberturaMarcado(
    [cita({ appointment_datetime: '2026-09-25T10:00:00Z' })],
    P,
    new Date('2026-09-20T00:00:00Z')
  )
  assert.equal(c.pasadasSinMarcar, 0)
  assert.equal(c.fraccionResuelta, null)
})
