// SERIALIZAR EL RESULTADO DE UNA TOOL PARA EL MODELO, SIN ROMPER EL JSON.
//
// EL BUG QUE ARREGLA. El gateway hacía `JSON.stringify(result).slice(0, 20000)`. Cuando el resultado
// pasaba de ese tamaño, el corte caía en mitad de una clave o de un número y el modelo recibía algo
// como:
//
//   {"ventas":[{"id":"a1b2","importe":14
//
// JSON inválido, sin llaves de cierre y con el último valor mutilado. Un modelo que recibe eso no
// falla: RELLENA. Completa la estructura como le parece y presenta el resultado como un dato del
// negocio. En un agente cuyo trabajo es responder "cuánto hemos facturado", ese es el peor fallo
// posible, porque no se nota.
//
// LA REGLA: el modelo recibe SIEMPRE JSON válido, y cuando se ha recortado algo se le DICE, con qué
// se ha recortado y cuánto. Un dato ausente y declarado es utilizable; un dato ausente y disimulado
// envenena la respuesta.
//
// POR QUÉ MÓDULO APARTE: para poder probarlo sin el SDK de Anthropic ni una llamada de red.

/** Tope de caracteres que se le pasa al modelo por resultado de tool. */
export const LIMITE_RESULTADO = 20000

/** Cuántos elementos se dejan como muestra cuando hay que recortar una lista. */
const MUESTRA_MINIMA = 3

type Json = unknown

const esLista = (v: Json): v is Json[] => Array.isArray(v)
const esObjeto = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Serializa el resultado de una tool respetando el límite, recortando por DATOS y nunca por texto.
 *
 * Estrategia, en orden:
 *
 * 1. Si cabe entero, se manda entero. El caso normal no paga ningún coste.
 * 2. Si no cabe, se recortan las LISTAS del primer nivel —que es donde está el volumen— dejando una
 *    muestra y declarando cuántos elementos había. El modelo puede entonces decir "hay 1.787 filas,
 *    te muestro las 3 primeras" en vez de inventarse el resto.
 * 3. Si aun así no cabe, se devuelve un envoltorio que dice que no cupo. Sigue siendo JSON válido.
 *
 * NUNCA se corta la cadena a la mitad.
 */
export function serializarResultadoTool(result: Json, limite = LIMITE_RESULTADO): string {
  const completo = seguroStringify(result)
  if (completo.length <= limite) return completo

  // Recorte por datos: las listas del primer nivel son casi siempre el volumen.
  if (esObjeto(result)) {
    const recortado: Record<string, Json> = {}
    const avisos: string[] = []
    for (const [clave, valor] of Object.entries(result)) {
      if (esLista(valor) && valor.length > MUESTRA_MINIMA) {
        recortado[clave] = valor.slice(0, MUESTRA_MINIMA)
        avisos.push(`"${clave}": se muestran ${MUESTRA_MINIMA} de ${valor.length} elementos`)
      } else {
        recortado[clave] = valor
      }
    }
    if (avisos.length > 0) {
      const conAviso = seguroStringify({
        ...recortado,
        _recorte: {
          motivo: 'El resultado completo no cabía en el contexto.',
          detalle: avisos,
          instruccion:
            'Los totales y recuentos que vengan en este mismo objeto son completos y se pueden usar. Las listas están recortadas: NO extrapoles a partir de la muestra ni inventes los elementos que faltan.',
        },
      })
      if (conAviso.length <= limite) return conAviso
    }
  }

  // Una lista en la raíz: misma idea, con envoltorio.
  if (esLista(result) && result.length > MUESTRA_MINIMA) {
    const conAviso = seguroStringify({
      muestra: result.slice(0, MUESTRA_MINIMA),
      _recorte: {
        motivo: 'El resultado completo no cabía en el contexto.',
        detalle: [`se muestran ${MUESTRA_MINIMA} de ${result.length} elementos`],
        instruccion: 'NO extrapoles a partir de la muestra ni inventes los elementos que faltan.',
      },
    })
    if (conAviso.length <= limite) return conAviso
  }

  // Último recurso: se declara que no cupo. Preferible a un JSON roto — el modelo puede decir que no
  // pudo leer el resultado, que es cierto, en vez de completar una estructura mutilada.
  return seguroStringify({
    _recorte: {
      motivo: 'El resultado es demasiado grande para pasarlo al modelo.',
      tamano_caracteres: completo.length,
      limite,
      instruccion:
        'No se ha podido leer este resultado. Dilo explícitamente y pide una consulta más acotada (un periodo más corto o un filtro). NO respondas con cifras que no estén en otro resultado.',
    },
  })
}

/**
 * `JSON.stringify` que no revienta la petición.
 *
 * Con referencias circulares o un `BigInt`, `JSON.stringify` LANZA. Dentro del bucle de tools eso se
 * convertiría en el error de la tool entera, cuando el problema es de serialización y no del dato.
 * Aquí se degrada a un envoltorio válido que lo explica.
 */
function seguroStringify(valor: Json): string {
  try {
    return JSON.stringify(valor) ?? 'null'
  } catch (e) {
    return JSON.stringify({
      _error_serializacion: e instanceof Error ? e.message : String(e),
      instruccion: 'El resultado no se pudo convertir a texto. Dilo y no inventes su contenido.',
    })
  }
}

/**
 * Aviso cuando la respuesta del modelo se ha cortado por el límite de tokens.
 *
 * EL OTRO BUG: con `stop_reason === 'max_tokens'` el gateway devolvía el texto truncado tal cual, así
 * que la respuesta llegaba cortada a media frase y nadie lo decía. Quien lee un análisis que termina
 * en "el CAC ha subido porque" no sabe si falta media frase o media conclusión.
 */
export function avisoRespuestaCortada(texto: string, stopReason: string | null | undefined): string {
  if (stopReason !== 'max_tokens') return texto
  const limpio = texto.trimEnd()
  if (!limpio) return 'La respuesta se cortó antes de empezar. Vuelve a preguntar algo más concreto.'
  return `${limpio}\n\n⚠️ La respuesta se ha cortado por longitud. Pregunta por una parte concreta para verla completa.`
}
