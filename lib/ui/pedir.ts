// UN SOLO SISTEMA DE PETICIONES Y ERRORES.
//
// EL BUG QUE ESTO ARREGLA, y es el de la pantalla negra. El patrón repetido en la app era:
//
//     setLoading(true)
//     const r = await fetch(url)      // ← si esto RECHAZA, no se ejecuta nada más
//     ...
//     setLoading(false)               // ← nunca llega
//
// Sin `try/catch/finally`, cualquier fallo de red, un 502 con HTML de Vercel en vez de JSON, o una
// pestaña que pierde conectividad un segundo, deja `loading` en true PARA SIEMPRE. No es un fallo
// visible: es una pantalla que se queda cargando y no vuelve. Y sin timeout, una petición que nunca
// responde produce exactamente lo mismo aunque nadie lance ningún error.
//
// `pedir` NUNCA lanza. Devuelve un resultado que hay que mirar, con el TIPO de fallo, porque cada uno
// se le cuenta al usuario de forma distinta: un 403 no es "error de conexión", y un 0 filas no es un
// error en absoluto.

/** Por qué falló. Cada valor tiene un mensaje y una acción distinta en la UI. */
export type TipoFallo =
  | 'timeout' // tardó más de lo permitido
  | 'cancelado' // el usuario navegó a otra parte: NO es un error que enseñar
  | 'red' // no se pudo llegar al servidor
  | 'auth' // 401: sesión caducada
  | 'permiso' // 403: el rol no llega
  | 'no_encontrado' // 404
  | 'servidor' // 5xx
  | 'peticion' // 4xx del resto
  | 'formato' // respondió algo que no era el JSON esperado

export type Fallo = {
  ok: false
  tipo: TipoFallo
  /** Mensaje para la persona, en español y sin jerga de red. */
  mensaje: string
  status: number | null
  /** ¿Tiene sentido ofrecer "Reintentar"? Un 403 no se arregla reintentando. */
  reintentable: boolean
}

type Exito<T> = { ok: true; data: T; status: number }

export type Resultado<T> = Exito<T> | Fallo

/** Techo por defecto. Más allá de esto, la pantalla tiene que decir algo en vez de seguir esperando. */
export const TIMEOUT_POR_DEFECTO_MS = 15_000

const MENSAJES: Record<TipoFallo, string> = {
  timeout: 'La petición ha tardado demasiado. Puede ser la conexión o el servidor.',
  cancelado: 'Petición cancelada.',
  red: 'No se ha podido conectar. Comprueba tu conexión.',
  auth: 'Tu sesión ha caducado. Vuelve a entrar.',
  permiso: 'No tienes permiso para ver esto.',
  no_encontrado: 'No se ha encontrado lo que se pedía.',
  servidor: 'El servidor ha fallado. Vuelve a intentarlo en un momento.',
  peticion: 'La petición no era válida.',
  formato: 'El servidor ha respondido algo inesperado.',
}

// Reintentar un 403 o un 404 no cambia nada y solo entretiene a quien espera. Un 5xx o un corte de
// red sí: por eso el botón "Reintentar" aparece según esto y no siempre.
const REINTENTABLE: Record<TipoFallo, boolean> = {
  timeout: true,
  cancelado: false,
  red: true,
  auth: false,
  permiso: false,
  no_encontrado: false,
  servidor: true,
  peticion: false,
  formato: true,
}

export function fallo(tipo: TipoFallo, status: number | null = null, mensaje?: string): Fallo {
  return { ok: false, tipo, mensaje: mensaje || MENSAJES[tipo], status, reintentable: REINTENTABLE[tipo] }
}

/** Traduce un código HTTP al tipo de fallo que le corresponde. */
export function tipoPorStatus(status: number): TipoFallo {
  if (status === 401) return 'auth'
  if (status === 403) return 'permiso'
  if (status === 404) return 'no_encontrado'
  if (status >= 500) return 'servidor'
  return 'peticion'
}

/** Clasifica lo que lanzó un fetch. `AbortError` es ambiguo: puede ser timeout o navegación. */
export function tipoPorExcepcion(e: unknown, porTimeout: boolean): TipoFallo {
  const nombre = e instanceof Error ? e.name : ''
  if (nombre === 'AbortError' || nombre === 'TimeoutError') return porTimeout ? 'timeout' : 'cancelado'
  return 'red'
}

export type OpcionesPedir = RequestInit & {
  /** Milisegundos antes de rendirse. `null` para no poner techo (solo para descargas largas). */
  timeoutMs?: number | null
  /** Señal de quien llama, para cancelar al desmontar o al cambiar de pantalla. */
  signal?: AbortSignal
}

/**
 * Una petición JSON que no puede dejar una pantalla colgada.
 *
 * Garantías: siempre resuelve (nunca lanza), siempre con un `tipo` que la UI puede traducir a un
 * estado concreto, y siempre con techo de tiempo salvo que se pida lo contrario a propósito.
 */
export async function pedir<T = unknown>(url: string, opciones: OpcionesPedir = {}): Promise<Resultado<T>> {
  const { timeoutMs = TIMEOUT_POR_DEFECTO_MS, signal: externa, ...init } = opciones
  const control = new AbortController()
  let porTimeout = false

  const temporizador =
    timeoutMs === null
      ? null
      : setTimeout(() => {
          porTimeout = true
          control.abort()
        }, timeoutMs)

  // La señal de quien llama se encadena: si el componente se desmonta, la petición se corta y el
  // resultado se marca como `cancelado`, que la UI NO enseña como error.
  const alAbortarExterna = () => control.abort()
  externa?.addEventListener('abort', alAbortarExterna, { once: true })

  try {
    const res = await fetch(url, { ...init, signal: control.signal })
    if (!res.ok) {
      // El cuerpo de error puede traer un mensaje útil del servidor. Si no es JSON, no se insiste.
      const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null
      return fallo(tipoPorStatus(res.status), res.status, cuerpo?.error)
    }
    // 204 y cuerpos vacíos son éxito sin datos, no un fallo de formato.
    if (res.status === 204) return { ok: true, data: undefined as T, status: res.status }
    const texto = await res.text()
    if (texto.trim() === '') return { ok: true, data: undefined as T, status: res.status }
    try {
      return { ok: true, data: JSON.parse(texto) as T, status: res.status }
    } catch {
      return fallo('formato', res.status)
    }
  } catch (e) {
    return fallo(tipoPorExcepcion(e, porTimeout))
  } finally {
    // El finally que faltaba en toda la app: el temporizador y el listener se sueltan pase lo que pase.
    if (temporizador) clearTimeout(temporizador)
    externa?.removeEventListener('abort', alAbortarExterna)
  }
}

/**
 * ¿Hay que enseñar este fallo? Una cancelación por navegar a otra pantalla no es un error del que
 * informar: enseñar "error de red" porque alguien cambió de página es mentirle.
 */
export function esFalloVisible(r: Resultado<unknown>): boolean {
  return !r.ok && r.tipo !== 'cancelado'
}
