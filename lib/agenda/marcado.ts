// MARCADO RÁPIDO DE UNA AGENDA: qué puede decir un closer al colgar, y qué se deduce solo.
//
// POR QUÉ ES UN MÓDULO PURO. Estas reglas deciden el numerador y el denominador de Show Rate, Pitch
// Rate y Close Rate. Quiero poder probarlas sin base de datos ni sesión, y quiero que la ruta que
// escribe y la UI que pinta lean LAS MISMAS: si el formulario permitiera marcar oferta en una llamada
// a la que nadie asistió, el Pitch Rate saldría por encima del 100%.
//
// DÓNDE SE ESCRIBE, Y POR QUÉ AHÍ. La asistencia va a `appointments.status` ('show' / 'no_show'), que
// es el MISMO campo que escribiría Calendly o GHL. No hay columna `manual_show` aparte: si la hubiera,
// una asistencia marcada a mano y otra confirmada por el proveedor contarían como dos, y reconciliar
// después sería adivinar. Un campo, dos escritores, el último gana — y queda auditado.
//
// CUALIFICADA = SE LE LANZÓ LA OFERTA. Es la definición del negocio, dicha tal cual: "las cualificadas
// son las que se les lanza pitch, se le hace la oferta; si asiste y no se le lanza la oferta es que no
// estaba cualificada". Así que NO hay dos campos ni dos métricas: `offered` es la cualificación, y el
// Coste por Agenda Cualificada se calcula sobre ese mismo campo.

/** Lo que un closer puede declarar como desenlace. Vocabulario cerrado y declarado por el negocio. */
export const RESULTADOS = ['venta', 'seguimiento', 'no_interesado', 'no_cualificado', 'no_show', 'otro'] as const
export type Resultado = (typeof RESULTADOS)[number]

export const RESULTADO_LABELS: Record<Resultado, string> = {
  venta: 'Venta',
  seguimiento: 'Seguimiento',
  no_interesado: 'No interesado',
  no_cualificado: 'No cualificado',
  no_show: 'No-show',
  otro: 'Otro',
}

/** Lo que llega del formulario. Todo opcional: se puede marcar solo la asistencia y salir. */
export type Marcado = {
  /** `true` asistió, `false` no apareció, `undefined` sin tocar (NO es "no asistió"). */
  asistio?: boolean
  /** ¿Se le lanzó la oferta? Es también la cualificación. */
  ofertaPresentada?: boolean
  resultado?: Resultado
  /** ¿Queda una siguiente reunión agendada? Alimenta el BAMFAM. */
  seguimientoAgendado?: boolean
}

/** El parche que se escribe en `appointments`. Solo las claves que de verdad cambian. */
type ParcheAgenda = {
  status?: 'show' | 'no_show'
  offered?: boolean
  result?: Resultado
  needs_followup?: boolean
}

export type ResultadoMarcado = { patch: ParcheAgenda; avisos: string[] } | { error: string }

/**
 * Convierte el marcado del closer en el parche a escribir, aplicando las reglas del negocio.
 *
 * Lo que se DEDUCE en vez de preguntarse (§5 del encargo: no pedir lo que el sistema ya puede saber):
 *
 * - `resultado: 'venta'` implica que hubo oferta y que asistió. No se puede vender a quien no vino ni
 *   sin presentarle nada, así que marcar la venta rellena los dos. Preguntarlo por separado sería
 *   pedir tres clics para un dato que ya está contenido en el primero.
 * - `resultado: 'no_show'` implica `asistio: false`, y arrastra que no hubo oferta.
 * - `resultado: 'seguimiento'` NO implica que haya siguiente reunión agendada: "queda en seguimiento"
 *   y "tiene hueco en el calendario" son cosas distintas, y el BAMFAM mide la segunda. Se pregunta.
 */
export function construirParche(m: Marcado): ResultadoMarcado {
  const avisos: string[] = []
  const patch: ParcheAgenda = {}

  if (m.resultado !== undefined && !RESULTADOS.includes(m.resultado)) {
    return { error: `Resultado no reconocido: ${m.resultado}` }
  }

  // Asistencia declarada o deducida del resultado.
  let asistio = m.asistio
  if (m.resultado === 'no_show') {
    if (asistio === true) {
      return { error: 'No se puede marcar "No-show" y a la vez que sí asistió.' }
    }
    asistio = false
  }
  if (m.resultado === 'venta' && asistio === false) {
    return { error: 'No se puede registrar una venta en una llamada marcada como no asistida.' }
  }
  if (m.resultado === 'venta') asistio = true

  // Oferta declarada o deducida.
  let oferta = m.ofertaPresentada
  if (m.resultado === 'venta') {
    if (oferta === false) {
      return { error: 'No se puede registrar una venta sin oferta presentada.' }
    }
    if (oferta === undefined) avisos.push('Se marca la oferta como presentada: una venta la implica.')
    oferta = true
  }
  if (asistio === false) {
    if (oferta === true) {
      return { error: 'No se puede presentar una oferta en una llamada a la que no asistió nadie.' }
    }
    // Sin asistencia no hubo oferta. Se deja en false explícito, no en null: "no hubo oferta" es un
    // dato, y dejarlo nulo lo confundiría con "no lo hemos registrado".
    if (oferta === undefined) oferta = false
  }
  if (m.resultado === 'no_cualificado') {
    // Cualificada ES haber recibido la oferta, así que las dos cosas juntas se contradicen.
    if (oferta === true) {
      return { error: 'Si se le presentó la oferta, la llamada cuenta como cualificada: revisa el resultado.' }
    }
    // Y al revés: "no cualificado" ES "no se le lanzó la oferta". Dejarlo sin escribir era un hueco
    // real — la llamada quedaba con `offered` nulo, o sea "sin medir", cuando el closer acababa de
    // declarar justo lo contrario. El Coste por Agenda Cualificada la habría excluido del cómputo en
    // vez de contarla como no cualificada.
    if (oferta === undefined) oferta = false
  }

  if (asistio !== undefined) patch.status = asistio ? 'show' : 'no_show'
  if (oferta !== undefined) patch.offered = oferta
  if (m.resultado !== undefined) patch.result = m.resultado
  if (m.seguimientoAgendado !== undefined) patch.needs_followup = m.seguimientoAgendado

  if (Object.keys(patch).length === 0) return { error: 'No hay nada que marcar.' }
  return { patch, avisos }
}

/**
 * ¿Esta cita cuenta como cualificada? Una sola definición, usada por el Coste por Agenda Cualificada
 * y por el Pitch Rate, para que no puedan discrepar.
 *
 * `null` significa SIN MEDIR, que no es lo mismo que "no cualificada": un `offered` nulo es una cita
 * de antes de que se empezara a marcar. Quien agregue tiene que decidir qué hace con los nulos, y para
 * eso tiene que poder distinguirlos.
 */
export function esCualificada(cita: { offered?: boolean | null }): boolean | null {
  return cita.offered ?? null
}

/**
 * Denominador del BAMFAM, declarado explícitamente porque el encargo lo pide: reuniones ASISTIDAS que
 * NO acabaron en venta y sobre las que tiene sentido preguntar si hay siguiente paso.
 *
 * Quedan fuera las que no se celebraron (no hay nada que retomar de una llamada que no ocurrió) y las
 * que acabaron en venta (ya convirtieron: meterlas en el denominador hundiría la tasa castigando
 * precisamente los cierres).
 */
export function esElegibleBamfam(cita: { status?: string | null; result?: string | null }): boolean {
  if (cita.status !== 'show' && cita.status !== 'completed') return false
  return cita.result !== 'venta'
}
