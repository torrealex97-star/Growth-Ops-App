// UNA RAZÓN SIN MUESTRA NO ES CERO (auditoría F22).
//
// Varias pantallas calculaban `den > 0 ? (num / den) * 100 : 0`. Con denominador 0 eso pinta «0 %», que
// se lee como «rendimiento cero» cuando en realidad significa «todavía no hay ningún caso». CSM enseñaba
// show rate y éxito al 0 % sin un solo evento; Alumnos, onboarding al 0 % sin ningún enviado. Es la misma
// regla que ya aplica `lib/metrics/agregados.ts` (un hueco no es un cero), llevada a las pantallas.
//
// Y un 100 % sobre un solo caso no es una buena noticia, es una muestra de uno: por eso toda razón lleva
// su numerador y su total, para poder enseñarlos y para marcar la muestra baja.

export type Razon = {
  /** Porcentaje 0-100, o `null` si no hay ningún caso sobre el que calcularlo. */
  valor: number | null
  n: number
  total: number
}

/** Por debajo de este número de casos, la razón se marca como muestra baja. */
export const MUESTRA_MINIMA = 5

export function razon(n: number, total: number): Razon {
  return { valor: total > 0 ? (n / total) * 100 : null, n, total }
}

/** Media de una lista; `null` si no hay valores (un grado medio de 0 no es lo mismo que «sin notas»). */
export function promedio(valores: number[]): number | null {
  return valores.length > 0 ? valores.reduce((a, b) => a + b, 0) / valores.length : null
}

export function esMuestraBaja(r: Razon, minimo: number = MUESTRA_MINIMA): boolean {
  return r.total > 0 && r.total < minimo
}

/** «3 de 8», «1 de 1 · muestra baja» o «sin muestra»: lo que acompaña al porcentaje. */
export function detalleMuestra(r: Razon, minimo: number = MUESTRA_MINIMA): string {
  if (r.total === 0) return 'sin muestra'
  return `${r.n} de ${r.total}${esMuestraBaja(r, minimo) ? ' · muestra baja' : ''}`
}
