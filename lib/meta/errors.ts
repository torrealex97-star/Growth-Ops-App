// Traducción de los errores de la Graph API de Meta a una causa y un arreglo.
//
// POR QUÉ EXISTE. Meta devuelve un objeto de error con `code` y `error_subcode` que dicen EXACTAMENTE
// qué pasa, y nosotros solo mostrábamos `message`, que es texto en inglés pensado para
// desarrolladores ("Unsupported get request", "Invalid OAuth access token"). Con eso, "no conecta" se
// queda en "no conecta": no distingue un token caducado de un permiso que falta o de un id de cuenta
// mal escrito, que son tres arreglos completamente distintos.

export type MetaErrorInfo = { code: string; message: string }

/**
 * Error de Meta con su código estable adjunto. Sin esto, quien lo captura solo tiene el texto: y
 * decidir si merece la pena reintentar, o qué arreglo proponer, a base de buscar subcadenas en un
 * mensaje que escribe Meta y cambia sin avisar es exactamente cómo "Invalid appsecret_proof" acabó
 * mandando a corregir el identificador de la cuenta.
 */
export class MetaError extends Error {
  readonly code: string
  constructor(info: MetaErrorInfo) {
    super(info.message)
    this.name = 'MetaError'
    this.code = info.code
  }
}

type MetaErrorBody = {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    /** Mensaje que Meta escribe para el usuario final. Cuando viene, es el mejor que hay. */
    error_user_msg?: string
    error_user_title?: string
  }
}

/**
 * Clasifica el error. Los códigos son los documentados por Meta; el subcódigo afina el motivo dentro
 * del mismo código (190 puede ser caducado, revocado o cambio de contraseña).
 */
export function classifyMetaError(body: unknown, httpStatus?: number): MetaErrorInfo {
  const error = (body as MetaErrorBody | null)?.error
  const code = error?.code
  const sub = error?.error_subcode
  // El mensaje de Meta para el usuario final, cuando existe, gana: lo escribe Meta y es el que mejor
  // describe SU caso concreto.
  const detalle = error?.error_user_msg || error?.message || ''

  // "Bad signature" NO es un token caducado: es un token que no valida su propia firma, y en la
  // práctica eso significa que la cadena está incompleta o alterada — casi siempre un copiado a
  // medias. Decir "renueva el token" manda a generar otro que se volverá a pegar mal.
  if (/bad signature/i.test(detalle)) {
    return {
      code: 'token_incompleto',
      message: 'El token está incompleto o alterado: Meta no reconoce su firma.',
    }
  }
  if (code === 190) {
    if (sub === 463) return { code: 'token_caducado', message: `El token de Meta ha caducado. ${detalle}`.trim() }
    if (sub === 467) return { code: 'token_invalido', message: `El token de Meta fue revocado. ${detalle}`.trim() }
    if (sub === 460)
      return {
        code: 'token_invalido',
        message: `El token dejó de valer porque cambió la contraseña de la cuenta. ${detalle}`.trim(),
      }
    return { code: 'token_invalido', message: `El token de Meta no es válido. ${detalle}`.trim() }
  }
  if (code === 102) return { code: 'token_invalido', message: `La sesión de Meta caducó. ${detalle}`.trim() }
  if (code === 10 || code === 200 || code === 294) {
    return {
      code: 'sin_permisos',
      message: `El token no tiene permiso para leer esta cuenta publicitaria. ${detalle}`.trim(),
    }
  }
  // `appsecret_proof` inválido: la firma se calcula con el App Secret, así que este error NO es del
  // token ni de la cuenta — es que el App Secret guardado NO es el de la app que emitió el token.
  // Meta lo devuelve con código 100, así que sin este caso especial acabábamos mandando a corregir el
  // identificador de la cuenta, que está perfecto.
  if (/appsecret_proof/i.test(detalle)) {
    return {
      code: 'proof_invalido',
      message: 'El App Secret guardado no corresponde a la app que generó el token.',
    }
  }
  if (code === 100) {
    // 100 con subcódigo 33 es "el objeto existe pero tu token no lo ve", que en la práctica es un
    // problema de permisos, no de que el id esté mal escrito.
    if (sub === 33) {
      return {
        code: 'sin_permisos',
        message: `La cuenta publicitaria existe pero este token no la ve. ${detalle}`.trim(),
      }
    }
    return {
      code: 'cuenta_incorrecta',
      message: `Meta no reconoce ese identificador de cuenta publicitaria. ${detalle}`.trim(),
    }
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80004) {
    return { code: 'limite_de_uso', message: `Meta ha limitado temporalmente las peticiones. ${detalle}`.trim() }
  }
  if (code === 2635) {
    return {
      code: 'version_deprecada',
      message: `Meta ha retirado la versión de la API que está configurada. ${detalle}`.trim(),
    }
  }
  if (code === 1 || code === 2 || (httpStatus ?? 0) >= 500) {
    return { code: 'red', message: `Meta está devolviendo un error temporal. ${detalle}`.trim() }
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { code: 'sin_permisos', message: detalle || `Meta respondió ${httpStatus}.` }
  }
  return { code: 'respuesta_inesperada', message: detalle || `Meta respondió ${httpStatus ?? 'un error'}.` }
}
