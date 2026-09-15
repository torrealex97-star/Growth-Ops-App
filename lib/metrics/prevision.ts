// PREVISIÓN. La línea discontinua del gráfico.
//
// Una previsión es la parte del panel más fácil de convertir en mentira: basta con dibujar la línea sin
// decir de dónde sale. Aquí se obliga lo contrario.
//
// CUATRO LÍMITES, y los cuatro son deliberados:
//
// 1. MÍNIMO DE HISTÓRICO. Con menos de `MINIMO_PUNTOS` observaciones no se prevé nada. Dos puntos
//    definen una recta perfecta y la recta no significa nada.
// 2. NO SE PREVÉ MÁS ALLÁ DE LA MITAD DEL HISTÓRICO OBSERVADO. Con 8 semanas de datos se pueden prever
//    4, no 52. Extrapolar diez veces lo observado no es una previsión, es un dibujo.
// 3. EL MÉTODO SE DICE SIEMPRE, en texto, junto al número.
// 4. LA CONFIANZA SALE DEL AJUSTE (R²) Y DEL HISTÓRICO, no de las ganas. Una serie que va 3, 40, 2, 80
//    admite una recta; lo que no admite es que nadie decida con ella.
//
// Y el punto real y el previsto nunca se mezclan en la misma lista sin distinguirse: cada punto lleva su
// `tipo`, para que el gráfico pinte continuo lo medido y discontinuo lo proyectado.

export type PuntoSerie = { fecha: string; valor: number }

export type PuntoPrevisto = {
  fecha: string
  valor: number
  tipo: 'real' | 'previsto'
  minimo?: number
  maximo?: number
}

export type MetodoPrevision = 'regresion_lineal' | 'run_rate' | 'media_movil'

export type Prevision = {
  puntos: PuntoPrevisto[]
  /** Valor previsto al final del horizonte. */
  valorFinal: number | null
  metodo: MetodoPrevision
  /** Texto literal para la UI. Sin esto la línea discontinua es una afirmación sin autor. */
  explicacion: string
  confianza: 'alta' | 'media' | 'baja'
  /** Bondad del ajuste, 0-1. `null` para métodos que no ajustan una recta. */
  r2: number | null
  /** Cuántos pasos se han previsto y cuántos se pidieron: se recorta y se dice. */
  pasos: number
  pasosSolicitados: number
  aviso: string | null
}

/** Menos de esto no da para prever nada. */
export const MINIMO_PUNTOS = 4

/** No se prevé más allá de esta fracción del histórico observado. */
export const HORIZONTE_MAXIMO = 0.5

function regresion(valores: number[]): { pendiente: number; intercepto: number; r2: number } {
  const n = valores.length
  const mediaX = (n - 1) / 2
  const mediaY = valores.reduce((a, v) => a + v, 0) / n
  let sxy = 0
  let sxx = 0
  valores.forEach((v, i) => {
    sxy += (i - mediaX) * (v - mediaY)
    sxx += (i - mediaX) ** 2
  })
  const pendiente = sxx === 0 ? 0 : sxy / sxx
  const intercepto = mediaY - pendiente * mediaX
  let ssTot = 0
  let ssRes = 0
  valores.forEach((v, i) => {
    ssTot += (v - mediaY) ** 2
    ssRes += (v - (intercepto + pendiente * i)) ** 2
  })
  // Serie plana: el ajuste es perfecto pero R² es 0/0. Se declara 1 porque la recta describe la serie
  // exactamente, que es lo que R² mide.
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot)
  return { pendiente, intercepto, r2 }
}

function redondear(v: number): number {
  return Math.round(v * 100) / 100
}

export type OpcionesPrevision = {
  /** Cómo se generan las etiquetas de fecha de los puntos previstos. Sin esto el eje X se inventa. */
  siguienteFecha?: (ultima: string, paso: number) => string
  /** Si la métrica no puede ser negativa (ventas, leads, euros), se corta en cero. */
  noNegativa?: boolean
}

/**
 * Previsión por regresión lineal sobre la serie.
 *
 * Devuelve `null` cuando no hay base: menos de `MINIMO_PUNTOS`. Devolver una recta con tres puntos y
 * llamarlo previsión es el fallo que este módulo existe para no cometer.
 */
export function preverSerie(
  serie: PuntoSerie[],
  pasosSolicitados: number,
  opciones: OpcionesPrevision = {}
): Prevision | null {
  if (serie.length < MINIMO_PUNTOS || pasosSolicitados <= 0) return null

  const valores = serie.map((p) => p.valor)
  const { pendiente, intercepto, r2 } = regresion(valores)

  // LÍMITE 2: el horizonte se recorta a la mitad del histórico, y se avisa de que se ha recortado.
  const maximo = Math.max(1, Math.floor(serie.length * HORIZONTE_MAXIMO))
  const pasos = Math.min(pasosSolicitados, maximo)
  const aviso =
    pasos < pasosSolicitados
      ? `Se han pedido ${pasosSolicitados} pasos y solo hay ${serie.length} observaciones: el horizonte se ha recortado a ${pasos} para no extrapolar más allá de la mitad del histórico.`
      : null

  const ultima = serie[serie.length - 1].fecha
  const etiqueta = opciones.siguienteFecha ?? ((_u: string, paso: number) => `+${paso}`)

  const previstos: PuntoPrevisto[] = []
  for (let k = 1; k <= pasos; k++) {
    const bruto = intercepto + pendiente * (serie.length - 1 + k)
    const valor = opciones.noNegativa ? Math.max(0, bruto) : bruto
    previstos.push({ fecha: etiqueta(ultima, k), valor: redondear(valor), tipo: 'previsto' })
  }

  const confianza: Prevision['confianza'] =
    r2 >= 0.7 && serie.length >= 8 ? 'alta' : r2 >= 0.4 && serie.length >= MINIMO_PUNTOS ? 'media' : 'baja'

  const direccion = pendiente > 0 ? 'al alza' : pendiente < 0 ? 'a la baja' : 'plana'
  return {
    puntos: [...serie.map((p) => ({ ...p, tipo: 'real' as const })), ...previstos],
    valorFinal: previstos.length > 0 ? previstos[previstos.length - 1].valor : null,
    metodo: 'regresion_lineal',
    explicacion: `Regresión lineal sobre ${serie.length} observaciones (tendencia ${direccion}, ${redondear(pendiente)} por paso, R²=${redondear(r2)}). Proyección, no compromiso.`,
    confianza,
    r2: redondear(r2),
    pasos,
    pasosSolicitados,
    aviso,
  }
}

/**
 * Previsión de cierre por run-rate: lo acumulado dividido por lo transcurrido.
 *
 * Es el método correcto para "¿cuánto voy a facturar este mes?" y es distinto de la regresión: aquí no
 * hay serie, hay un acumulado y una fracción de periodo. Se declara aparte para que la explicación no
 * mienta sobre cómo se ha calculado.
 */
export function preverCierrePorRunRate(
  acumulado: number,
  fraccionTranscurrida: number,
  opciones: { objetivo?: number | null; etiquetaPeriodo?: string } = {}
): {
  proyeccion: number
  metodo: MetodoPrevision
  explicacion: string
  confianza: 'alta' | 'media' | 'baja'
  alcanzaObjetivo: boolean | null
} | null {
  if (!(fraccionTranscurrida > 0) || fraccionTranscurrida > 1) return null
  const proyeccion = redondear(acumulado / fraccionTranscurrida)
  // Al principio del periodo el run-rate es casi ruido: un buen día 2 proyecta un mes histórico.
  const confianza = fraccionTranscurrida >= 0.6 ? 'alta' : fraccionTranscurrida >= 0.3 ? 'media' : 'baja'
  const objetivo = opciones.objetivo ?? null
  return {
    proyeccion,
    metodo: 'run_rate',
    explicacion: `Run-rate: ${acumulado} acumulado con el ${Math.round(fraccionTranscurrida * 100)}% ${opciones.etiquetaPeriodo ? `de ${opciones.etiquetaPeriodo} ` : ''}transcurrido → ${proyeccion} proyectado al cierre. Asume que el ritmo se mantiene.`,
    confianza,
    alcanzaObjetivo: objetivo === null ? null : proyeccion >= objetivo,
  }
}
