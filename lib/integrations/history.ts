// Carga de histórico al conectar una integración.
//
// LA IDEA. Conectar una fuente y ver la pantalla vacía es la peor primera impresión posible: parece
// que no funciona. Así que en cuanto una integración pasa a verde se ofrece traer el pasado, y se
// trae **lo más atrás que la API deje de verdad**.
//
// LA REGLA. Cada entrada declara hasta dónde llega REALMENTE el conector que hay escrito, no hasta
// dónde llegaría la API en el mejor de los casos. Prometer "todo tu histórico" y traer 30 días es
// mentir en la única pantalla donde el usuario aún no puede contrastar nada.

export type HistoryCapability = {
  /** Proveedor tal y como lo espera /settings/integraciones/history-sync. */
  provider: string
  /** Qué trae, en una frase. */
  brings: string
  /** Hasta dónde llega, con el motivo del límite cuando lo hay. */
  reach: string
  /** Días hacia atrás que se piden cuando el conector acepta rango. */
  sinceDays?: number
  /** Aviso si la carga puede tardar. */
  slow?: boolean
}

/**
 * Meta conserva las métricas por día **37 meses**; más atrás no existe dato que pedir, así que ese
 * es el tope honesto. El sync diario normal mira 180 días: aquí se pide el máximo a propósito,
 * porque es una carga puntual y el usuario la ha pedido.
 */
const META_MAX_DAYS = 1125

export const HISTORY_CAPABILITIES: Record<string, HistoryCapability> = {
  meta: {
    provider: 'meta',
    brings: 'Campañas, y el gasto y los resultados día a día de cada una.',
    reach: 'Hasta 37 meses atrás, que es todo lo que Meta conserva.',
    sinceDays: META_MAX_DAYS,
    slow: true,
  },
  instagram: {
    provider: 'instagram',
    brings: 'Publicaciones y sus métricas orgánicas.',
    reach: 'Las publicaciones que la API devuelve para la cuenta conectada.',
  },
  calendly: {
    provider: 'calendly',
    brings: 'Citas agendadas con sus invitados y sus respuestas del formulario.',
    reach: 'Todo el histórico de la cuenta, recorriendo páginas hasta el final.',
    slow: true,
  },
  ghl: {
    provider: 'ghl',
    brings: 'Contactos y citas de la subcuenta.',
    reach: 'Todo el histórico de la subcuenta, recorriendo páginas hasta el final.',
    slow: true,
  },
  fathom: {
    provider: 'fathom',
    brings: 'Grabaciones y transcripciones, emparejadas con la cita a la que pertenecen.',
    reach: 'Todas las reuniones accesibles con esa API key.',
    slow: true,
  },
}

export function historyFor(groupId: string): HistoryCapability | null {
  return HISTORY_CAPABILITIES[groupId] ?? null
}
