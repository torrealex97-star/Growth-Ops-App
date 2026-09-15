// AGENDA CUALIFICADA: la definición del negocio, aplicada sobre las respuestas del formulario.
//
// LA DEFINICIÓN, dicha por quien la usa: "consideramos una agenda cualificada cuando tiene el
// problema que el negocio soluciona y tiene para pagar, al menos cobra 1000€ al mes".
//
// OJO CON UNA DEFINICIÓN ANTERIOR QUE NO ES ESTA. En una conversación previa se dijo que cualificada
// era "a la que se le lanzó la oferta". Son dos cosas distintas y no pueden compartir nombre:
//
//   - CUALIFICADA (esto)     → se sabe AL RESERVAR, sale del formulario. Es el denominador del
//                              Coste por Agenda Cualificada (CPQBC), que hay que poder calcular sin
//                              esperar a que ocurra la llamada.
//   - OFERTA PRESENTADA      → se sabe DESPUÉS de la llamada, la marca el closer (`offered`). Es el
//                              denominador del Pitch Rate y del Close Rate sobre ofertas.
//
// Mezclarlas haría que el CPQBC de una campaña dependiera de si el closer se acordó de marcar algo
// tres días más tarde.
//
// POR QUÉ ES UN MÓDULO PURO. Decide un denominador financiero (el coste por agenda cualificada), así
// que se prueba sin base de datos. Y porque las preguntas del formulario CAMBIAN: en la base real hay
// tres redacciones distintas de la pregunta de ingresos y dos de la de insatisfacción, según la
// versión del formulario de cada momento. Un parseo repartido por la UI habría dejado de funcionar en
// silencio con la siguiente versión.
//
// NADA DE IA AQUÍ. La cualificación sale de respuestas declaradas por la propia persona, con reglas
// legibles y auditables. Inferirla de una transcripción produciría un número que nadie puede
// reproducir ni discutir.

/** Una respuesta del formulario, ya normalizada e independiente del proveedor. */
export type RespuestaFormulario = { pregunta: string; respuesta: string }

/**
 * `true` cumple, `false` no cumple, `null` NO SE SABE.
 *
 * El `null` es la mitad del valor de este módulo: una agenda sin la pregunta contestada no es una
 * agenda no cualificada. Colapsarlos metería en el numerador del "no cualificadas" a todo el que
 * reservó por un formulario más corto, y el CPQBC saldría inflado.
 */
export type Veredicto = boolean | null

export type Cualificacion = {
  cualificada: Veredicto
  /** Tiene el problema que el negocio resuelve. */
  tieneProblema: Veredicto
  /** Declara ingresos suficientes para pagar. */
  puedePagar: Veredicto
  /** Los ingresos en euros que se han podido leer, cuando la respuesta lo permite. */
  ingresosEur: { min: number | null; max: number | null } | null
  /** `alta` = respuesta de opción cerrada; `media` = texto libre interpretado; `baja` = no se sabe. */
  fiabilidad: 'alta' | 'media' | 'baja'
  /** Por qué ha salido así. Para el tooltip y el drill-down, en frases, sin códigos. */
  motivos: string[]
}

/**
 * Umbral y redacciones, configurables por subcuenta. Los valores por defecto NO son inventados:
 * salen de las respuestas realmente presentes en la base (473 agendas de Calendly).
 */
export type ConfigCualificacion = {
  /** Ingresos mensuales mínimos, en euros. El negocio lo fija en 1000. */
  ingresosMinimosEur: number
  /** Fragmentos que identifican la pregunta de ingresos, en minúsculas y sin acentos exigidos. */
  patronesIngresos: string[]
  /** Fragmentos que identifican la pregunta de dolor/situación. */
  patronesProblema: string[]
  /**
   * En la escala 1-10 de insatisfacción, desde dónde se considera que hay problema. Configurable
   * porque es un juicio de negocio: no hay nada en el dato que diga que un 7 duele y un 6 no.
   */
  insatisfaccionMinima: number
}

const CONFIG_CUALIFICACION_POR_DEFECTO: ConfigCualificacion = {
  ingresosMinimosEur: 1000,
  patronesIngresos: ['ingresos', 'generando al mes', 'facturas', 'cuanto ganas'],
  patronesProblema: ['escala del 1 al 10', 'como te sientes', 'situacion laboral', 'que te ha motivado'],
  insatisfaccionMinima: 7,
}

/** Quita acentos y baja a minúsculas: las redacciones varían en tildes entre versiones del form. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

const contieneAlguno = (texto: string, patrones: string[]) =>
  patrones.some((p) => normalizar(texto).includes(normalizar(p)))

/**
 * RANGOS CERRADOS OBSERVADOS EN LA BASE. Son los que cubren 385 de las 400 respuestas de ingresos, y
 * se resuelven por tabla en vez de por parseo: un rango declarado no se interpreta, se lee.
 *
 * "Entre 600 y 1.000€" tiene tope 1.000, así que NO garantiza cobrar AL MENOS 1.000. Se cuenta como
 * que no cumple. Es la lectura conservadora, y la contraria metería 134 agendas en el numerador de
 * cualificadas por un límite que solo se toca en el extremo.
 */
const RANGOS_CERRADOS: { patron: string; min: number | null; max: number | null }[] = [
  { patron: 'menos de 600', min: 0, max: 600 },
  { patron: 'inferior a 600', min: 0, max: 600 },
  { patron: 'entre 600 y 1.000', min: 600, max: 1000 },
  { patron: 'entre 600 y 1000', min: 600, max: 1000 },
  { patron: 'menos de 1.000', min: 0, max: 1000 },
  { patron: 'menos de 1000', min: 0, max: 1000 },
  { patron: 'entre 1.000', min: 1000, max: 2000 },
  { patron: 'entre 1000', min: 1000, max: 2000 },
  { patron: 'entre 2.000', min: 2000, max: 3000 },
  { patron: 'entre 2000', min: 2000, max: 3000 },
  { patron: 'mas de 3.000', min: 3000, max: null },
  { patron: 'mas de 3000', min: 3000, max: null },
]

/** Monedas que NO son euros y aparecen de verdad en las respuestas (bolívares, dólares). */
const OTRA_MONEDA = /(\bbs\b|bolivar|\$|usd|\bmxn\b|\bcop\b|\bars\b|\bpen\b|\bclp\b)/

/**
 * Lee los ingresos declarados. Devuelve `null` en `cumple` cuando no se puede saber, nunca `false`
 * por defecto.
 *
 * NO SE CONVIERTE MONEDA. "1000 bs" son bolívares, no mil euros: tratarlo como mil euros movería una
 * agenda al lado cualificado por un símbolo. Y aplicar un tipo de cambio inventado sería peor, porque
 * el número resultante parecería exacto.
 */
export function leerIngresos(
  respuesta: string,
  config: ConfigCualificacion = CONFIG_CUALIFICACION_POR_DEFECTO
): {
  min: number | null
  max: number | null
  cumple: Veredicto
  fiabilidad: 'alta' | 'media' | 'baja'
  motivo: string
} {
  const texto = normalizar(respuesta)
  // Para reconocer el rango se ignoran los símbolos de moneda: en la base hay "Menos de $600", que es
  // el mismo tope que "Menos de 600€". Un TECHO por debajo del umbral no llega en ninguna moneda
  // plausible, así que la ambigüedad de divisa no cambia el veredicto — solo importa cuando la
  // respuesta pretende SUPERAR el umbral, y eso lo filtra la comprobación de moneda de más abajo.
  const textoSinMoneda = texto.replace(/[$€£]/g, '')

  // 1) Opción cerrada: se lee de tabla.
  for (const r of RANGOS_CERRADOS) {
    if (textoSinMoneda.includes(r.patron)) {
      // Cumple solo si el SUELO del rango ya alcanza el umbral: un rango que llega justo al umbral por
      // arriba no garantiza alcanzarlo.
      const cumple = r.min !== null && r.min >= config.ingresosMinimosEur
      return {
        min: r.min,
        max: r.max,
        cumple,
        fiabilidad: 'alta',
        motivo: cumple
          ? `Declara ingresos de ${r.min}€ o más.`
          : `Declara ingresos por debajo de ${config.ingresosMinimosEur}€ (${respuesta.trim()}).`,
      }
    }
  }

  // 2) Declara explícitamente que no tiene ingresos. Es un dato, no un hueco.
  if (
    /^0\b|sin ingreso|ningun|no tengo (como )?(trabajo|ganar|ingreso)|aun no tengo trabajo|no estoy trabajando/.test(
      texto
    )
  ) {
    return { min: 0, max: 0, cumple: false, fiabilidad: 'alta', motivo: 'Declara no tener ingresos.' }
  }

  // 3) Otra moneda: no se convierte y no se adivina.
  if (OTRA_MONEDA.test(texto)) {
    return {
      min: null,
      max: null,
      cumple: null,
      fiabilidad: 'baja',
      motivo: `La respuesta está en otra moneda ("${respuesta.trim()}"): no se convierte para no inventar el importe.`,
    }
  }

  // 4) Texto libre con números: se leen y se usa el MENOR como suelo declarado.
  const numeros = texto.match(/\d[\d.\s]*/g)?.map((n) => Number(n.replace(/[.\s]/g, ''))) ?? []
  const validos = numeros.filter((n) => Number.isFinite(n) && n > 0 && n < 1_000_000)
  if (validos.length > 0) {
    const min = Math.min(...validos)
    const max = Math.max(...validos)
    return {
      min,
      max,
      cumple: min >= config.ingresosMinimosEur,
      fiabilidad: 'media',
      motivo: `Interpretado de texto libre: ${respuesta.trim()}.`,
    }
  }

  return {
    min: null,
    max: null,
    cumple: null,
    fiabilidad: 'baja',
    motivo: `No se puede leer un importe de la respuesta ("${respuesta.trim()}").`,
  }
}

/**
 * ¿Declara el problema que el negocio resuelve?
 *
 * Dos señales, según qué versión del formulario contestó:
 *
 * - La escala 1-10 de insatisfacción: por encima del umbral configurado, hay problema.
 * - Las opciones cerradas de "cómo te sientes": las cuatro que existen en la base declaran
 *   insatisfacción o deseo de cambio ("busco una oportunidad para generar ingresos online", "no me
 *   siento satisfecha y quiero un cambio profesional", "me gusta pero quiero aumentar mis ingresos",
 *   "siento que estoy estancada"). Se dice claro porque tiene una consecuencia: en esta versión del
 *   formulario esa pregunta NO discrimina, y presentarla como si filtrara sería engañoso.
 */
export function leerProblema(
  respuestas: RespuestaFormulario[],
  config: ConfigCualificacion = CONFIG_CUALIFICACION_POR_DEFECTO
): { tiene: Veredicto; fiabilidad: 'alta' | 'media' | 'baja'; motivo: string } {
  const escala = respuestas.find((r) => normalizar(r.pregunta).includes('escala del 1 al 10'))
  if (escala) {
    const n = Number(
      String(escala.respuesta)
        .trim()
        .match(/^\d{1,2}/)?.[0]
    )
    if (Number.isFinite(n) && n >= 1 && n <= 10) {
      return {
        tiene: n >= config.insatisfaccionMinima,
        fiabilidad: 'alta',
        motivo: `Insatisfacción declarada ${n}/10 (umbral ${config.insatisfaccionMinima}).`,
      }
    }
  }

  const sentir = respuestas.find((r) => contieneAlguno(r.pregunta, ['como te sientes', 'situacion laboral actual']))
  if (sentir && String(sentir.respuesta).trim()) {
    const t = normalizar(String(sentir.respuesta))
    const declara =
      /no me siento satisfecha|quiero un cambio|estancada|aumentar mis ingresos|oportunidad para generar|no tengo trabajo|sin empleo|no estoy trabajando/.test(
        t
      )
    return {
      tiene: declara ? true : null,
      fiabilidad: 'media',
      motivo: declara
        ? `Declara querer cambiar su situación: "${String(sentir.respuesta).trim()}".`
        : `La respuesta sobre su situación no declara el problema de forma clara ("${String(sentir.respuesta).trim()}").`,
    }
  }

  return { tiene: null, fiabilidad: 'baja', motivo: 'El formulario no incluye ninguna pregunta sobre su situación.' }
}

/**
 * El veredicto completo. `cualificada` es `true` solo si AMBAS condiciones se cumplen, `false` si
 * alguna falla con certeza, y `null` si falta información para decidir.
 *
 * Ese `null` no es cobardía: con 559 agendas históricas y formularios que han cambiado tres veces, la
 * alternativa es dar por no cualificadas a las que reservaron por una versión más corta. El CPQBC
 * saldría más bonito y sería falso.
 */
export function evaluarCualificacion(
  respuestas: RespuestaFormulario[],
  config: ConfigCualificacion = CONFIG_CUALIFICACION_POR_DEFECTO
): Cualificacion {
  const motivos: string[] = []

  const problema = leerProblema(respuestas, config)
  motivos.push(problema.motivo)

  const filaIngresos = respuestas.find((r) => contieneAlguno(r.pregunta, config.patronesIngresos))
  const ingresos = filaIngresos
    ? leerIngresos(String(filaIngresos.respuesta), config)
    : {
        min: null,
        max: null,
        cumple: null as Veredicto,
        fiabilidad: 'baja' as const,
        motivo: 'El formulario no incluye ninguna pregunta sobre ingresos.',
      }
  motivos.push(ingresos.motivo)

  // Una condición que falla con certeza descualifica, aunque la otra no se sepa: si declara 300€, no
  // llega al umbral y da igual lo insatisfecha que esté.
  const algunaFalla = problema.tiene === false || ingresos.cumple === false
  const ambasCumplen = problema.tiene === true && ingresos.cumple === true
  const cualificada: Veredicto = algunaFalla ? false : ambasCumplen ? true : null

  // La fiabilidad del conjunto es la de su eslabón más débil: un veredicto con una mitad interpretada
  // de texto libre no es tan firme como uno con dos opciones cerradas.
  const orden = { alta: 2, media: 1, baja: 0 } as const
  const fiabilidad =
    orden[problema.fiabilidad] <= orden[ingresos.fiabilidad] ? problema.fiabilidad : ingresos.fiabilidad

  return {
    cualificada,
    tieneProblema: problema.tiene,
    puedePagar: ingresos.cumple,
    ingresosEur: ingresos.min === null && ingresos.max === null ? null : { min: ingresos.min, max: ingresos.max },
    fiabilidad: cualificada === null ? 'baja' : fiabilidad,
    motivos,
  }
}
