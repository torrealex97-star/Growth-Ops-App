// VELOCIDAD DEL PIPELINE: cuánto tarda el dinero en llegar, etapa por etapa.
//
// Sirve para dos cosas que ninguna otra métrica contesta:
//   1. Dónde se atasca el recorrido (no dónde se pierde: eso es el funnel).
//   2. Cuánto tarda en volver el dinero invertido en anuncios, que es lo que decide si se puede
//      reinvertir agresivo o hay que ir con la caja en la mano.
//
// LA MEDIANA, NO LA MEDIA. Un solo prospecto que firmó nueve meses después sube la media de "lead a
// cash" de 14 a 38 días y el equipo se pone a arreglar un problema que no existe. Se dan las dos, pero
// la que manda en la tarjeta es la mediana; la media se muestra al lado para que la diferencia entre
// ambas sea visible, porque esa diferencia ES información: si difieren mucho, hay cola larga.
//
// Y COMO SIEMPRE: solo cuenta lo que tiene las dos fechas. Un recorrido sin fecha de cierre no es un
// cierre en cero días; no es un cierre.

export type EtapaPipeline =
  'lead_a_reserva' | 'reserva_a_llamada' | 'llamada_a_cierre' | 'cierre_a_primer_pago' | 'lead_a_cash'

const NOMBRE_ETAPA: Record<EtapaPipeline, string> = {
  lead_a_reserva: 'Lead → Reserva',
  reserva_a_llamada: 'Reserva → Llamada',
  llamada_a_cierre: 'Llamada → Cierre',
  cierre_a_primer_pago: 'Cierre → Primer pago',
  lead_a_cash: 'Lead → Cash (ciclo completo)',
}

/** Un recorrido. Cada fecha es ISO o `null` si esa etapa no ha ocurrido (o no se registró). */
export type Recorrido = {
  id: string
  leadEn: string | null
  reservaEn: string | null
  llamadaEn: string | null
  cierreEn: string | null
  primerPagoEn: string | null
}

export type MedidaEtapa = {
  etapa: EtapaPipeline
  nombre: string
  /** Mediana de días. `null` cuando no hay ningún recorrido con las dos fechas. */
  medianaDias: number | null
  mediaDias: number | null
  p90Dias: number | null
  /** Recorridos que sí tenían las dos fechas. Es el denominador real, no el total. */
  muestra: number
  /** Recorridos descartados por faltar una de las dos fechas. Se declara: es un hueco de medición. */
  descartados: number
  /** `true` cuando media y mediana difieren mucho: hay cola larga y la media engaña. */
  colaLarga: boolean
  nota: string
}

const MS_DIA = 86_400_000

function dias(desde: string | null, hasta: string | null): number | null {
  if (!desde || !hasta) return null
  const a = Date.parse(desde)
  const b = Date.parse(hasta)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  const d = (b - a) / MS_DIA
  // Una duración negativa es un dato roto (fechas cruzadas), no un recorrido rapidísimo. Se descarta
  // en vez de restar días al promedio.
  return d < 0 ? null : Math.round(d * 100) / 100
}

function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 1) return ordenados[0]
  const pos = (ordenados.length - 1) * p
  const bajo = Math.floor(pos)
  const alto = Math.ceil(pos)
  if (bajo === alto) return ordenados[bajo]
  return ordenados[bajo] + (ordenados[alto] - ordenados[bajo]) * (pos - bajo)
}

const r2 = (v: number) => Math.round(v * 100) / 100

const EXTREMOS: Record<EtapaPipeline, [keyof Recorrido, keyof Recorrido]> = {
  lead_a_reserva: ['leadEn', 'reservaEn'],
  reserva_a_llamada: ['reservaEn', 'llamadaEn'],
  llamada_a_cierre: ['llamadaEn', 'cierreEn'],
  cierre_a_primer_pago: ['cierreEn', 'primerPagoEn'],
  lead_a_cash: ['leadEn', 'primerPagoEn'],
}

/** Umbral a partir del cual se avisa de cola larga: la media supera la mediana en esta proporción. */
export const UMBRAL_COLA_LARGA = 1.5

export function medirEtapa(recorridos: Recorrido[], etapa: EtapaPipeline): MedidaEtapa {
  const [desde, hasta] = EXTREMOS[etapa]
  const duraciones: number[] = []
  let descartados = 0
  for (const r of recorridos) {
    const d = dias(r[desde] as string | null, r[hasta] as string | null)
    if (d === null) descartados++
    else duraciones.push(d)
  }

  if (duraciones.length === 0) {
    return {
      etapa,
      nombre: NOMBRE_ETAPA[etapa],
      medianaDias: null,
      mediaDias: null,
      p90Dias: null,
      muestra: 0,
      descartados,
      colaLarga: false,
      nota: `Sin ningún recorrido con las dos fechas registradas (${descartados} descartados): no se puede medir esta etapa todavía.`,
    }
  }

  const ordenados = [...duraciones].sort((a, b) => a - b)
  const mediana = r2(percentil(ordenados, 0.5))
  const media = r2(duraciones.reduce((a, v) => a + v, 0) / duraciones.length)
  const colaLarga = mediana > 0 && media / mediana >= UMBRAL_COLA_LARGA

  return {
    etapa,
    nombre: NOMBRE_ETAPA[etapa],
    medianaDias: mediana,
    mediaDias: media,
    p90Dias: r2(percentil(ordenados, 0.9)),
    muestra: duraciones.length,
    descartados,
    colaLarga,
    nota: colaLarga
      ? `Mediana ${mediana} días sobre ${duraciones.length} recorridos. La media (${media}) es mucho mayor: hay cola larga, así que la media engaña y manda la mediana.`
      : `Mediana ${mediana} días sobre ${duraciones.length} recorridos${descartados > 0 ? ` (${descartados} sin las dos fechas)` : ''}.`,
  }
}

export type VelocidadPipeline = {
  etapas: MedidaEtapa[]
  /** Ciclo de venta: la etapa completa lead → cash. Atajo para la tarjeta. */
  cicloMedianoDias: number | null
  /** La etapa más lenta CON muestra. `null` si ninguna se puede medir. */
  masLenta: EtapaPipeline | null
  titular: string
}

export function medirVelocidad(recorridos: Recorrido[]): VelocidadPipeline {
  const etapas = (Object.keys(EXTREMOS) as EtapaPipeline[]).map((e) => medirEtapa(recorridos, e))
  const medibles = etapas.filter((e) => e.medianaDias !== null && e.etapa !== 'lead_a_cash')
  const masLenta =
    medibles.length === 0
      ? null
      : medibles.reduce((a, e) => ((e.medianaDias ?? 0) > (a.medianaDias ?? 0) ? e : a)).etapa
  const ciclo = etapas.find((e) => e.etapa === 'lead_a_cash')?.medianaDias ?? null

  return {
    etapas,
    cicloMedianoDias: ciclo,
    masLenta,
    titular:
      medibles.length === 0
        ? 'Aún no hay recorridos con fechas suficientes para medir la velocidad del pipeline.'
        : `Ciclo completo mediano: ${ciclo ?? 's/d'} días. La etapa más lenta es ${NOMBRE_ETAPA[masLenta as EtapaPipeline]}.`,
  }
}

// ---------------------------------------------------------------------------------------------
// VALOR DEL PIPELINE ABIERTO. La versión ponderada existe porque la bruta miente: sumar todo lo abierto
// como si fuera a cerrar convierte el pipeline en un número de fantasía que nadie puede usar para
// planificar caja.
// ---------------------------------------------------------------------------------------------

export type OportunidadAbierta = {
  id: string
  valorEur: number
  /** Probabilidad 0-1. Debe venir del close rate histórico de su etapa, NO de la intuición del closer. */
  probabilidad: number | null
}

export function valorPipeline(oportunidades: OportunidadAbierta[]): {
  valorBrutoEur: number
  valorPonderadoEur: number | null
  conProbabilidad: number
  sinProbabilidad: number
  nota: string
} {
  const bruto = oportunidades.reduce((a, o) => a + (Number.isFinite(o.valorEur) ? o.valorEur : 0), 0)
  const con = oportunidades.filter((o) => o.probabilidad !== null && o.probabilidad >= 0 && o.probabilidad <= 1)
  const sin = oportunidades.length - con.length
  const ponderado = con.length === 0 ? null : r2(con.reduce((a, o) => a + o.valorEur * (o.probabilidad as number), 0))
  return {
    valorBrutoEur: r2(bruto),
    valorPonderadoEur: ponderado,
    conProbabilidad: con.length,
    sinProbabilidad: sin,
    nota:
      con.length === 0
        ? 'No hay probabilidades asignadas: solo se puede dar el valor bruto, que asume que todo cierra y por tanto no sirve para planificar caja.'
        : `Ponderado con la probabilidad histórica de cada etapa sobre ${con.length} oportunidades${sin > 0 ? ` (${sin} sin probabilidad, excluidas del ponderado)` : ''}.`,
  }
}
