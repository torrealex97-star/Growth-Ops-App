// LAS RESPUESTAS DEL FORMULARIO, SIN EL PAYLOAD CRUDO.
//
// Cada proveedor las guarda en un sitio distinto de su webhook, y hasta ahora la única forma de verlas
// era el volcado JSON completo — que además trae ids internos, URLs de cancelación y campos técnicos
// que nadie necesita para leer qué contestó la persona.
//
// FORMAS REALES, verificadas contra las 559 agendas de la base:
//
//   - Calendly (473): `invitee.questions_and_answers` → [{ question, answer, position }]
//   - GHL (86): no trae preguntas estructuradas. Lleva `notes` y `description` en texto, donde a veces
//     está lo que contestó la persona, pero sin pares pregunta/respuesta. Se devuelve como una sola
//     entrada etiquetada, y NO se parte por líneas fingiendo que son preguntas.
//   - Typeform: entra por su propio webhook con `form_response.answers` → [{ field, type, ... }].
//     Está contemplado aquí porque el negocio lo usa, aunque hoy no haya filas en `appointments`.
//
// POR QUÉ CENTRALIZADO. Es donde vive la cualificación (problema + ingresos ≥ umbral), y esas
// preguntas han cambiado de redacción tres veces. Con el parseo repartido por la UI, la siguiente
// versión del formulario habría dejado de cualificar en silencio.

import type { RespuestaFormulario } from '@/lib/metrics/cualificacion'

/** Etiqueta que se usa cuando el proveedor no da pares pregunta/respuesta. */
export const SIN_PREGUNTA_ESTRUCTURADA = 'Respuestas (texto libre del proveedor)'

type Json = Record<string, unknown>

const esObjeto = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const texto = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/**
 * Saca los pares pregunta/respuesta del payload de una agenda.
 *
 * Devuelve lista VACÍA cuando el proveedor no trae nada. Vacío significa "este formulario no preguntó
 * nada", que no es lo mismo que un error de lectura — y el que consume debe poder distinguirlo, así que
 * nunca se inventa una entrada de relleno.
 */
export function extraerRespuestas(payload: unknown, fuente?: string | null): RespuestaFormulario[] {
  if (!esObjeto(payload)) return []

  // --- Calendly ---
  const invitee = payload.invitee
  if (esObjeto(invitee) && Array.isArray(invitee.questions_and_answers)) {
    return (
      invitee.questions_and_answers
        .filter(esObjeto)
        .map((qa) => ({ pregunta: texto(qa.question).trim(), respuesta: texto(qa.answer).trim() }))
        // Una pregunta sin respuesta no aporta nada y ensucia la ficha; una respuesta sin pregunta no se
        // puede etiquetar, así que tampoco entra.
        .filter((r) => r.pregunta && r.respuesta)
    )
  }

  // --- Typeform ---
  const formResponse = payload.form_response
  if (esObjeto(formResponse) && Array.isArray(formResponse.answers)) {
    const titulos = new Map<string, string>()
    const definition = formResponse.definition
    if (esObjeto(definition) && Array.isArray(definition.fields)) {
      for (const f of definition.fields.filter(esObjeto)) {
        if (typeof f.id === 'string') titulos.set(f.id, texto(f.title).trim())
      }
    }
    return formResponse.answers
      .filter(esObjeto)
      .map((a) => {
        const field = esObjeto(a.field) ? a.field : {}
        const id = typeof field.id === 'string' ? field.id : ''
        // El texto de la respuesta vive en una clave distinta según el tipo de campo.
        const valor =
          texto(a.text) ||
          texto(a.email) ||
          texto(a.phone_number) ||
          texto(a.url) ||
          (typeof a.number === 'number' ? String(a.number) : '') ||
          (typeof a.boolean === 'boolean' ? (a.boolean ? 'Sí' : 'No') : '') ||
          (esObjeto(a.choice) ? texto(a.choice.label) : '') ||
          (esObjeto(a.choices) && Array.isArray(a.choices.labels) ? a.choices.labels.map(texto).join(', ') : '')
        return { pregunta: titulos.get(id) || texto(field.ref) || texto(field.title), respuesta: valor.trim() }
      })
      .filter((r) => r.pregunta && r.respuesta)
  }

  // --- GHL ---
  // No hay pares pregunta/respuesta. Lo que hay es texto de la cita. Se devuelve como UNA entrada
  // etiquetada: partirlo por líneas y llamar "pregunta" a la primera mitad sería inventarse una
  // estructura, y la cualificación acabaría leyendo ingresos de un texto que no los declara.
  if (normalizarFuente(fuente) === 'ghl') {
    const libre = [texto(payload.notes).trim(), texto(payload.description).trim()].filter(Boolean).join('\n')
    return libre ? [{ pregunta: SIN_PREGUNTA_ESTRUCTURADA, respuesta: libre }] : []
  }

  return []
}

function normalizarFuente(fuente?: string | null): string {
  return (fuente ?? '').trim().toLowerCase()
}

/**
 * ¿Trae este proveedor respuestas estructuradas, o solo texto?
 *
 * Importa para la fiabilidad de la cualificación: sobre texto libre de GHL no se puede afirmar que
 * alguien declare ingresos de 1.000€, y el panel tiene que poder decir "este formulario no lo pregunta"
 * en vez de contarlo como no cualificado.
 */
export function tieneRespuestasEstructuradas(respuestas: RespuestaFormulario[]): boolean {
  return respuestas.length > 0 && !respuestas.some((r) => r.pregunta === SIN_PREGUNTA_ESTRUCTURADA)
}
