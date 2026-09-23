import type { SupabaseClient } from '@supabase/supabase-js'

import { hechoDesdeSobre } from './canonico'
import { NORMALIZADOR_GHL, idEventoGhl, tipoEventoGhl, type PayloadGhl } from './ghl'
import { NORMALIZADOR_STRIPE, derivarStripe } from './stripe'

// F1 — REPROCESAR (replay).
//
// PARA QUÉ SIRVE. El 22-sep se descubrió que el normalizador guardaba `no-show` como "programada".
// Arreglarlo sirvió para lo siguiente, pero las citas mal traducidas se quedaron mal. Ahora que el
// sobre original está guardado, se puede volver a derivar el hecho con el normalizador corregido y
// recuperar los días rotos. Eso es esto.
//
// LAS TRES REGLAS QUE EXIGE EL PLAN (§F1: "reanudable, idempotente, con dry-run y resumen antes de
// afectar proyecciones"):
//
//   1. **No toca el sobre.** `raw_events` es la prueba y se queda como está. Se reescribe el hecho,
//      no el original: si mañana el normalizador mejora otra vez, se vuelve a derivar del mismo sitio.
//   2. **Idempotente.** Reprocesar dos veces el mismo día deja el mismo estado. El hecho se
//      identifica por el evento del proveedor, así que la segunda pasada actualiza la misma fila.
//   3. **Simulación primero.** `dryRun` cuenta y explica qué cambiaría sin escribir una sola fila.
//
// REANUDABLE: cada pasada devuelve un cursor `(received_at, id)`. Una función de Vercel muere a los
// 60 s; sin cursor, reprocesar un mes sería imposible y cada intento empezaría de cero.

export type AccionReplay = 'reprocesar' | 'al_dia' | 'sin_normalizador'

export type SobreParaReplay = {
  id: string
  source: string
  source_event_id: string | null
  normalizer_version: string | null
  payload: unknown
  received_at: string
  canonical_event_id: string | null
}

/**
 * Fuentes que este runner sabe volver a pasar: su versión actual y cómo se deriva el hecho.
 *
 * Un registro y no un `if` por fuente: añadir un proveedor es añadir una entrada aquí, y la lista de
 * "qué se puede reprocesar" que devuelve la ruta sale de este mismo sitio en vez de escribirse a
 * mano en otro lado y quedarse vieja.
 */
export const DERIVADORES: Record<
  string,
  {
    version: string
    derivar: (
      payload: unknown,
      sobre: SobreParaReplay
    ) => { sourceEventId: string; tipo: string; propiedades?: Record<string, unknown> } | null
  }
> = {
  ghl: {
    version: NORMALIZADOR_GHL,
    derivar: (payload, sobre) => {
      const p = (payload ?? {}) as PayloadGhl
      return { sourceEventId: sobre.source_event_id || idEventoGhl(p), tipo: tipoEventoGhl(p) }
    },
  },
  stripe: {
    version: NORMALIZADOR_STRIPE,
    derivar: (payload) => derivarStripe(payload),
  },
}

/** Versión actual del normalizador de cada fuente. */
export const NORMALIZADORES: Record<string, string> = Object.fromEntries(
  Object.entries(DERIVADORES).map(([fuente, d]) => [fuente, d.version])
)

/**
 * Qué hacer con un sobre, SIN tocar nada. Separado del runner para poder razonar sobre la decisión
 * —y probarla— sin base de datos delante.
 *
 * `al_dia` no es "no hacer nada por si acaso": es que ese sobre ya se procesó con esta misma versión
 * del normalizador y volver a derivarlo daría exactamente el mismo hecho. Reprocesarlo igualmente
 * sería trabajo y escrituras para nada.
 */
export function decidir(sobre: SobreParaReplay, versionObjetivo: string | undefined): AccionReplay {
  if (!versionObjetivo) return 'sin_normalizador'
  if (!sobre.canonical_event_id) return 'reprocesar'
  return sobre.normalizer_version === versionObjetivo ? 'al_dia' : 'reprocesar'
}

export type ResumenReplay = {
  leidos: number
  reprocesados: number
  alDia: number
  sinNormalizador: number
  fallidos: number
  simulacion: boolean
  /** Desde dónde seguir. `null` = no queda nada por leer en el rango. */
  cursor: { recibidoEn: string; id: string } | null
  /** Qué se hizo, con nombre y apellidos, para poder revisarlo sin abrir la base. */
  muestra: { sobre: string; accion: AccionReplay; tipo?: string; motivo?: string }[]
}

const MUESTRA_MAX = 20

/**
 * Vuelve a derivar los hechos de un rango. Devuelve el resumen y el cursor para continuar.
 *
 * `deadline` es el momento (epoch ms) en que hay que parar sí o sí: se deja margen para escribir la
 * respuesta en vez de morir a mitad y perder el cursor.
 */
export async function reprocesar(
  sb: SupabaseClient,
  opciones: {
    tenantId: string
    source: string
    desde: string
    hasta: string
    simulacion: boolean
    limite?: number
    deadline?: number
    /** Continuar desde aquí (el cursor de la pasada anterior). */
    cursor?: { recibidoEn: string; id: string } | null
  }
): Promise<ResumenReplay> {
  const { tenantId, source, desde, hasta, simulacion } = opciones
  const limite = Math.min(Math.max(opciones.limite ?? 200, 1), 1000)
  const versionObjetivo = NORMALIZADORES[source]

  const resumen: ResumenReplay = {
    leidos: 0,
    reprocesados: 0,
    alDia: 0,
    sinNormalizador: 0,
    fallidos: 0,
    simulacion,
    cursor: null,
    muestra: [],
  }

  let consulta = sb
    .from('raw_events')
    .select('id, source, source_event_id, normalizer_version, payload, received_at, canonical_event_id')
    .eq('tenant_id', tenantId)
    .eq('source', source)
    .gte('received_at', desde)
    .lte('received_at', hasta)
    // Orden estable por (received_at, id): dos sobres del mismo milisegundo tienen un orden fijo, y
    // sin eso el cursor podría saltarse uno o repetirlo en la siguiente pasada.
    .order('received_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limite)

  if (opciones.cursor) {
    consulta = consulta.or(
      `received_at.gt.${opciones.cursor.recibidoEn},and(received_at.eq.${opciones.cursor.recibidoEn},id.gt.${opciones.cursor.id})`
    )
  }

  const { data, error } = await consulta
  if (error) throw new Error(`No se pudieron leer los sobres: ${error.message}`)
  const sobres = (data ?? []) as SobreParaReplay[]

  for (const sobre of sobres) {
    resumen.leidos++
    resumen.cursor = { recibidoEn: sobre.received_at, id: sobre.id }

    const accion = decidir(sobre, versionObjetivo)
    if (accion === 'al_dia') {
      resumen.alDia++
      continue
    }
    if (accion === 'sin_normalizador') {
      resumen.sinNormalizador++
      if (resumen.muestra.length < MUESTRA_MAX) {
        resumen.muestra.push({
          sobre: sobre.id,
          accion,
          motivo: `no hay normalizador para la fuente "${source}": el sobre se guarda, pero no se puede derivar el hecho`,
        })
      }
      continue
    }

    const derivado = DERIVADORES[source]?.derivar(sobre.payload, sobre)
    if (!derivado) {
      // El sobre existe pero hoy no se entiende: se cuenta como fallido y se dice por qué, en vez de
      // escribir un hecho inventado. El sobre sigue ahí para cuando el normalizador sepa leerlo.
      resumen.fallidos++
      if (resumen.muestra.length < MUESTRA_MAX) {
        resumen.muestra.push({
          sobre: sobre.id,
          accion: 'reprocesar',
          motivo: 'el normalizador no entiende este payload',
        })
      }
      continue
    }
    const tipo = derivado.tipo
    const hecho = hechoDesdeSobre({
      tenantId,
      source,
      sourceEventId: derivado.sourceEventId,
      rawEventId: sobre.id,
      tipo,
      payload: (sobre.payload ?? {}) as PayloadGhl,
      recibidoEn: sobre.received_at,
      propiedades: derivado.propiedades,
    })

    if (resumen.muestra.length < MUESTRA_MAX) {
      resumen.muestra.push({ sobre: sobre.id, accion: 'reprocesar', tipo })
    }

    if (simulacion) {
      resumen.reprocesados++
      continue
    }

    // El hecho se ACTUALIZA, no se duplica: misma identidad, misma fila. Los vínculos con contacto y
    // cita no se tocan aquí — los puso la proyección cuando el evento llegó y el reprocesado no
    // sabe más que ella sobre a quién pertenece.
    const { data: escrito, error: errorHecho } = await sb
      .from('canonical_events')
      .upsert(
        {
          ...hecho,
          contact_id: undefined,
          appointment_id: undefined,
        },
        { onConflict: 'tenant_id,source,source_event_id' }
      )
      .select('id')
      .maybeSingle()

    if (errorHecho) {
      resumen.fallidos++
      if (resumen.muestra.length < MUESTRA_MAX) {
        resumen.muestra.push({ sobre: sobre.id, accion: 'reprocesar', motivo: errorHecho.message })
      }
      continue
    }

    resumen.reprocesados++
    await sb
      .from('raw_events')
      .update({
        normalizer_version: versionObjetivo,
        canonical_event_id: escrito?.id ?? sobre.canonical_event_id,
        processed_at: new Date().toISOString(),
      })
      .eq('id', sobre.id)

    if (opciones.deadline && Date.now() > opciones.deadline) break
  }

  // Menos sobres que el límite = se acabó el rango. Se declara con null para que quien llama sepa
  // que ha terminado, en vez de tener que adivinarlo comparando números.
  if (sobres.length < limite) resumen.cursor = null
  return resumen
}
