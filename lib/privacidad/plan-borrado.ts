// F6 — QUÉ HAY QUE BORRAR CUANDO SE BORRA A UNA PERSONA, Y QUÉ NO SE PUEDE BORRAR TODAVÍA.
//
// Este módulo NO toca la base de datos: decide. Es una función pura que, dada la política de
// retención vigente, produce el plan de borrado y el esqueleto del informe. Está separado del
// ejecutor por dos motivos:
//
//   1. Se puede probar entero sin base de datos, incluidos los casos que importan (qué queda
//      bloqueado, qué se anonimiza en vez de borrarse, qué no se toca nunca).
//   2. El plan es AUDITABLE antes de ejecutarse. Un borrado de PII no debería ser una caja negra:
//      se puede pedir el plan, leerlo y solo entonces ejecutarlo.
//
// LA REGLA QUE GOBIERNA TODO: un informe que dice "hecho" sobre algo que no se hizo es peor que no
// tener informe. Por eso los stores cuyo tratamiento depende de una decisión de retención que aún
// no está tomada salen como BLOQUEADO con el motivo, nunca como hechos.
//
// Inventario de origen y recuentos reales: `docs/F6-MAPA-PII.md`.

/** Cómo se trata cada store. */
export type Tratamiento =
  | 'borrar' // la fila entera desaparece: existe solo por la persona
  | 'anonimizar' // la fila se conserva sin PII: sostiene hechos o agregados
  | 'desvincular' // se anula la referencia a la persona, el hecho permanece
  | 'bloqueado' // no se puede decidir sin una política que todavía no existe

export type PasoBorrado = {
  store: string
  tratamiento: Tratamiento
  /** Columnas que se vacían cuando el tratamiento es `anonimizar`. */
  columnas?: string[]
  /** Por qué se trata así. Acaba en el informe: nadie debería tener que leer el código. */
  motivo: string
}

/**
 * Política de retención. Cada campo es una decisión de negocio y base legal, no técnica
 * (`docs/F6-MAPA-PII.md` §7). `null` significa "sin decidir", y eso bloquea al store que dependa
 * de ella en vez de inventarse un comportamiento.
 */
export type PoliticaRetencion = {
  /** Qué hacer con los payloads de proveedor en `raw_events`. */
  raw: 'borrar' | 'anonimizar' | null
  /** Qué hacer con las transcripciones de llamadas. */
  transcripciones: 'borrar' | 'conservar' | null
  /** Si los hechos financieros deben persistir por obligación legal. */
  hechosFinancieros: 'conservar_sin_pii' | 'borrar' | null
}

export const POLITICA_SIN_DECIDIR: PoliticaRetencion = {
  raw: null,
  transcripciones: null,
  hechosFinancieros: null,
}

/**
 * Construye el plan de borrado para una persona.
 *
 * El orden importa: primero lo que solo existe por ella, después lo que se anonimiza, y al final la
 * marca en `contacts`. Así, si la ejecución se corta a la mitad, lo que queda es una persona aún
 * marcada como viva con parte de su PII borrada —estado detectable y reintentable— y no una cáscara
 * marcada como borrada que todavía conserva datos.
 */
export function planificarBorrado(politica: PoliticaRetencion): PasoBorrado[] {
  const pasos: PasoBorrado[] = [
    {
      store: 'contact_notes',
      tratamiento: 'borrar',
      motivo: 'la nota existe solo por esta persona y no sostiene ningún agregado',
    },
    {
      store: 'contact_attributions',
      tratamiento: 'borrar',
      motivo: 'la atribución describe a esta persona; los agregados de campaña no dependen de ella',
    },
    {
      store: 'activities',
      tratamiento: 'anonimizar',
      columnas: ['notes'],
      motivo: 'la actividad cuenta para métricas de equipo; el texto libre puede nombrar a la persona',
    },
    {
      store: 'fathom_match_review',
      tratamiento: 'borrar',
      motivo:
        'cola de revisión: su único contenido personal es invitee_email. Se borra por contact_id y ' +
        'también por correo, porque 108 de sus filas nunca llegaron a tener contacto asociado',
    },
    {
      store: 'stripe_customers',
      tratamiento: 'anonimizar',
      columnas: ['email', 'name'],
      motivo: 'el espejo de Stripe sostiene la conciliación de cobros; sin nombre ni correo sigue sirviendo',
    },
    {
      store: 'canonical_events',
      tratamiento: 'desvincular',
      motivo: 'los hechos son inmutables: se anula contact_id y el evento permanece para las métricas',
    },
  ]

  pasos.push(
    politica.transcripciones === null
      ? {
          store: 'appointments.transcript',
          tratamiento: 'bloqueado',
          motivo:
            'la retención de transcripciones no está decidida. Son 107 grabaciones de llamadas con ' +
            'personas reales: borrarlas o conservarlas depende de la base legal, no del código',
        }
      : {
          store: 'appointments.transcript',
          tratamiento: politica.transcripciones === 'borrar' ? 'anonimizar' : 'anonimizar',
          columnas: politica.transcripciones === 'borrar' ? ['transcript', 'notes', 'transcript_drive_url'] : ['notes'],
          motivo:
            politica.transcripciones === 'borrar'
              ? 'retención decidida: la transcripción se vacía y la cita se conserva como hecho'
              : 'retención decidida: la transcripción se conserva; se vacían las notas libres',
        }
  )

  pasos.push(
    politica.raw === null
      ? {
          store: 'raw_events',
          tratamiento: 'bloqueado',
          motivo:
            'la retención de raw no está decidida. El payload del proveedor puede contener PII, y ' +
            'borrarlo impide reprocesar el día; conservarlo exige registrar la excepción',
        }
      : {
          store: 'raw_events',
          tratamiento: politica.raw === 'borrar' ? 'borrar' : 'anonimizar',
          columnas: politica.raw === 'anonimizar' ? ['payload'] : undefined,
          motivo:
            politica.raw === 'borrar'
              ? 'retención decidida: el payload se borra'
              : 'retención decidida: el payload se anonimiza y se registra la excepción de retención',
        }
  )

  pasos.push(
    politica.hechosFinancieros === null
      ? {
          store: 'sales / collections',
          tratamiento: 'bloqueado',
          motivo:
            'no está decidido cuánto deben persistir ventas y cobros por obligación legal. El plazo ' +
            'lo fija un asesor, no esta función',
        }
      : politica.hechosFinancieros === 'conservar_sin_pii'
        ? {
            store: 'sales / collections',
            tratamiento: 'anonimizar',
            columnas: ['access_email', 'notes'],
            motivo: 'se conservan como hecho contable, sin PII directa',
          }
        : {
            store: 'sales / collections',
            tratamiento: 'borrar',
            motivo: 'retención decidida: no hay obligación de conservarlos',
          }
  )

  // Siempre el último: marca la cáscara. Si algo anterior quedó bloqueado, el ejecutor NO llega aquí.
  pasos.push({
    store: 'contacts',
    tratamiento: 'anonimizar',
    columnas: [
      'full_name',
      'email',
      'email_normalized',
      'phone',
      'phone_normalized',
      'first_name',
      'last_name',
      'instagram',
      'notes',
    ],
    motivo: 'la fila se conserva sin PII y con lifecycle = erased, para no romper hechos con obligación legal',
  })

  return pasos
}

/** Los stores que no se pueden tratar todavía, con su motivo. */
export function pasosBloqueados(pasos: readonly PasoBorrado[]): PasoBorrado[] {
  return pasos.filter((p) => p.tratamiento === 'bloqueado')
}

/**
 * ¿Puede el borrado declararse completo?
 *
 * No basta con que no falle: si algún store quedó bloqueado, el resultado es PARCIAL. Declarar
 * "completo" con stores sin tratar es exactamente la mentira que este módulo existe para evitar.
 */
export function puedeDeclararseCompleto(pasos: readonly PasoBorrado[]): boolean {
  return pasosBloqueados(pasos).length === 0
}

/**
 * Proveedores externos donde la persona también existe.
 *
 * `erase_person` no puede borrar ahí: no hay API para todos, y donde la hay el borrado es
 * asíncrono. Lo que sí debe hacer es ENUMERARLOS, para que el informe diga qué queda pendiente
 * fuera en vez de sugerir que el borrado terminó.
 */
export const PROVEEDORES_EXTERNOS = [
  { nombre: 'GHL', que: 'contactos y agendas' },
  { nombre: 'Stripe', que: 'cliente con nombre y correo' },
  { nombre: 'Fathom', que: 'grabaciones y transcripciones' },
  { nombre: 'Calendly', que: 'invitados de las reservas' },
  { nombre: 'Resend', que: 'registro de envíos de email' },
] as const
