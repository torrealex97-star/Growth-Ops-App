// EL MOTOR DE CUELLO DE BOTELLA: qué está impidiendo crecer, ahora, y una sola cosa.
//
// LA LÓGICA CENTRAL, dicha por quien manda: "encontrar la restricción, corregirla y volver a medir, no
// optimizar veinte cosas a la vez".
//
// De aquí cuelga casi todo lo demás del panel —Business Health, las alertas, el brief diario, lo que
// recomienda el agente—, así que esto es la pieza que hay que construir primero y la que tiene que ser
// correcta. Es lógica pura y se prueba entera sin base de datos ni red.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// TRES REGLAS QUE DECIDEN EL RESULTADO
//
// 1. SE DIAGNOSTICA DE ATRÁS HACIA DELANTE. La jerarquía va de la economía del negocio al tráfico:
//
//      ECONOMÍA (LTGP:CAC, Cash ROAS)
//        -> CAJA / CLIENTES
//          -> VENTAS (close rate, ticket)
//            -> OPORTUNIDADES CUALIFICADAS (CPQBC, show rate)
//              -> FUNNEL (lead -> reserva, CPL)
//                -> TRÁFICO (CPC, CTR, CPM)
//
//    Un panel que abre señalando el CTR invita a arreglar el CTR. Si el CAC y el Cash ROAS están sanos,
//    que el CTR haya caído NO es el problema del negocio: es ruido con buena presentación.
//
// 2. LA REGLA DE LA ÚLTIMA MÉTRICA. Se decide con la métrica más POSTERIOR que tenga muestra
//    suficiente. Con ventas reales, manda el CAC; sin ventas pero con llamadas cualificadas, manda el
//    CPQBC; sin llamadas, el funnel; sin leads, entonces sí, el tráfico. Optimizar una métrica anterior
//    ignorando una posterior con datos es el error que este módulo existe para evitar.
//
// 3. UNA RESTRICCIÓN, NO UNA LISTA. "Mejora el CTR, cambia la landing, contrata closers, sube el precio
//    y rediseña el onboarding" destruye la capacidad de aprender: cuando algo cambia, ya no se sabe por
//    qué. Se devuelve UNA restricción primaria y, como mucho, dos secundarias marcadas como tales.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// SOBRE LA CAUSALIDAD. Este módulo NO afirma causas. Ordena por lo que sabe y etiqueta cuánto sabe:
// `probable` cuando la métrica está fuera de objetivo con muestra suficiente, `posible` cuando la
// muestra es corta, y `requiere_investigacion` cuando falta el dato. Un panel que dice "la causa es X"
// con nueve llamadas medidas hace perder más tiempo del que ahorra.

/** Los niveles de la jerarquía, de lo más posterior a lo más anterior. */
export type NivelDiagnostico = 'economia' | 'caja' | 'ventas' | 'oportunidades' | 'funnel' | 'trafico'

/** Orden de prioridad. Menor índice = más posterior = se mira antes. */
const ORDEN_NIVEL: Record<NivelDiagnostico, number> = {
  economia: 0,
  caja: 1,
  ventas: 2,
  oportunidades: 3,
  funnel: 4,
  trafico: 5,
}

/**
 * Cuánto se puede afirmar.
 *
 * `probable` — fuera de objetivo y con muestra suficiente. Es lo más que se dice.
 * `posible` — fuera de objetivo pero con poca muestra. Podría ser ruido.
 * `requiere_investigacion` — no hay dato para juzgarlo. NO es un problema; es un hueco.
 */
type Certeza = 'probable' | 'posible' | 'requiere_investigacion'

export type Confianza = 'alta' | 'media' | 'baja'

type Severidad = 'critico' | 'aviso' | 'ok'

/** Lo que se le pasa al motor por cada métrica. */
export type EntradaMetrica = {
  key: string
  nombre: string
  nivel: NivelDiagnostico
  /** `null` = no hay dato. NO es cero. */
  valor: number | null
  objetivo: number | null
  higherIsBetter: boolean
  /**
   * Tamaño de muestra sobre el que se ha medido (llamadas, ventas, leads…). Es lo que decide la
   * confianza: un close rate del 14% con 7 llamadas y otro con 430 son el mismo número y dos hechos
   * distintos.
   */
  muestra: number | null
  /** Qué mirar si esta métrica resulta ser la restricción. Del árbol de diagnóstico del negocio. */
  investigar: string[]
}

type ImpactoEstimado = {
  /** Unidades de negocio que se ganarían al alcanzar el objetivo (ventas, clientes…). */
  unidadesAdicionales: number | null
  /** Euros estimados, cuando hay un ticket con el que multiplicar. */
  eurosAdicionales: number | null
  /** Cómo se ha calculado. Va literal a la UI: sin esto el número parece una promesa. */
  metodo: string
}

type Restriccion = {
  key: string
  nombre: string
  nivel: NivelDiagnostico
  certeza: Certeza
  confianza: Confianza
  severidad: Severidad
  actual: number | null
  objetivo: number | null
  /** En puntos o en unidades de la métrica. Negativo = por debajo de lo que se quiere. */
  brecha: number | null
  muestra: number | null
  investigar: string[]
  impacto: ImpactoEstimado | null
  motivo: string
}

export type Diagnostico = {
  /** La restricción a la que atender. `null` cuando no hay nada fuera de objetivo o no hay datos. */
  primaria: Restriccion | null
  /** Como máximo dos, y marcadas como secundarias. Nunca sustituyen a la primaria. */
  secundarias: Restriccion[]
  /**
   * Métricas que no se pueden juzgar por falta de dato. Es un problema de MEDICIÓN, no de negocio: por
   * eso van aparte y con certeza `requiere_investigacion`, en vez de contarse como si estuvieran a cero.
   */
  sinDatos: { key: string; nombre: string; nivel: NivelDiagnostico; certeza: Certeza }[]
  /** Frase para la tarjeta, ya redactada con el nivel de certeza que corresponde. */
  titular: string
}

export type ConfigDiagnostico = {
  /** Muestra mínima para hablar con confianza alta. */
  muestraAlta: number
  /** Por debajo de esto, cualquier conclusión es ruido con formato. */
  muestraMinima: number
  /** Desvío relativo del objetivo desde el que se considera crítico. 0.2 = 20% peor. */
  umbralCritico: number
  /** Ticket medio para estimar euros. `null` = no se estiman euros, solo unidades. */
  ticketMedioEur: number | null
  /** Volumen del denominador para estimar impacto (p. ej. llamadas asistidas del periodo). */
  volumenBase: number | null
}

export const CONFIG_DIAGNOSTICO_POR_DEFECTO: ConfigDiagnostico = {
  muestraAlta: 100,
  muestraMinima: 20,
  umbralCritico: 0.2,
  ticketMedioEur: null,
  volumenBase: null,
}

/** ¿A qué distancia del objetivo, en la dirección mala? Positivo = peor que el objetivo. */
function desvioRelativo(m: EntradaMetrica): number | null {
  if (m.valor === null || m.objetivo === null || m.objetivo === 0) return null
  const diferencia = m.higherIsBetter ? m.objetivo - m.valor : m.valor - m.objetivo
  return diferencia / Math.abs(m.objetivo)
}

function confianzaPor(muestra: number | null, config: ConfigDiagnostico): Confianza {
  if (muestra === null) return 'baja'
  if (muestra >= config.muestraAlta) return 'alta'
  if (muestra >= config.muestraMinima) return 'media'
  return 'baja'
}

/**
 * El impacto de cerrar la brecha, SIEMPRE como estimación.
 *
 * Solo se calcula para tasas (porcentajes) sobre un volumen conocido, porque es el único caso donde la
 * aritmética es honesta: si el 17,8% de 120 llamadas son 21 ventas, el 25% serían 30. Para un CAC o un
 * ticket medio no se estima nada: cuánto más venderías bajando el CAC depende de cuánto reinviertas, y
 * eso no está en el dato.
 */
function estimarImpacto(m: EntradaMetrica, config: ConfigDiagnostico, esTasa: boolean): ImpactoEstimado | null {
  if (!esTasa || m.valor === null || m.objetivo === null) return null
  const volumen = config.volumenBase
  if (volumen === null || volumen <= 0) return null
  if (!m.higherIsBetter) return null

  const actuales = (m.valor / 100) * volumen
  const conObjetivo = (m.objetivo / 100) * volumen
  const adicionales = conObjetivo - actuales
  if (!(adicionales > 0)) return null

  const unidades = Math.round(adicionales * 10) / 10
  return {
    unidadesAdicionales: unidades,
    eurosAdicionales: config.ticketMedioEur ? Math.round(unidades * config.ticketMedioEur) : null,
    // El método se dice siempre. Un "+9 ventas/mes" sin decir de dónde sale se lee como una promesa.
    metodo: `Estimación sobre el volumen actual (${volumen}): pasar de ${m.valor}% a ${m.objetivo}% daría ~${unidades} más.`,
  }
}

function severidadPor(desvio: number | null, config: ConfigDiagnostico): Severidad {
  if (desvio === null) return 'ok'
  if (desvio <= 0) return 'ok'
  return desvio >= config.umbralCritico ? 'critico' : 'aviso'
}

function certezaPor(confianza: Confianza): Certeza {
  // Con muestra corta NO se dice "probable". Un close rate del 14% con siete llamadas puede ser
  // casualidad, y mandar al equipo a revisar el pitch por eso cuesta una semana.
  return confianza === 'baja' ? 'posible' : 'probable'
}

/**
 * Diagnostica la restricción actual.
 *
 * `metricas` se le pasa completo; el motor decide a quién mirar y en qué orden. Lo que NO hace es
 * elegir por él quién es la peor en términos absolutos: una métrica de tráfico un 40% fuera de objetivo
 * NO gana a una de economía un 10% fuera, porque arreglar el tráfico con la economía rota es empujar
 * más volumen por un embudo que pierde dinero.
 */
export function diagnosticarCuelloBotella(
  metricas: EntradaMetrica[],
  config: ConfigDiagnostico = CONFIG_DIAGNOSTICO_POR_DEFECTO
): Diagnostico {
  const sinDatos = metricas
    .filter((m) => m.valor === null || m.objetivo === null)
    .map((m) => ({ key: m.key, nombre: m.nombre, nivel: m.nivel, certeza: 'requiere_investigacion' as const }))

  const candidatas: Restriccion[] = []

  for (const m of metricas) {
    const desvio = desvioRelativo(m)
    if (desvio === null || desvio <= 0) continue

    const confianza = confianzaPor(m.muestra, config)
    // Por debajo de la muestra mínima no entra como candidata a restricción PRIMARIA: se puede
    // mencionar, pero no dirigir la semana del equipo.
    const esTasa = m.key.includes('rate') || m.key.includes('tasa')
    candidatas.push({
      key: m.key,
      nombre: m.nombre,
      nivel: m.nivel,
      certeza: certezaPor(confianza),
      confianza,
      severidad: severidadPor(desvio, config),
      actual: m.valor,
      objetivo: m.objetivo,
      brecha: m.valor !== null && m.objetivo !== null ? Math.round((m.valor - m.objetivo) * 100) / 100 : null,
      muestra: m.muestra,
      investigar: m.investigar,
      impacto: estimarImpacto(m, config, esTasa),
      // La dirección se dice bien: un CAC fuera de objetivo está POR ENCIMA, no por debajo. Escribir
      // "el CAC está un 30% por debajo de lo que el negocio necesita" es decir lo contrario de lo que pasa.
      motivo: `${m.nombre} está ${Math.round(desvio * 100)}% ${m.higherIsBetter ? 'por debajo de' : 'por encima de'} lo que el negocio necesita (${m.valor} frente a ${m.objetivo}).`,
    })
  }

  // EL ORDEN ES LA TESIS: primero por nivel de la jerarquía (lo más posterior manda), y solo dentro
  // del mismo nivel se desempata por gravedad. Así una economía rota siempre gana a un CTR malo.
  candidatas.sort((a, b) => {
    const porNivel = ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel]
    if (porNivel !== 0) return porNivel
    const grav = (r: Restriccion) => (r.severidad === 'critico' ? 0 : 1)
    if (grav(a) !== grav(b)) return grav(a) - grav(b)
    // Y a igualdad, la que tenga más muestra: es la que se puede afirmar con más base.
    return (b.muestra ?? 0) - (a.muestra ?? 0)
  })

  // La primaria tiene que poder sostener una decisión: con muestra por debajo del mínimo se prefiere
  // la siguiente que sí la tenga, y si no hay ninguna, se devuelve la mejor candidata pero marcada.
  const conMuestra = candidatas.filter((c) => (c.muestra ?? 0) >= config.muestraMinima)
  const primaria = conMuestra[0] ?? candidatas[0] ?? null
  const secundarias = candidatas.filter((c) => c !== primaria).slice(0, 2)

  return { primaria, secundarias, sinDatos, titular: redactarTitular(primaria, sinDatos.length) }
}

/**
 * La frase de la tarjeta. Se redacta AQUÍ y no en la UI para que el nivel de certeza y el titular no
 * puedan discrepar: una pantalla que escribe "el problema es el close rate" sobre un diagnóstico
 * marcado como `posible` está afirmando más de lo que el motor sabe.
 */
function redactarTitular(primaria: Restriccion | null, huecos: number): string {
  if (!primaria) {
    return huecos > 0
      ? `Ninguna métrica medida está fuera de objetivo, pero hay ${huecos} sin datos suficientes para juzgarlas.`
      : 'Ninguna métrica está fuera de objetivo.'
  }
  // Una primaria nunca es `requiere_investigacion`: sin dato no entra como candidata. Los huecos van en
  // `sinDatos`, y por eso aquí solo hay dos redacciones posibles.
  const prefijo = primaria.certeza === 'probable' ? 'Restricción probable' : 'Posible restricción (muestra corta)'
  return `${prefijo}: ${primaria.nombre}.`
}

/**
 * ¿Se puede escalar la adquisición?
 *
 * Se resuelve aquí y no en el agente para que la respuesta del chat y la del panel no puedan
 * contradecirse. Devuelve la clasificación que pide el negocio y los motivos, en orden.
 */
export type VeredictoEscalado = 'listo' | 'con_cautela' | 'esperar' | 'arreglar_antes'

export function evaluarEscalado(
  diagnostico: Diagnostico,
  capacidad: { utilizacionVentas: number | null; utilizacionEntrega: number | null },
  config: ConfigDiagnostico = CONFIG_DIAGNOSTICO_POR_DEFECTO
): { veredicto: VeredictoEscalado; motivos: string[] } {
  const motivos: string[] = []
  const p = diagnostico.primaria

  // UNA ECONOMÍA ROTA MANDA SOBRE TODO LO DEMÁS. Escalar adquisición con el LTGP:CAC por debajo de
  // objetivo es comprar clientes que no se pagan solos, más rápido.
  if (p && (p.nivel === 'economia' || p.nivel === 'caja') && p.severidad === 'critico') {
    motivos.push(`${p.nombre} está críticamente fuera de objetivo: escalar multiplicaría la pérdida por cliente.`)
    return { veredicto: 'arreglar_antes', motivos }
  }

  // La capacidad es un techo físico, no una métrica de rendimiento: da igual lo rentable que sea la
  // adquisición si no hay quien atienda las llamadas.
  const ventas = capacidad.utilizacionVentas
  const entrega = capacidad.utilizacionEntrega
  if (ventas !== null && ventas >= 90) {
    motivos.push(`El equipo de ventas está al ${ventas}% de utilización: la capacidad comercial es el techo inmediato.`)
    return { veredicto: 'esperar', motivos }
  }
  if (entrega !== null && entrega >= 90) {
    motivos.push(`La entrega está al ${entrega}% de utilización: más clientes degradarían el servicio.`)
    return { veredicto: 'esperar', motivos }
  }

  if (p && p.severidad === 'critico' && p.confianza !== 'baja') {
    motivos.push(`${p.nombre} está críticamente fuera de objetivo; conviene moverlo antes de meter más volumen.`)
    return { veredicto: 'con_cautela', motivos }
  }

  if (p) {
    motivos.push(`${p.nombre} está por debajo de objetivo, pero no de forma crítica.`)
  }
  if (ventas !== null && ventas >= 70) {
    motivos.push(`Ventas al ${ventas}%: queda margen, pero poco.`)
  }
  // Sin datos de capacidad NO se dice que se puede escalar sin más: no saber si hay techo no es lo
  // mismo que saber que no lo hay.
  if (ventas === null || entrega === null) {
    motivos.push('Falta el dato de capacidad, así que no se puede descartar que el techo sea operativo.')
    return { veredicto: 'con_cautela', motivos }
  }

  if (!p) motivos.push('Ninguna métrica fuera de objetivo y hay capacidad libre.')
  void config
  return { veredicto: motivos.length > 1 ? 'con_cautela' : 'listo', motivos }
}
