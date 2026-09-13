// Resultado de una llamada: ganada / perdida / pendiente.
//
// SE DERIVA DE DATOS CANÓNICOS, NUNCA DE LA IA. Esta regla es explícita y no es cosmética: el
// resumen y el score de una llamada los escribe un modelo, y un modelo se equivoca con seguridad
// aparente. Si "ganada" saliera de ahí, el banco de grabaciones enseñaría como cerradas llamadas
// que no cerraron, y eso contaminaría cualquier análisis que se haga encima (qué objeciones
// aparecen en las que se ganan, qué dice el closer en las que se pierden…).
//
// Lo único que decide es: ¿hay una venta activa atada a esta cita? ¿ocurrió la llamada? ¿sigue vivo
// el seguimiento? Tres hechos verificables en la base.
import { ACTIVE_SALE_STATUSES } from '@/lib/analytics'

export type CallOutcome = 'ganada' | 'perdida' | 'pendiente' | 'no_ocurrio'

export type OutcomeInput = {
  /** status de la cita (appointments.status). */
  appointmentStatus: string
  /** followup_stage de la cita. */
  followupStage: string | null
  /** Ventas atadas a ESTA cita (sales.appointment_id), con su status. */
  linkedSales: Array<{ status: string }>
}

/** Estados en los que la llamada sí ocurrió. 'completed' y 'confirmed' NO lo garantizan. */
const HAPPENED = new Set(['show'])
/** El seguimiento ya está cerrado: no se espera nada más de esta llamada. */
const FOLLOWUP_CLOSED = new Set(['cerrado', 'descualificado'])

export function deriveCallOutcome(input: OutcomeInput): CallOutcome {
  // 1) Venta activa atada a la cita = ganada. Es el hecho más fuerte y manda sobre todo lo demás:
  //    si hay dinero, la llamada cerró, diga lo que diga el resto de los campos.
  //    Un reembolso o un chargeback NO cuentan (ACTIVE_SALE_STATUSES), igual que en el resto de la
  //    app: si no, Funnels y el banco de grabaciones darían cifras distintas de cierres.
  if (input.linkedSales.some((s) => ACTIVE_SALE_STATUSES.includes(s.status))) return 'ganada'

  // 2) Si la llamada no ocurrió, no hay resultado que clasificar. Un no_show no es una llamada
  //    perdida: es una llamada que no pasó, y mezclarlas falsearía la tasa de cierre.
  if (!HAPPENED.has(input.appointmentStatus)) return 'no_ocurrio'

  // 3) Ocurrió, no hay venta, y el seguimiento está cerrado => perdida.
  if (input.followupStage && FOLLOWUP_CLOSED.has(input.followupStage)) return 'perdida'

  // 4) Ocurrió, no hay venta y el seguimiento sigue vivo (o no se ha tocado) => pendiente.
  //    Deliberadamente NO se marca como perdida por el paso del tiempo: "lleva dos semanas sin
  //    respuesta" es una decisión comercial, no un hecho, y el que decide es el equipo.
  return 'pendiente'
}

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  ganada: 'Ganada',
  perdida: 'Perdida',
  pendiente: 'Pendiente',
  no_ocurrio: 'No ocurrió',
}
