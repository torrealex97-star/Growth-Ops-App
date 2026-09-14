// DESDE CUÁNDO UNA MÉTRICA PUEDE CONTARSE.
//
// LA REGLA, dicha por quien usa esto: "de lo que no haya datos no debe contar hasta que se comience a
// medir, y se miren los datos de esa fecha, y ahí sí pueda contar".
//
// EL PROBLEMA QUE RESUELVE. El Pitch Rate se calcula sobre `appointments.offered`. Ese campo existe
// desde siempre y está vacío en las 559 citas históricas. El día que los closers empiecen a marcarlo,
// una consulta ingenua de "Pitch Rate de este año" dividiría las ofertas marcadas en noviembre entre
// TODAS las asistidas del año — incluidas diez meses de citas donde nadie marcó nada. El resultado
// sería un 4% que no describe nada: ni el rendimiento del equipo, ni la realidad del histórico.
//
// Lo mismo al revés: mirar marzo cuando la medición empezó en noviembre no es "0% de ofertas", es
// "en marzo no medíamos esto". Son dos frases distintas y el dashboard tiene que decir la que toca.
//
// POR QUÉ ES UN MÓDULO PURO Y NO UNA CONSULTA. Aquí solo vive la aritmética de solapar un periodo con
// la fecha en la que empezó la medición. De dónde sale esa fecha (derivada del primer dato real, o
// declarada por configuración) es otra cosa y vive en la capa de consulta. Así esto se prueba sin
// base de datos, incluidos los bordes de mes y los cambios de hora.

import type { PeriodRange } from '@/lib/filters/period'

/**
 * `real` — todo el periodo estaba medido.
 * `parcial` — parte del periodo es anterior a la medición. El número es válido SOLO para la parte
 *   cubierta, y la UI tiene que decir cuál es.
 * `no_medido` — el periodo entero es anterior a la medición, o nunca se ha medido nada. NO es cero.
 */
type EstadoMetrica = 'real' | 'parcial' | 'no_medido'

export type Cobertura = {
  estado: EstadoMetrica
  /** Desde cuándo hay medición. `null` = no se ha medido nunca. */
  medidoDesde: Date | null
  /** La parte del periodo que sí está medida. `null` cuando no hay nada cubierto. */
  rangoCubierto: { from: Date; to: Date } | null
  /**
   * Fracción del periodo que está cubierta, de 0 a 1. Sirve para avisar de lo que falta ("solo el
   * 38% del periodo está medido"), nunca para escalar el número: multiplicar las ofertas marcadas
   * por 1/0.38 sería inventarse las que nadie registró.
   */
  fraccion: number
  /** Una frase para la UI. Sin códigos. */
  motivo: string
}

const dia = 24 * 60 * 60 * 1000

/** Fecha válida o null. Acepta lo que llega de base (string) y de la UI (Date). */
function comoFecha(valor: Date | string | null | undefined): Date | null {
  if (!valor) return null
  const d = valor instanceof Date ? valor : new Date(valor)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Cruza el periodo que se está mirando con la fecha en la que empezó a medirse la métrica.
 *
 * `periodo.from === null` significa "todo el histórico" (el preset 'all'). Con medición posterior al
 * inicio de los datos eso es `parcial` por definición: hay histórico anterior a la medición. No se
 * puede dar una fracción honesta ahí —no se sabe cuándo empieza "todo"— así que se devuelve 0 y el
 * motivo lo explica; la UI avisa sin fingir un porcentaje.
 */
export function coberturaDe(periodo: PeriodRange, medidoDesdeRaw: Date | string | null | undefined): Cobertura {
  const medidoDesde = comoFecha(medidoDesdeRaw)

  if (!medidoDesde) {
    return {
      estado: 'no_medido',
      medidoDesde: null,
      rangoCubierto: null,
      fraccion: 0,
      motivo: 'Todavía no se registra este dato, así que no hay nada que contar.',
    }
  }

  const hasta = periodo.to
  // Un periodo que termina ANTES de que empezara la medición no tiene nada que contar.
  if (hasta && hasta < medidoDesde) {
    return {
      estado: 'no_medido',
      medidoDesde,
      rangoCubierto: null,
      fraccion: 0,
      motivo: `En este periodo todavía no se registraba este dato (se empieza a medir el ${medidoDesde.toLocaleDateString('es-ES')}).`,
    }
  }

  const desde = periodo.from
  // Periodo que arranca ya dentro de la medición: cubierto entero.
  if (desde && desde >= medidoDesde) {
    return {
      estado: 'real',
      medidoDesde,
      rangoCubierto: { from: desde, to: hasta ?? new Date() },
      fraccion: 1,
      motivo: 'Todo el periodo está medido.',
    }
  }

  // A partir de aquí el periodo empieza antes de la medición: solo una parte cuenta.
  const inicioCubierto = medidoDesde
  const finCubierto = hasta ?? new Date()

  if (!desde) {
    return {
      estado: 'parcial',
      medidoDesde,
      rangoCubierto: { from: inicioCubierto, to: finCubierto },
      fraccion: 0,
      motivo: `Solo se cuenta desde el ${medidoDesde.toLocaleDateString('es-ES')}, cuando se empezó a medir. Lo anterior existe pero no se registraba.`,
    }
  }

  const totalMs = finCubierto.getTime() - desde.getTime()
  const cubiertoMs = finCubierto.getTime() - inicioCubierto.getTime()
  const fraccion = totalMs > 0 ? Math.max(0, Math.min(1, cubiertoMs / totalMs)) : 0
  const diasCubiertos = Math.max(1, Math.round(cubiertoMs / dia))

  return {
    estado: 'parcial',
    medidoDesde,
    rangoCubierto: { from: inicioCubierto, to: finCubierto },
    fraccion,
    motivo: `Solo se cuenta desde el ${medidoDesde.toLocaleDateString('es-ES')} (${diasCubiertos} día${diasCubiertos === 1 ? '' : 's'} de los que se miran). Lo anterior existe pero no se registraba.`,
  }
}

/**
 * Recorta el periodo a lo que de verdad está medido, para usarlo en la consulta.
 *
 * ESTO ES LO QUE EVITA EL NÚMERO FALSO: si el Pitch Rate se pide para "este año" y la medición empezó
 * en noviembre, tanto el numerador (ofertas) como el DENOMINADOR (asistidas) tienen que salir de
 * noviembre en adelante. Recortar solo el numerador es precisamente el error de dividir diez ofertas
 * entre las asistidas de todo el año.
 */
export function recortarAMedido(periodo: PeriodRange, cobertura: Cobertura): PeriodRange | null {
  if (cobertura.estado === 'no_medido') return null
  if (cobertura.estado === 'real') return periodo
  return cobertura.rangoCubierto ? { from: cobertura.rangoCubierto.from, to: cobertura.rangoCubierto.to } : null
}
