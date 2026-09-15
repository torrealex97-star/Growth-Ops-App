// ¿HUBO OFERTA? — la suposición declarada por el negocio, aplicada al LEER, nunca al escribir.
//
// LA REGLA: "si el closer no marca que NO hizo la oferta, es que la hizo".
//
// Es una buena decisión de producto: en una llamada celebrada, presentar la oferta es la norma y no
// presentarla es la excepción. La gente marca excepciones; nadie confirma lo que siempre pasa. Pedir
// un clic para decir "sí, hice mi trabajo" garantiza que a las dos semanas no lo marque nadie.
//
// DÓNDE SE APLICA, Y POR QUÉ IMPORTA: AL LEER, NO AL ESCRIBIR.
//
// En la base, `offered` sigue siendo `null` cuando nadie ha marcado nada. La suposición se aplica aquí,
// en la capa de métricas, y CADA VALOR SABE SI FUE DECLARADO O ASUMIDO. Si se escribiera `true` en la
// base, se perdería para siempre la diferencia entre "el closer dijo que presentó la oferta" y "nadie
// dijo nada y lo dimos por hecho" — y con ella, cualquier posibilidad de saber si el dato vale algo.
//
// LA CONSECUENCIA, dicha sin adornos: mientras nadie marque excepciones, el Pitch Rate será del 100%.
// Es lo que la suposición implica matemáticamente, no un fallo. La métrica empieza a informar cuando
// los closers marcan los "no", y hasta entonces el panel enseña cuántas están asumidas para que nadie
// lea ese 100% como un logro.
//
// LO QUE LA SUPOSICIÓN NO HACE. No inventa ofertas en llamadas que no se celebraron: sin asistencia no
// hubo nada que presentar, y ahí el valor es `false` por hecho, no por suposición.

import type { Veredicto } from '@/lib/metrics/cualificacion'

/** De dónde sale el valor. Es lo que permite saber cuánto del número es suposición. */
type OrigenOferta =
  /** El closer lo marcó explícitamente. */
  | 'declarado'
  /** Nadie lo marcó y se aplicó la suposición del negocio. */
  | 'asumido'
  /** Se deduce del hecho, no de una suposición: sin llamada no hubo oferta. */
  | 'derivado'
  /** No se puede saber ni asumir. */
  | 'sin_dato'

export type OfertaResuelta = {
  valor: Veredicto
  origen: OrigenOferta
  motivo: string
}

export type ConfigOferta = {
  /**
   * La suposición. `true` = una llamada celebrada sin marcar cuenta como oferta presentada.
   *
   * Configurable porque es una decisión de negocio, no una verdad: en un equipo donde presentar la
   * oferta NO sea la norma, esta suposición inflaría el Pitch Rate sistemáticamente.
   */
  asumirOfertaEnLlamadaAsistida: boolean
}

export const CONFIG_OFERTA_POR_DEFECTO: ConfigOferta = {
  asumirOfertaEnLlamadaAsistida: true,
}

type CitaOferta = { status?: string | null; offered?: boolean | null; result?: string | null }

const asistio = (c: CitaOferta) => c.status === 'show' || c.status === 'completed'
const cancelada = (c: CitaOferta) => typeof c.status === 'string' && c.status.startsWith('cancelled')

/**
 * Resuelve si hubo oferta, diciendo siempre de dónde sale el valor.
 *
 * ORDEN DE LAS COMPROBACIONES, y es deliberado:
 *
 * 1. Lo DECLARADO manda siempre. Una suposición no puede pisar lo que una persona afirmó.
 * 2. Un resultado incompatible manda sobre la suposición: si el closer marcó "no cualificado", ya dijo
 *    que no le presentó nada, aunque no tocara el botón de la oferta.
 * 3. Sin asistencia, `false` por HECHO —no por suposición—: no hubo llamada donde presentar nada.
 * 4. Llamada celebrada y sin marcar: aquí, y solo aquí, entra la suposición.
 */
export function resolverOferta(cita: CitaOferta, config: ConfigOferta = CONFIG_OFERTA_POR_DEFECTO): OfertaResuelta {
  if (cita.offered === true) {
    return { valor: true, origen: 'declarado', motivo: 'El closer marcó que presentó la oferta.' }
  }
  if (cita.offered === false) {
    return { valor: false, origen: 'declarado', motivo: 'El closer marcó que no presentó la oferta.' }
  }

  // El resultado puede decir lo mismo sin haber tocado el botón de la oferta.
  if (cita.result === 'no_cualificado') {
    return {
      valor: false,
      origen: 'declarado',
      motivo: 'El closer la marcó como no cualificada, así que no hubo oferta.',
    }
  }
  if (cita.result === 'no_show') {
    return { valor: false, origen: 'derivado', motivo: 'No se presentó nadie, así que no hubo oferta.' }
  }

  if (cancelada(cita) || cita.status === 'no_show') {
    return { valor: false, origen: 'derivado', motivo: 'La llamada no se celebró, así que no hubo oferta.' }
  }

  if (asistio(cita)) {
    if (!config.asumirOfertaEnLlamadaAsistida) {
      return { valor: null, origen: 'sin_dato', motivo: 'La llamada se celebró pero nadie marcó si hubo oferta.' }
    }
    return {
      valor: true,
      origen: 'asumido',
      motivo: 'Nadie marcó lo contrario: en una llamada celebrada se da por hecho que se presentó la oferta.',
    }
  }

  // Ni celebrada ni cancelada: sigue agendada o en un estado que no permite afirmar nada. La
  // suposición NO se estira hasta aquí — una llamada que aún no ha ocurrido no tiene oferta.
  return { valor: null, origen: 'sin_dato', motivo: 'La llamada todavía no se ha celebrado.' }
}

export type ResumenOferta = {
  /** Llamadas donde se puede afirmar algo sobre la oferta. Es el denominador del Pitch Rate. */
  evaluables: number
  conOferta: number
  sinOferta: number
  /** Cuántas de las que cuentan como oferta salen de la suposición y no de un marcado. */
  asumidas: number
  declaradas: number
  /** `null` si no hay nada evaluable — que NO es 0%. */
  pitchRate: number | null
  /**
   * Qué parte del resultado descansa en la suposición, de 0 a 1. Por encima de la mitad, el número
   * habla más del criterio por defecto que del equipo, y la UI tiene que decirlo.
   */
  proporcionAsumida: number
  /** La fiabilidad que le corresponde al número por cuánto se ha asumido. */
  fiabilidad: 'alta' | 'media' | 'baja'
}

/**
 * Agrega la resolución de un conjunto de llamadas.
 *
 * LA PROPORCIÓN ASUMIDA ES PARTE DEL RESULTADO, no una nota al pie. Un Pitch Rate del 100% con el 100%
 * asumido y otro del 82% con todo declarado son dos números con el mismo aspecto y valor informativo
 * opuesto. Devolverlos sin distinguir sería exactamente el tipo de cifra creíble y falsa que hay que
 * evitar.
 */
export function resumirOferta(resueltas: OfertaResuelta[]): ResumenOferta {
  let evaluables = 0
  let conOferta = 0
  let sinOferta = 0
  let asumidas = 0
  let declaradas = 0

  for (const r of resueltas) {
    if (r.valor === null) continue
    evaluables++
    if (r.valor) conOferta++
    else sinOferta++
    if (r.origen === 'asumido') asumidas++
    if (r.origen === 'declarado') declaradas++
  }

  const proporcionAsumida = evaluables > 0 ? asumidas / evaluables : 0
  return {
    evaluables,
    conOferta,
    sinOferta,
    asumidas,
    declaradas,
    pitchRate: evaluables > 0 ? (conOferta / evaluables) * 100 : null,
    proporcionAsumida,
    // Sin nada evaluable no hay fiabilidad que dar; con casi todo asumido, el número describe el
    // criterio por defecto más que al equipo.
    fiabilidad: evaluables === 0 ? 'baja' : proporcionAsumida > 0.5 ? 'baja' : proporcionAsumida > 0 ? 'media' : 'alta',
  }
}

/**
 * La frase que acompaña al Pitch Rate en el panel. Devuelve cadena vacía cuando no hay nada que
 * matizar, para no llenar la UI de avisos que nadie lee.
 */
export function avisoOferta(resumen: ResumenOferta): string {
  if (resumen.evaluables === 0) return ''
  if (resumen.asumidas === 0) return ''
  if (resumen.proporcionAsumida >= 1) {
    return `Ninguna llamada tiene la oferta marcada: las ${resumen.evaluables} se dan por presentadas. El dato empieza a informar cuando los closers marquen las que no lo fueron.`
  }
  const pct = Math.round(resumen.proporcionAsumida * 100)
  return `${resumen.asumidas} de ${resumen.evaluables} se dan por presentadas porque nadie marcó lo contrario (${pct}%).`
}
