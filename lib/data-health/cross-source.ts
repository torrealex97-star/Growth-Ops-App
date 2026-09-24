// Controles CRUZADOS de salud del dato: no "¿la fuente responde?", sino "¿lo que trajo encaja con el
// resto?". Un pago de Stripe sin venta, una venta sin contacto o una campaña sin nada río abajo son
// huecos en la cadena que las tarjetas por integración no ven: cada fuente puede estar verde y el
// recorrido completo estar roto por la mitad.
//
// SON FUNCIONES PURAS A PROPÓSITO. Reciben los conjuntos ya leídos y devuelven el diagnóstico, así
// que se prueban con un dataset determinista, sin base de datos y sin red — que es la única forma de
// verificar de verdad que los totales salen exactos.
//
// DOS REGLAS QUE GOBIERNAN TODO ESTE MÓDULO:
//  1. Un hueco no es un cero. Si un conjunto no se pudo leer llega como `null` y el control devuelve
//     `desconocido`, nunca "0 problemas". Decir "todo en orden" porque la consulta falló es la peor
//     de las respuestas posibles.
//  2. Nada se arregla solo. Estos controles NOMBRAN el problema y dan ejemplos concretos para ir a
//     mirarlos; emparejar un cliente o atribuir una venta es una decisión sobre datos del usuario.

type CrossCheckId =
  | 'meta_cuenta_sin_datos'
  | 'campana_cuenta_no_seleccionada'
  | 'pago_stripe_sin_venta'
  | 'pago_stripe_sin_cobro'
  | 'cobro_de_pago_devuelto'
  | 'venta_sin_contacto'
  | 'cliente_sin_emparejar'
  | 'campana_sin_atribucion'
  | 'agenda_sin_contacto'
  | 'llamada_sin_agenda'
  | 'sync_obsoleta'

export type CrossCheck = {
  id: CrossCheckId
  label: string
  /** Cuántos registros incumplen. `null` = no se pudo comprobar (dato no leído). */
  afectados: number | null
  /** Hasta cinco ejemplos, para poder ir a mirarlos en vez de buscar a ciegas. */
  ejemplos: string[]
  /** Qué significa y qué hacer. Una frase, sin códigos. */
  detalle: string
  gravedad: 'critico' | 'aviso' | 'ok' | 'desconocido'
}

const MAX_EJEMPLOS = 5

function check(
  id: CrossCheckId,
  label: string,
  ids: string[] | null,
  detalle: string,
  gravedadSiHay: 'critico' | 'aviso'
): CrossCheck {
  if (ids === null) {
    return {
      id,
      label,
      afectados: null,
      ejemplos: [],
      detalle: 'No se pudo comprobar: falta leer alguno de los conjuntos implicados.',
      gravedad: 'desconocido',
    }
  }
  return {
    id,
    label,
    afectados: ids.length,
    ejemplos: ids.slice(0, MAX_EJEMPLOS),
    detalle: ids.length === 0 ? 'Sin incidencias.' : detalle,
    gravedad: ids.length === 0 ? 'ok' : gravedadSiHay,
  }
}

/** Los conjuntos que hacen falta. `null` en cualquiera = ese control no se puede juzgar. */
export type CrossInput = {
  /** Cuentas de Meta SELECCIONADAS en Integraciones (ids act_…). */
  cuentasSeleccionadas: string[] | null
  /** account_id de las campañas que sí tienen filas sincronizadas. */
  cuentasConCampanas: string[] | null
  /**
   * Campañas sincronizadas de cuentas que NO están en la selección de Integraciones, con un id
   * de ejemplo. La sync solo puede recortar con la lista si el usuario la escribió: una lista
   * vacía ("todas las accesibles") es legítima y este control no debe llamarla fuga.
   */
  campanasFueraDeSeleccion: string[] | null
  /** Clientes de Stripe: id + contacto emparejado (null si no lo está). */
  clientesStripe: Array<{ id: string; contactId: string | null }> | null
  /**
   * Pagos del espejo `stripe_payments`: id del intent, referencias con las que un cobro puede
   * apuntarle (intent y charge) y estado. Es la unidad del dinero, no el cliente.
   */
  pagosStripe: Array<{ id: string; refs: string[]; status: string }> | null
  /** `payment_reference` de los cobros registrados (solo los que tienen). */
  referenciasCobro: string[] | null
  /** contact_id de los contactos que tienen al menos una venta. */
  contactosConVenta: string[] | null
  /** Ventas: id + contacto. */
  ventas: Array<{ id: string; contactId: string | null }> | null
  /** Ids de contacto existentes. */
  contactos: string[] | null
  /** Campañas: id + si algo río abajo la referencia. */
  campanas: Array<{ id: string; conAtribucion: boolean }> | null
  /** Agendas: id + contacto. */
  agendas: Array<{ id: string; contactId: string | null }> | null
  /** Llamadas grabadas: id + agenda asociada. */
  llamadas: Array<{ id: string; appointmentId: string | null }> | null
  /** Última sincronización por fuente, en ISO. `null` = nunca. */
  ultimaSyncPorFuente: Record<string, string | null> | null
  /** Umbral de obsolescencia. */
  staleMs?: number
  ahora?: number
}

export const STALE_POR_DEFECTO_MS = 48 * 60 * 60 * 1000

export function runCrossChecks(input: CrossInput): CrossCheck[] {
  const ahora = input.ahora ?? Date.now()
  const staleMs = input.staleMs ?? STALE_POR_DEFECTO_MS

  // Una cuenta seleccionada que no ha traído ni una campaña: o la sync falla para ESA cuenta, o la
  // cuenta no tiene actividad. Las dos cosas hay que saberlas; ninguna es "0 gasto".
  const cuentasSinDatos =
    input.cuentasSeleccionadas === null || input.cuentasConCampanas === null
      ? null
      : input.cuentasSeleccionadas.filter((a) => !input.cuentasConCampanas!.includes(a))

  // LA FUGA INVERSA: campañas sincronizadas de cuentas que el usuario ya quitó de Integraciones.
  // Son las que antes se colaban en dashboards y sumas de gasto cuando un lector olvidaba el
  // filtro por account_id. Con lista vacía ("todas las accesibles") no hay fuera-de-selección
  // posible: nada que avisar. Se deduplica: el control cuenta CUENTAS, no filas de campaña.
  const campanasFueraDeSeleccion =
    input.campanasFueraDeSeleccion === null ? null : [...new Set(input.campanasFueraDeSeleccion.filter(Boolean))]

  // Un cliente de Stripe emparejado con un contacto que NO tiene ninguna venta: su pago no está
  // registrado como ingreso, así que falta facturación en los informes.
  const stripeSinVenta =
    input.clientesStripe === null || input.contactosConVenta === null
      ? null
      : input.clientesStripe
          .filter((c) => c.contactId && !input.contactosConVenta!.includes(c.contactId))
          .map((c) => c.id)

  // UN PAGO DE STRIPE SIN COBRO. Es el control que faltaba, y el de arriba no lo sustituye.
  //
  // El de arriba mira CLIENTES: un cliente con alguna venta da OK. Así se escapaban dos casos reales,
  // medidos en S0.5 (docs/S0-5-CONSISTENCIA-DATOS.md §1.1): la segunda cuota de alguien que ya tiene
  // venta —el cliente "ya está", la cuota no— y los pagos sin cliente en Stripe, que no tienen
  // cliente que revisar. Juntos sumaban 12 pagos sin que ningún aviso saltara. Aquí se mira el PAGO.
  //
  // Solo `succeeded`: un pago devuelto entero no es ingreso, y uno en disputa todavía no se sabe.
  const referencias = input.referenciasCobro === null ? null : new Set(input.referenciasCobro)
  const pagosSinCobro =
    input.pagosStripe === null || referencias === null
      ? null
      : input.pagosStripe
          .filter((p) => p.status === 'succeeded' && !p.refs.some((r) => referencias.has(r)))
          .map((p) => p.id)

  // Un cobro que apunta a un pago que Stripe ya devolvió entero: el dinero volvió al cliente y la app
  // lo sigue contando, con su comisión. Stripe lo sabe; la app no se entera sola (S0.5 §1.2).
  const cobrosDeDevueltos =
    input.pagosStripe === null || referencias === null
      ? null
      : input.pagosStripe
          .filter((p) => p.status === 'refunded' && p.refs.some((r) => referencias.has(r)))
          .map((p) => p.id)

  // Una venta sin contacto, o apuntando a un contacto que ya no existe: se queda fuera de cualquier
  // informe por persona y de la atribución.
  const ventasSinContacto =
    input.ventas === null || input.contactos === null
      ? null
      : input.ventas.filter((v) => !v.contactId || !input.contactos!.includes(v.contactId)).map((v) => v.id)

  // Cliente de Stripe que no se pudo emparejar con ningún contacto. Va a la cola de revisión: no se
  // empareja por nombre ni "por si acaso".
  const clientesSinEmparejar =
    input.clientesStripe === null ? null : input.clientesStripe.filter((c) => !c.contactId).map((c) => c.id)

  // Campaña con gasto pero sin nada río abajo: o la atribución está rota, o esa campaña no trae
  // nadie. Distinguirlo es la diferencia entre arreglar el tracking y apagar la campaña.
  const campanasSinAtribucion =
    input.campanas === null ? null : input.campanas.filter((c) => !c.conAtribucion).map((c) => c.id)

  const agendasSinContacto =
    input.agendas === null || input.contactos === null
      ? null
      : input.agendas.filter((a) => !a.contactId || !input.contactos!.includes(a.contactId)).map((a) => a.id)

  // Llamada grabada sin agenda: la grabación existe pero no se puede atribuir a ninguna cita, así que
  // no cuenta como show-up ni entra en las métricas del closer.
  const llamadasSinAgenda =
    input.llamadas === null ? null : input.llamadas.filter((l) => !l.appointmentId).map((l) => l.id)

  // Fuente que no se sincroniza desde hace demasiado: los datos que se están mirando son viejos, y
  // eso no se ve en ninguna cifra.
  const syncsObsoletas =
    input.ultimaSyncPorFuente === null
      ? null
      : Object.entries(input.ultimaSyncPorFuente)
          .filter(([, iso]) => {
            if (!iso) return true
            const t = Date.parse(iso)
            // Una fecha ilegible cuenta como obsoleta: no se asume que está fresca.
            return Number.isNaN(t) || ahora - t > staleMs
          })
          .map(([fuente]) => fuente)

  return [
    check(
      'meta_cuenta_sin_datos',
      'Cuentas de Meta seleccionadas sin datos',
      cuentasSinDatos,
      'Están seleccionadas en Integraciones pero no han traído ninguna campaña. Comprueba la integración y lanza "Cargar histórico" para esas cuentas.',
      'critico'
    ),
    check(
      'campana_cuenta_no_seleccionada',
      'Campañas de cuentas NO seleccionadas',
      campanasFueraDeSeleccion,
      'Están sincronizadas de cuentas publicitarias que ya no están en la selección de Integraciones: su gasto no debe entrar en los dashboards. Revisa la selección o borra esos históricos.',
      'aviso'
    ),
    check(
      'pago_stripe_sin_venta',
      'Clientes de Stripe sin venta registrada',
      stripeSinVenta,
      'Sus pagos no están registrados como ingreso, así que faltan en facturación y comisiones. Resuélvelos en Integraciones › Stripe › "Buscar pagos sin registrar".',
      'critico'
    ),
    check(
      'pago_stripe_sin_cobro',
      'Pagos de Stripe sin cobro registrado',
      pagosSinCobro,
      'Stripe los cobró pero la app no los tiene: faltan en cash collected y nadie ha cobrado su comisión. Si es la cuota de una venta que ya existe, abre esa venta en Ventas, pulsa "Registrar cobro" y pon en Referencia el id del pago (pi_…); si es una venta nueva, en Integraciones › Stripe › "Buscar pagos sin registrar".',
      'critico'
    ),
    check(
      'cobro_de_pago_devuelto',
      'Cobros de pagos que Stripe devolvió',
      cobrosDeDevueltos,
      'El dinero volvió al cliente pero el cobro sigue contando como ingreso y su comisión no se ha revertido. Registra la devolución en la venta.',
      'critico'
    ),
    check(
      'venta_sin_contacto',
      'Ventas sin contacto válido',
      ventasSinContacto,
      'Quedan fuera de los informes por persona y de la atribución. Asigna el contacto correcto a cada una.',
      'critico'
    ),
    check(
      'cliente_sin_emparejar',
      'Clientes de Stripe sin emparejar',
      clientesSinEmparejar,
      'No se encontró contacto con ese email o teléfono. No se emparejan por nombre: revísalos a mano.',
      'aviso'
    ),
    check(
      'campana_sin_atribucion',
      'Campañas sin nada atribuido',
      campanasSinAtribucion,
      'Tienen gasto pero ningún lead o venta atribuido. Puede ser tracking roto o una campaña que no convierte: compruébalo antes de decidir.',
      'aviso'
    ),
    check(
      'agenda_sin_contacto',
      'Agendas sin contacto válido',
      agendasSinContacto,
      'No se pueden atribuir a nadie, así que no cuentan en el embudo ni en las métricas del setter.',
      'critico'
    ),
    check(
      'llamada_sin_agenda',
      'Llamadas grabadas sin agenda',
      llamadasSinAgenda,
      'La grabación existe pero no está ligada a ninguna cita: no cuenta como show-up ni entra en las métricas del closer.',
      'aviso'
    ),
    check(
      'sync_obsoleta',
      'Fuentes sin sincronizar recientemente',
      syncsObsoletas,
      'Los datos que estás mirando de esas fuentes son viejos. Lánzalas desde Integraciones.',
      'aviso'
    ),
  ]
}

/** Resumen para la cabecera: lo peor que hay, sin esconder lo que no se pudo comprobar. */
export function resumenCross(checks: CrossCheck[]): {
  estado: 'ok' | 'aviso' | 'critico' | 'incompleto'
  criticos: number
  avisos: number
  sinComprobar: number
} {
  const criticos = checks.filter((c) => c.gravedad === 'critico').length
  const avisos = checks.filter((c) => c.gravedad === 'aviso').length
  const sinComprobar = checks.filter((c) => c.gravedad === 'desconocido').length
  // El orden importa: un crítico manda sobre todo, y "incompleto" gana a "ok" porque no es lo mismo
  // no tener problemas que no haber podido mirar.
  if (criticos > 0) return { estado: 'critico', criticos, avisos, sinComprobar }
  if (avisos > 0) return { estado: 'aviso', criticos, avisos, sinComprobar }
  if (sinComprobar > 0) return { estado: 'incompleto', criticos, avisos, sinComprobar }
  return { estado: 'ok', criticos, avisos, sinComprobar }
}
