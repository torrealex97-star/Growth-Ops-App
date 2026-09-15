// CUÁNDO SE ENSEÑA UN LOADER, Y CUÁNDO NO.
//
// Un loader que aparece para una petición de 80 ms es peor que ningún loader: produce un parpadeo que
// se lee como un fallo. Y un loader que no cambia nunca, por muchos segundos que pasen, le dice a la
// persona que espere sin decirle que algo va mal.
//
// Tres fases, y la lógica vive aquí —fuera de React— para poder probarla sin montar un componente:
//
//   OCULTO  (< 300 ms)     nada. La mayoría de las peticiones caben aquí y no se ve ningún loader.
//   VISIBLE (300 ms – 6 s) el skeleton o el loader de marca.
//   LENTO   (> 6 s)        lo mismo, más "está tardando más de lo normal" y las salidas: reintentar/volver.

export type FaseCarga = 'oculto' | 'visible' | 'lento'

/** Por debajo de esto no se enseña nada: el loader parpadearía. */
export const RETARDO_LOADER_MS = 300

/** A partir de aquí se avisa de que está tardando, y se ofrece salida. */
export const UMBRAL_LENTO_MS = 6_000

export function faseCarga(
  cargando: boolean,
  msTranscurridos: number,
  opciones: { retardoMs?: number; lentoMs?: number } = {}
): FaseCarga {
  if (!cargando) return 'oculto'
  const retardo = opciones.retardoMs ?? RETARDO_LOADER_MS
  const lento = opciones.lentoMs ?? UMBRAL_LENTO_MS
  if (msTranscurridos >= lento) return 'lento'
  if (msTranscurridos >= retardo) return 'visible'
  return 'oculto'
}

/**
 * Los nueve estados que una pantalla de datos puede tener, y que la app trataba como dos ("cargando" y
 * "vacío"). Distinguirlos es la diferencia entre "no has facturado nada" y "no hay ventas importadas":
 * el primero es un problema comercial y el segundo de integración, y confundirlos hace que alguien
 * tome una decisión sobre datos que no existen.
 */
export type EstadoDatos =
  | 'cargando'
  | 'vacio' // hay fuente, no hay filas que cumplan el filtro
  | 'cero_real' // el resultado medido ES cero. Es un dato, no una ausencia.
  | 'sin_configurar' // falta configuración (p. ej. no se ha puesto el objetivo)
  | 'desconectado' // la integración no está conectada
  | 'sincronizacion_fallida' // está conectada, pero la última sincronización falló
  | 'sincronizando'
  | 'desactualizado' // hay datos, pero de hace demasiado
  | 'sin_permiso'
  | 'error'

/** ¿Este estado permite fiarse del número que hay en pantalla? */
export function datoFiable(estado: EstadoDatos): boolean {
  return estado === 'cero_real' || estado === 'vacio'
}

/**
 * ¿Se puede pintar un 0? Solo cuando se ha medido y ha salido cero. En todos los demás casos el 0 es
 * una invención: un guion o un aviso dicen la verdad, un 0 no.
 */
export function puedePintarCero(estado: EstadoDatos): boolean {
  return estado === 'cero_real'
}
