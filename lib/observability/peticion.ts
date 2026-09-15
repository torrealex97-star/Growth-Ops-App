// CORRELACIÓN DE PETICIONES: un id por petición, y las etiquetas mínimas para poder buscar un error.
//
// LO QUE FALTABA. Sentry está configurado (sentry.{client,server,edge}.config.ts + instrumentation.ts),
// pero `tagRequestScope` —el helper que añade tenant, ruta y request_id sin tocar PII— no lo llamaba
// NADIE. Es decir: los errores llegaban a Sentry sin saber de qué subcuenta ni de qué ruta venían, y sin
// forma de atar el error que ve la persona con el que ve quien lo tiene que arreglar.
//
// DÓNDE SE RESUELVE, y por qué ahí. El id se genera en el middleware, que ya corre en TODAS las rutas, y
// viaja al handler como cabecera de petición. Así se cubren las 158 rutas sin editarlas una por una, y
// el mismo id está disponible en el middleware, en el handler, en Sentry y en la respuesta de error, que
// es lo que permite que alguien diga "me ha fallado con el id X" y se encuentre.
//
// QUÉ NO SE REGISTRA, NUNCA: tokens, cookies, cabeceras de autorización, cuerpos de petición, emails,
// teléfonos, transcripciones ni prompts. Las etiquetas son tenant_id, ruta y request_id, y nada más.
// `tenant_id` es un UUID interno: no identifica a una persona.

export const CABECERA_REQUEST_ID = 'x-goa-request-id'
export const CABECERA_RUTA = 'x-goa-route'

/**
 * Normaliza una ruta para que sirva como ETIQUETA agrupable.
 *
 * Sin esto, `/api/evergreen/contacts/9f3c…/activities` sería una etiqueta distinta por cada contacto y
 * agrupar errores por ruta no serviría de nada. Además, un id en una etiqueta es un identificador en un
 * sistema de terceros: quitarlo es también minimización de datos.
 */
export function normalizarRuta(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id'
      // Tokens de firma, ids de Stripe y cualquier cosa larga y opaca.
      if (seg.length > 24 && /^[A-Za-z0-9_-]+$/.test(seg)) return ':token'
      if (/^\d+$/.test(seg)) return ':n'
      return seg
    })
    .join('/')
}

/**
 * Variante para telemetría de navegador: el primer segmento es el slug de la subcuenta.
 * Se sustituye para no enviar nombres de negocio a terceros y para agrupar la misma pantalla
 * de todas las subcuentas en una sola serie.
 */
export function normalizarRutaTenant(pathname: string): string {
  const normalizada = normalizarRuta(pathname)
  return normalizada.replace(/^\/[^/]+(?=\/|$)/, '/:tenant')
}

/** Un id de petición. Corto para que se pueda dictar por teléfono, aleatorio para que no sea adivinable. */
export function nuevoRequestId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}
