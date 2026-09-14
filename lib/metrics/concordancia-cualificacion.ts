// DOS CUALIFICACIONES, DOS DUEÑOS — Y EL HUECO ENTRE ELLAS ES UNA MÉTRICA.
//
// LA DISTINCIÓN, dicha por quien la usa: "una cosa es una agenda cualificada y otra cosa es un
// prospecto cualificado; una la identifica marketing y la otra ventas. Casi siempre deben ser lo
// mismo, a no ser que la persona mienta en el form o el closer se dé cuenta de que tiene algún tipo
// de problema de personalidad o mental".
//
//   AGENDA CUALIFICADA (marketing)   → del formulario, se sabe AL RESERVAR. Es de lo que responde
//                                      marketing: el coste por agenda cualificada se calcula aquí.
//   PROSPECTO CUALIFICADO (ventas)   → del juicio del closer en la llamada. Es de lo que responde
//                                      ventas: el Pitch Rate y el Close Rate se calculan aquí.
//
// POR QUÉ MERECE MÓDULO PROPIO. Porque "casi siempre deben ser lo mismo" convierte la DISCREPANCIA en
// información, no en ruido. Si marketing trae 100 agendas cualificadas y ventas solo confirma 40, el
// cuello de botella no son los closers: es que el formulario no filtra —preguntas demasiado fáciles,
// segmentación mala, o gente diciendo lo que hace falta para conseguir la llamada—. Y al revés, si
// ventas confirma prospectos que el formulario descartó, el filtro está dejando fuera negocio.
//
// Sin esta comparación, las dos cifras viven en pantallas distintas y nadie ve que se contradicen.
//
// NO SE PROMEDIAN NI SE FUNDEN EN UN "CUALIFICADO" ÚNICO. Cada departamento responde de la suya, y un
// número intermedio no lo responde nadie.

import type { Veredicto } from '@/lib/metrics/cualificacion'

/**
 * `concuerdan_si` / `concuerdan_no` — las dos coinciden. Es lo normal y lo deseable.
 * `solo_marketing` — el formulario la cualificó y el closer no. El filtro no está filtrando.
 * `solo_ventas` — el closer la cualificó y el formulario no. El filtro deja fuera negocio.
 * `sin_juicio_ventas` — hubo llamada pero el closer no se pronunció. Un hueco de proceso.
 * `sin_dato` — falta información de una de las dos partes. NO es una discrepancia.
 */
export type Concordancia =
  'concuerdan_si' | 'concuerdan_no' | 'solo_marketing' | 'solo_ventas' | 'sin_juicio_ventas' | 'sin_dato'

export type EvaluacionConcordancia = {
  concordancia: Concordancia
  /** ¿Cuenta como discrepancia real para la tasa? Solo `solo_marketing` y `solo_ventas`. */
  esDiscrepancia: boolean
  /** Explicación en una frase, para el tooltip y el drill-down. */
  motivo: string
  /** Qué mirar cuando esto se repite. Vacío cuando no hay nada que accionar. */
  implicacion: string
}

/**
 * El juicio de VENTAS a partir de lo que marcó el closer.
 *
 * Se deriva de dos señales que ya se escriben en la agenda, sin pedir un campo nuevo:
 *
 * - `result === 'no_cualificado'` → el closer la descarta explícitamente.
 * - `offered === true` → le presentó la oferta, que en la práctica ES confirmar que merecía el pitch.
 *   Es la regla que ya rige el resto del sistema: "si asiste y no se le lanza la oferta es que no
 *   estaba cualificada".
 *
 * `offered === false` con un resultado que NO es 'no_cualificado' se queda en `null` a propósito: no
 * lanzar la oferta puede ser falta de tiempo o un reagendado, no un descarte. Convertirlo en `false`
 * castigaría a ventas por llamadas que se quedaron a medias.
 */
export function cualificacionVentas(cita: {
  status?: string | null
  offered?: boolean | null
  result?: string | null
}): Veredicto {
  if (cita.result === 'no_cualificado') return false
  if (cita.offered === true) return true
  return null
}

/**
 * Compara las dos cualificaciones de una misma agenda.
 *
 * `marketing` sale de `evaluarCualificacion()` sobre las respuestas del formulario; `ventas`, de
 * `cualificacionVentas()` sobre lo que marcó el closer.
 *
 * `huboLlamada` importa para distinguir dos silencios muy distintos: un no-show no tiene juicio de
 * ventas porque no hubo nada que juzgar, mientras que una llamada celebrada sin marcar es un hueco de
 * proceso que alguien debería cerrar.
 */
export function compararCualificaciones(
  marketing: Veredicto,
  ventas: Veredicto,
  huboLlamada: boolean
): EvaluacionConcordancia {
  if (marketing === null && ventas === null) {
    return {
      concordancia: 'sin_dato',
      esDiscrepancia: false,
      motivo: 'No hay ni cualificación de marketing ni juicio de ventas.',
      implicacion: '',
    }
  }

  if (ventas === null) {
    if (!huboLlamada) {
      return {
        concordancia: 'sin_dato',
        esDiscrepancia: false,
        motivo: 'La llamada no se celebró, así que ventas no tuvo nada que juzgar.',
        implicacion: '',
      }
    }
    return {
      concordancia: 'sin_juicio_ventas',
      esDiscrepancia: false,
      motivo: 'La llamada se celebró pero el closer no dejó su valoración.',
      implicacion: 'Sin este dato no se puede saber si el formulario está filtrando bien.',
    }
  }

  if (marketing === null) {
    return {
      concordancia: 'sin_dato',
      esDiscrepancia: false,
      motivo: 'El formulario no da suficiente información para cualificar, así que no hay con qué comparar.',
      implicacion: 'Revisar si el formulario de esa campaña incluye las preguntas de cualificación.',
    }
  }

  if (marketing === ventas) {
    return {
      concordancia: marketing ? 'concuerdan_si' : 'concuerdan_no',
      esDiscrepancia: false,
      motivo: marketing
        ? 'Formulario y closer coinciden: prospecto cualificado.'
        : 'Formulario y closer coinciden: no cualificado.',
      implicacion: '',
    }
  }

  if (marketing === true && ventas === false) {
    return {
      concordancia: 'solo_marketing',
      esDiscrepancia: true,
      // Las dos causas que el negocio reconoce, dichas tal cual: o la respuesta no era cierta, o el
      // closer vio algo que un formulario no puede ver.
      motivo: 'El formulario la cualificó y el closer la descartó en la llamada.',
      implicacion:
        'O la respuesta del formulario no era cierta, o el closer detectó algo que el formulario no puede ver. Si se repite, el filtro del formulario no está filtrando.',
    }
  }

  return {
    concordancia: 'solo_ventas',
    esDiscrepancia: true,
    motivo: 'El formulario no la cualificó y el closer sí le presentó la oferta.',
    implicacion:
      'El filtro del formulario puede estar dejando fuera negocio real: revisar el umbral y las opciones de respuesta.',
  }
}

export type ResumenConcordancia = {
  /** Agendas donde SE PUEDE comparar: las dos partes se pronunciaron. Es el denominador. */
  comparables: number
  concuerdan: number
  soloMarketing: number
  soloVentas: number
  /** Llamadas celebradas sin valoración del closer. No entran en el denominador, pero se avisan. */
  sinJuicioVentas: number
  sinDato: number
  /**
   * Porcentaje de acuerdo sobre lo comparable. `null` cuando no hay nada comparable — que NO es 0%:
   * un 0% diría que marketing y ventas nunca coinciden, cuando lo que pasa es que aún no se ha
   * comparado nada.
   */
  tasaConcordancia: number | null
}

/**
 * Agrega la comparación de un conjunto de agendas.
 *
 * EL DENOMINADOR ES LO COMPARABLE, no el total. Meter en él las agendas sin juicio de ventas hundiría
 * la tasa de acuerdo por falta de marcado, y el número diría "marketing y ventas no se entienden"
 * cuando lo que pasa es que nadie rellenó su parte. Esas salen contadas aparte, porque también hay
 * que verlas.
 */
export function resumirConcordancia(evaluaciones: EvaluacionConcordancia[]): ResumenConcordancia {
  const r: ResumenConcordancia = {
    comparables: 0,
    concuerdan: 0,
    soloMarketing: 0,
    soloVentas: 0,
    sinJuicioVentas: 0,
    sinDato: 0,
    tasaConcordancia: null,
  }

  for (const e of evaluaciones) {
    switch (e.concordancia) {
      case 'concuerdan_si':
      case 'concuerdan_no':
        r.comparables++
        r.concuerdan++
        break
      case 'solo_marketing':
        r.comparables++
        r.soloMarketing++
        break
      case 'solo_ventas':
        r.comparables++
        r.soloVentas++
        break
      case 'sin_juicio_ventas':
        r.sinJuicioVentas++
        break
      case 'sin_dato':
        r.sinDato++
        break
    }
  }

  r.tasaConcordancia = r.comparables > 0 ? (r.concuerdan / r.comparables) * 100 : null
  return r
}
