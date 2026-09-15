// EL GROWTH BRIEF. Lo primero que se ve al abrir, en lugar de un chat vacío.
//
// Un chatbot en blanco traslada al usuario el trabajo de saber qué preguntar, y el resultado es que no
// se usa. El brief contesta antes de que nadie pregunte, en el orden en que importa:
//
//   SALUD → RESTRICCIÓN → IMPACTO → ACCIÓN RECOMENDADA → (y ahí sí) pregúntale al agente.
//
// Es COMPOSICIÓN, no cálculo: no vuelve a calcular nada. Toma la salud (lib/metrics/salud.ts), el
// diagnóstico (lib/metrics/cuello-botella.ts) y las alertas (lib/metrics/alertas.ts) y los ordena. Así el
// panel, el brief y el agente no pueden contradecirse: si el chat dijera una restricción y la tarjeta
// otra, ninguna de las dos se creería.

import type { Alerta } from './alertas'
import { priorizar } from './alertas'
import type { Diagnostico, VeredictoEscalado } from './cuello-botella'
import type { SaludNegocio } from './salud'
import { formatCurrency, formatNumber } from '@/lib/utils'

export type GrowthBrief = {
  /** Una línea con la nota de salud y su cobertura. */
  salud: { puntuacion: number | null; etiqueta: SaludNegocio['etiqueta']; titular: string; fiabilidad: string }
  restriccion: {
    nombre: string | null
    certeza: string | null
    titular: string
    /** Lo que hay que mirar para confirmarla. */
    investigar: string[]
  }
  impacto: { texto: string; esEstimacion: boolean }
  accion: { texto: string; requiereAprobacion: boolean }
  escalado: { veredicto: VeredictoEscalado | null; motivo: string | null }
  alertas: Alerta[]
  /** Huecos de medición. Van aparte porque no son problemas de negocio. */
  huecos: string[]
  /** El mismo brief en texto plano, para dárselo al agente sin que gaste rondas de tools en recalcularlo. */
  resumenParaAgente: string
}

export type EntradaBrief = {
  salud: SaludNegocio
  diagnostico: Diagnostico
  alertas: Alerta[]
  escalado?: { veredicto: VeredictoEscalado; motivos: string[] } | null
  /** Periodo al que se refiere todo, para que el brief no hable de un "ahora" indefinido. */
  periodo?: { desde: string; hasta: string }
}

export function construirBrief(e: EntradaBrief): GrowthBrief {
  const p = e.diagnostico.primaria
  const { prioridades } = priorizar(e.alertas)

  // EL IMPACTO SOLO SE AFIRMA SI EL MOTOR LO HA CALCULADO. Escribir "podrías ganar X" cuando no hay
  // volumen con el que estimarlo es inventar el número más peligroso del panel.
  const impacto = p?.impacto
    ? {
        texto: `${p.impacto.eurosAdicionales !== null ? `~${formatCurrency(p.impacto.eurosAdicionales)} ` : ''}${p.impacto.unidadesAdicionales !== null ? `(~${formatNumber(p.impacto.unidadesAdicionales)} unidades) ` : ''}si se llevara ${p.nombre} a su objetivo. ${p.impacto.metodo}`,
        esEstimacion: true,
      }
    : {
        texto: p
          ? `No se puede estimar el impacto de ${p.nombre} con los datos actuales: falta el volumen base o no es una tasa.`
          : 'Sin restricción identificada, no hay impacto que estimar.',
        esEstimacion: false,
      }

  // LA ACCIÓN VIENE DEL ÁRBOL DE DIAGNÓSTICO, no de una ocurrencia. Si la restricción no trae qué
  // investigar, se dice que hay que investigarla, no se improvisa una táctica.
  const accion = p
    ? p.investigar.length > 0
      ? {
          texto: `${p.investigar[0]}${p.investigar.length > 1 ? ` (después: ${p.investigar.slice(1).join('; ')})` : ''}`,
          requiereAprobacion: false,
        }
      : {
          texto: `Investigar ${p.nombre} antes de actuar: no hay una causa acotada todavía.`,
          requiereAprobacion: false,
        }
    : {
        texto:
          e.diagnostico.sinDatos.length > 0
            ? `Nada fuera de objetivo entre lo medido. Lo siguiente que más valor daría es empezar a medir: ${e.diagnostico.sinDatos.map((s) => s.nombre).join(', ')}.`
            : 'Nada fuera de objetivo. Mantener y vigilar.',
        requiereAprobacion: false,
      }

  const huecos = e.diagnostico.sinDatos.map((s) => s.nombre)

  const brief: GrowthBrief = {
    salud: {
      puntuacion: e.salud.puntuacion,
      etiqueta: e.salud.etiqueta,
      titular: e.salud.titular,
      fiabilidad: e.salud.fiabilidad,
    },
    restriccion: {
      nombre: p?.nombre ?? null,
      certeza: p?.certeza ?? null,
      titular: e.diagnostico.titular,
      investigar: p?.investigar ?? [],
    },
    impacto,
    accion,
    escalado: e.escalado
      ? { veredicto: e.escalado.veredicto, motivo: e.escalado.motivos[0] ?? null }
      : { veredicto: null, motivo: null },
    alertas: prioridades,
    huecos,
    resumenParaAgente: '',
  }
  brief.resumenParaAgente = redactarResumen(brief, e.periodo)
  return brief
}

const ETIQUETA_VEREDICTO: Record<VeredictoEscalado, string> = {
  listo: 'LISTO PARA ESCALAR',
  con_cautela: 'ESCALAR CON CAUTELA',
  esperar: 'ESPERAR (techo de capacidad)',
  arreglar_antes: 'ARREGLAR ANTES DE ESCALAR',
}

function redactarResumen(b: GrowthBrief, periodo?: { desde: string; hasta: string }): string {
  const lineas: string[] = []
  lineas.push(periodo ? `Periodo: ${periodo.desde} → ${periodo.hasta}.` : 'Periodo: no especificado.')
  lineas.push(
    `SALUD: ${b.salud.puntuacion === null ? 'sin base suficiente para dar nota' : `${b.salud.puntuacion}/100 (${b.salud.etiqueta}, fiabilidad ${b.salud.fiabilidad})`}. ${b.salud.titular}`
  )
  lineas.push(`RESTRICCIÓN: ${b.restriccion.titular}`)
  lineas.push(`IMPACTO: ${b.impacto.texto}`)
  lineas.push(`ACCIÓN RECOMENDADA: ${b.accion.texto}`)
  if (b.escalado.veredicto) {
    lineas.push(
      `ESCALADO: ${ETIQUETA_VEREDICTO[b.escalado.veredicto]}${b.escalado.motivo ? ` — ${b.escalado.motivo}` : ''}`
    )
  }
  if (b.alertas.length > 0) {
    lineas.push(
      `ALERTAS (${b.alertas.length}): ${b.alertas.map((a) => `[${a.severidad}/${a.categoria}] ${a.titulo}`).join(' · ')}`
    )
  }
  if (b.huecos.length > 0) {
    // Se dice como lo que es: falta de medición. Si el agente lo lee como un problema de negocio, manda
    // al equipo a arreglar un número que nadie ha medido.
    lineas.push(`SIN MEDIR (hueco de medición, NO problema de negocio): ${b.huecos.join(', ')}.`)
  }
  return lineas.join('\n')
}
