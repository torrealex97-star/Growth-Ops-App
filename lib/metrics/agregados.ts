// DE LAS FILAS DE SUPABASE A LAS MÉTRICAS, sin tocar la red.
//
// POR QUÉ ESTÁ SEPARADO DE LA CONSULTA. Todo el motor —cuello de botella, salud, objetivos, previsión,
// alertas— ya estaba construido y probado, pero nada lo alimentaba. Este módulo es el puente, y es PURO
// a propósito: recibe las filas ya leídas y devuelve las mediciones. Así se prueba entero contra datos
// inventados, sin base de datos, que es la única forma de saber que un CPL de 12,50 € es 12,50 € y no
// un accidente de división.
//
// LA REGLA QUE MANDA AQUÍ, dicha por quien paga: "de lo que no haya datos no debe contar hasta que se
// comience a medir". Por eso una medición NO es un número: es un número que puede ser `null`, con su
// tamaño de muestra y, cuando falta, el motivo. Devolver 0 donde no se ha medido es el error que hace
// que alguien decida sobre un dato que no existe.

import { evaluarCualificacion } from '@/lib/metrics/cualificacion'
import { extraerRespuestas } from '@/lib/metrics/respuestas-formulario'
import {
  compararCualificaciones,
  cualificacionVentas,
  resumirConcordancia,
} from '@/lib/metrics/concordancia-cualificacion'
import { esElegibleBamfam } from '@/lib/agenda/marcado'

/** Lo que se sabe de UNA métrica tras mirar las filas. */
export type Medicion = {
  /** `null` = no se puede calcular. NO es cero. */
  valor: number | null
  /** Sobre cuántas observaciones. Es lo que decide si se puede afirmar algo. */
  muestra: number | null
  /** Por qué no hay valor, cuando no lo hay. Va literal a la UI. */
  motivo?: string
}

const sinDato = (motivo: string): Medicion => ({ valor: null, muestra: null, motivo })

/** Redondeo a dos decimales, para que un CPL no salga con quince cifras. */
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * División que devuelve `null` en vez de Infinity o NaN.
 *
 * `0/0` es NaN y `1/0` es Infinity, y los dos se pintan igual de mal: uno como "NaN" y el otro como
 * "∞". Los dos significan lo mismo —no se puede calcular— y eso es un `null` con su motivo.
 */
export function dividir(numerador: number, denominador: number, motivo: string, muestra?: number | null): Medicion {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador) || denominador === 0) return sinDato(motivo)
  return { valor: r2(numerador / denominador), muestra: muestra ?? null }
}

/** Porcentaje 0-100, con la misma protección. */
export function porcentaje(parte: number, total: number, motivo: string): Medicion {
  if (total === 0) return sinDato(motivo)
  return { valor: r2((parte / total) * 100), muestra: total }
}

// ---------------------------------------------------------------------------------------------
// LAS FILAS, con los nombres REALES de las columnas.
//
// Se declaran contra el esquema comprobado en la base, no contra lo que uno recuerda: el importe de un
// cobro está en `collections.gross_amount`, no en `amount`, y escribir `amount` aquí habría dado un cash
// collected de 0 € con toda la pinta de ser correcto.
// ---------------------------------------------------------------------------------------------

export type FilaVenta = {
  sale_date: string | null
  gross_amount: number | string | null
  status: string | null
  closer_id?: string | null
  appointment_id?: string | null
}

export type FilaCobro = {
  collected_at: string | null
  gross_amount: number | string | null
  is_confirmed: boolean | null
  status?: string | null
}

export type FilaCita = {
  appointment_datetime: string | null
  status: string | null
  result?: string | null
  offered?: boolean | null
  /** Marcado del closer: existe una siguiente reunión agendada. Alimenta BAMFAM. */
  needs_followup?: boolean | null
  /**
   * El payload del proveedor, TAL COMO LLEGÓ. Es donde están de verdad las respuestas del formulario:
   * comprobado en producción, `raw_payload->invitee->questions_and_answers` las trae en 473 de 559 citas,
   * mientras que la columna `qualification` está a 0 de 559. Leer `qualification` habría dado cero
   * agendas cualificadas SIEMPRE, con toda la pinta de ser un resultado de negocio.
   */
  raw_payload?: unknown
  /** Columna estructurada, hoy vacía. Se mira primero por si algún día se rellena. */
  qualification?: unknown
}

export type FilaCampana = {
  date: string | null
  spend: number | string | null
  impressions: number | string | null
  clicks: number | string | null
  leads: number | string | null
}

export type FilaContacto = {
  created_at: string | null
  first_contact_at: string | null
}

export type Periodo = { desde: string; hasta: string }

export type Entrada = {
  ventas: FilaVenta[]
  cobros: FilaCobro[]
  citas: FilaCita[]
  campanas: FilaCampana[]
  contactos?: FilaContacto[]
  periodo: Periodo
  /** Ticket comprometido medio conocido, para estimaciones. `null` si no se sabe. */
  ticketConocidoEur?: number | null
}

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const ordenados = [...valores].sort((a, b) => a - b)
  const centro = Math.floor(ordenados.length / 2)
  return ordenados.length % 2 === 0 ? (ordenados[centro - 1] + ordenados[centro]) / 2 : ordenados[centro]
}

/** Estados de venta que cuentan. Una venta reembolsada o anulada no es facturación del periodo. */
const VENTAS_QUE_CUENTAN = new Set(['active', 'activa', 'completed', 'completada'])

/** Estados de cita que significan que la cita ya no va a ocurrir. No entran en el denominador. */
const CITAS_CANCELADAS = new Set(['cancelled', 'cancelled_admin', 'cancelled_lead', 'cancelada', 'rescheduled'])

const ASISTIO = new Set(['show', 'completed'])

/** Marcado explícito de que no se presentó. Lo escribe una persona o el proveedor, nunca se deduce. */
const NO_ASISTIO = new Set(['no_show'])

/**
 * Estados que significan QUE LA CITA NO SE HA RESUELTO todavía: sigue agendada o confirmada, y nadie ha
 * dicho si la persona apareció.
 *
 * ESTO DECIDE EL DENOMINADOR DEL SHOW RATE, y es lo más importante de este fichero. Comprobado en
 * producción: de 559 citas hay 272 `scheduled` y 71 `confirmed` —328 de ellas YA PASADAS— frente a 3
 * marcadas como `show` y NINGUNA como `no_show`. Calcular el show rate sobre las no canceladas daría
 * 3/346 = 0,87%, un número catastrófico que no significa nada: no es que no venga nadie, es que nadie
 * marca la asistencia. Y ese 0,87% dominaría el diagnóstico y mandaría al equipo a arreglar los
 * recordatorios de un problema inventado.
 *
 * Así que el show rate se mide SOLO sobre las citas resueltas, y las pasadas sin marcar se cuentan
 * aparte como lo que son: un hueco de medición.
 */
const SIN_RESOLVER = new Set(['scheduled', 'confirmed', 'programada', 'confirmada', 'seguimiento', 'reserva'])

function enPeriodo(fecha: string | null | undefined, p: Periodo): boolean {
  if (!fecha) return false
  const d = fecha.slice(0, 10)
  return d >= p.desde && d <= p.hasta
}

export type Agregados = Record<string, Medicion>

/**
 * Calcula todas las métricas que el motor de diagnóstico necesita.
 *
 * Las claves coinciden EXACTAMENTE con las de lib/metrics/registro.ts: si aquí se escribe
 * `close_rate` y el registro dice `close_rate_llamadas`, la métrica se queda sin datos y nadie se
 * entera. Hay un test que cruza las dos listas por eso.
 */
export function calcularAgregados(e: Entrada): Agregados {
  const { periodo: p } = e

  // ── DINERO ─────────────────────────────────────────────────────────────────────────────────
  const cobrosDelPeriodo = e.cobros.filter((c) => c.is_confirmed !== false && enPeriodo(c.collected_at, p))
  const cash = cobrosDelPeriodo.reduce((a, c) => a + num(c.gross_amount), 0)

  const ventasDelPeriodo = e.ventas.filter(
    (v) => enPeriodo(v.sale_date, p) && (!v.status || VENTAS_QUE_CUENTAN.has(v.status))
  )
  // Facturación = precio COMPROMETIDO, no la suma de lo cobrado. Es la corrección que ya costó una
  // migración de datos: un plan a 10 plazos factura el total y cobra una décima parte cada mes.
  const facturacion = ventasDelPeriodo.reduce((a, v) => a + num(v.gross_amount), 0)
  const nVentas = ventasDelPeriodo.length

  // ── ANUNCIOS ───────────────────────────────────────────────────────────────────────────────
  const diasCampana = e.campanas.filter((c) => enPeriodo(c.date, p))
  const gasto = diasCampana.reduce((a, c) => a + num(c.spend), 0)
  const impresiones = diasCampana.reduce((a, c) => a + num(c.impressions), 0)
  const clics = diasCampana.reduce((a, c) => a + num(c.clicks), 0)
  const leads = diasCampana.reduce((a, c) => a + num(c.leads), 0)
  const hayCampanas = diasCampana.length > 0

  // ── CITAS ──────────────────────────────────────────────────────────────────────────────────
  const citasDelPeriodo = e.citas.filter((c) => enPeriodo(c.appointment_datetime, p))
  // Una cita cancelada NO entra en el denominador del show rate: nadie dejó de presentarse a algo que
  // se canceló. Meterla hunde el show rate sin que haya pasado nada malo.
  const agendadas = citasDelPeriodo.filter((c) => !c.status || !CITAS_CANCELADAS.has(c.status))
  const shows = agendadas.filter((c) => c.status && ASISTIO.has(c.status))
  const noShows = agendadas.filter((c) => c.status && NO_ASISTIO.has(c.status))
  // Resueltas = alguien dijo si apareció o no. Es el único denominador honesto del show rate.
  const resueltas = shows.length + noShows.length
  // CUALIFICADA ES LA DE MARKETING, no la de ventas. Son dos cosas distintas y se decidió así: la
  // agenda cualificada sale de las RESPUESTAS DEL FORMULARIO (tiene el problema que el negocio resuelve
  // y declara al menos 1.000 €/mes de ingresos); el prospecto cualificado lo juzga el closer en la
  // llamada. Usar aquí `esCualificada()` de lib/agenda/marcado —que mira si hubo oferta— mezclaría el
  // juicio de ventas en un denominador de marketing (el CPQBC) y haría que el coste por agenda
  // cualificada dependiera de si el closer se acordó de marcar una casilla.
  const veredictos = citasDelPeriodo.map((c) => {
    // `qualification` primero por si algún día se rellena; `raw_payload` es donde están hoy.
    const respuestas = [c.qualification, c.raw_payload]
      .map((fuente) => extraerRespuestas(fuente, undefined))
      .find((r) => r.length > 0)
    return respuestas ? evaluarCualificacion(respuestas).cualificada : null
  })
  const cualificadas = veredictos.filter((v) => v === true)
  const conJuicioDeCualificacion = veredictos.filter((v) => v !== null)
  // La oferta: `offered` se marca a mano y `null` significa "no marcado", no "no hubo oferta".
  const conOfertaMarcada = shows.filter((c) => c.offered !== null && c.offered !== undefined)
  const ofertas = shows.filter((c) => c.offered === true)

  // Speed to lead vive en contacts desde la migración original. Solo se usan pares de fechas válidos
  // y no negativos: un timestamp anterior a la creación es dato corrupto, no una respuesta instantánea.
  const contactosDelPeriodo = (e.contactos ?? []).filter((c) => enPeriodo(c.created_at, p))
  const minutosHastaContacto = contactosDelPeriodo.flatMap((c) => {
    if (!c.created_at || !c.first_contact_at) return []
    const creado = new Date(c.created_at).getTime()
    const contactado = new Date(c.first_contact_at).getTime()
    const minutos = (contactado - creado) / 60_000
    return Number.isFinite(minutos) && minutos >= 0 ? [minutos] : []
  })
  const medianaSpeedToLead = mediana(minutosHastaContacto)

  const m: Agregados = {}

  m.cash_collected = { valor: r2(cash), muestra: cobrosDelPeriodo.length }
  m.contracted_revenue = { valor: r2(facturacion), muestra: nVentas }
  m.ventas = { valor: nVentas, muestra: nVentas }
  m.cash_collection_ratio = porcentaje(
    cash,
    facturacion,
    'No hay facturación en el periodo con la que comparar el cobro.'
  )
  m.aov = dividir(facturacion, nVentas, 'No hay ventas en el periodo: no hay ticket medio que calcular.', nVentas)

  m.ad_spend = hayCampanas
    ? { valor: r2(gasto), muestra: diasCampana.length }
    : sinDato('No hay días de campaña cargados en el periodo: el gasto no es 0, es que no se ha sincronizado.')

  m.cash_roas = hayCampanas
    ? dividir(cash, gasto, 'Sin gasto en anuncios en el periodo no hay ROAS que calcular.', cobrosDelPeriodo.length)
    : sinDato('Sin datos de campañas no se puede calcular el ROAS.')

  m.cac = hayCampanas
    ? dividir(gasto, nVentas, 'No hay ventas en el periodo: el CAC sería una división por cero.', nVentas)
    : sinDato('Sin datos de campañas no se puede calcular el CAC.')

  m.ctr = hayCampanas
    ? porcentaje(clics, impresiones, 'Sin impresiones en el periodo no hay CTR.')
    : sinDato('Sin datos de campañas no hay CTR.')
  m.cpc = hayCampanas
    ? dividir(gasto, clics, 'Sin clics en el periodo no hay CPC.', clics)
    : sinDato('Sin datos de campañas no hay CPC.')
  m.cpm = hayCampanas
    ? dividir(gasto * 1000, impresiones, 'Sin impresiones en el periodo no hay CPM.', impresiones)
    : sinDato('Sin datos de campañas no hay CPM.')

  m.agendas = { valor: agendadas.length, muestra: citasDelPeriodo.length }
  // La muestra son las citas de las que se PUEDE decir algo, no todas: si 400 de 559 no traen
  // respuestas de formulario, decir "12 cualificadas de 559" sugiere un 2% que nadie ha medido.
  m.agendas_cualificadas =
    conJuicioDeCualificacion.length > 0
      ? { valor: cualificadas.length, muestra: conJuicioDeCualificacion.length }
      : sinDato('Ninguna cita del periodo trae respuestas de formulario legibles: no se puede cualificar.')

  m.show_rate =
    resueltas > 0
      ? porcentaje(shows.length, resueltas, '')
      : sinDato(
          agendadas.length > 0
            ? `Hay ${agendadas.length} citas agendadas pero ninguna marcada como asistida o no asistida: sin ese marcado no hay show rate, y un 0% sería un problema inventado.`
            : 'No hay citas agendadas en el periodo: no hay show rate que calcular.'
        )

  m.cpqbc = hayCampanas
    ? dividir(
        gasto,
        cualificadas.length,
        'No hay agendas cualificadas en el periodo: el coste por agenda cualificada sería una división por cero.',
        cualificadas.length
      )
    : sinDato('Sin datos de campañas no se puede calcular el CPQBC.')

  // El pitch rate se mide SOLO sobre las llamadas donde alguien marcó si hubo oferta. Calcularlo sobre
  // todas trataría "no marcado" como "no hubo oferta", que es inventarse el dato.
  m.pitch_rate =
    conOfertaMarcada.length > 0
      ? porcentaje(ofertas.length, conOfertaMarcada.length, '')
      : sinDato('Nadie ha marcado todavía si hubo oferta en las llamadas: no se puede medir el pitch rate.')

  const ventasConCita = ventasDelPeriodo.filter((v) => v.appointment_id).length
  m.close_rate_llamadas =
    shows.length > 0
      ? porcentaje(ventasConCita, shows.length, '')
      : sinDato('No hay llamadas asistidas en el periodo: no hay close rate que calcular.')
  m.close_rate_ofertas =
    ofertas.length > 0
      ? porcentaje(ventasConCita, ofertas.length, '')
      : sinDato('No hay ofertas marcadas en el periodo: no se puede medir el cierre sobre oferta.')

  // LTGP sigue siendo un hueco real: ninguna tabla registra todavía el margen bruto de por vida por
  // cliente. Usar facturación o cash como sustituto convertiría ingresos en beneficio y falsearía la
  // métrica que decide si se puede escalar.
  m.ltgp_cac = sinDato('Falta el margen bruto por cliente (LTGP) para poder dividirlo por el CAC.')

  m.speed_to_lead =
    medianaSpeedToLead === null
      ? sinDato(
          contactosDelPeriodo.length > 0
            ? `Hay ${contactosDelPeriodo.length} contactos en el periodo, pero ninguno tiene una hora de primer contacto válida.`
            : 'No hay contactos creados en el periodo: no se puede medir el tiempo hasta el primer contacto.'
        )
      : {
          valor: r2(medianaSpeedToLead),
          muestra: minutosHastaContacto.length,
          motivo:
            minutosHastaContacto.length < contactosDelPeriodo.length
              ? `Se calcula sobre ${minutosHastaContacto.length} de ${contactosDelPeriodo.length} contactos con ambas horas válidas.`
              : undefined,
        }

  const elegiblesBamfam = citasDelPeriodo.filter(esElegibleBamfam)
  m.bamfam_rate =
    elegiblesBamfam.length > 0
      ? porcentaje(elegiblesBamfam.filter((c) => c.needs_followup === true).length, elegiblesBamfam.length, '')
      : sinDato('No hay llamadas asistidas sin venta en el periodo sobre las que medir una siguiente reunión.')

  const concordancia = resumirConcordancia(
    citasDelPeriodo.map((c, indice) =>
      compararCualificaciones(
        veredictos[indice],
        cualificacionVentas(c),
        c.status === 'show' || c.status === 'completed'
      )
    )
  )
  m.tasa_concordancia_cualificacion =
    concordancia.tasaConcordancia === null
      ? sinDato(
          citasDelPeriodo.length > 0
            ? 'No hay agendas donde formulario y closer se hayan pronunciado: todavía no existe una muestra comparable.'
            : 'No hay agendas en el periodo: no se puede comparar la cualificación de marketing y ventas.'
        )
      : {
          valor: r2(concordancia.tasaConcordancia),
          muestra: concordancia.comparables,
          motivo:
            concordancia.comparables < citasDelPeriodo.length
              ? `Se compara en ${concordancia.comparables} de ${citasDelPeriodo.length} agendas; las demás no tienen las dos valoraciones.`
              : undefined,
        }

  return m
}

/**
 * Cuántas citas del periodo ya pasaron y nadie ha marcado si la persona apareció.
 *
 * Va aparte de las métricas a propósito: no es una métrica de negocio, es el estado de la medición. Y es
 * el dato más accionable de todo el panel cuando está alto, porque mientras esté alto el show rate, el
 * pitch rate y el close rate sobre llamadas no se pueden calcular con nada.
 */
export function coberturaMarcado(
  citas: FilaCita[],
  periodo: Periodo,
  ahora: Date = new Date()
): {
  pasadasSinMarcar: number
  resueltas: number
  /** Fracción de las citas pasadas que sí está resuelta (0-1). `null` si no hay citas pasadas. */
  fraccionResuelta: number | null
} {
  const delPeriodo = citas.filter((c) => enPeriodo(c.appointment_datetime, periodo))
  const vivas = delPeriodo.filter((c) => !c.status || !CITAS_CANCELADAS.has(c.status))
  const pasadas = vivas.filter((c) => c.appointment_datetime !== null && new Date(c.appointment_datetime) < ahora)
  const resueltas = pasadas.filter((c) => c.status && (ASISTIO.has(c.status) || NO_ASISTIO.has(c.status))).length
  const sinMarcar = pasadas.filter((c) => !c.status || SIN_RESOLVER.has(c.status)).length
  return {
    pasadasSinMarcar: sinMarcar,
    resueltas,
    fraccionResuelta: pasadas.length === 0 ? null : Math.round((resueltas / pasadas.length) * 100) / 100,
  }
}
