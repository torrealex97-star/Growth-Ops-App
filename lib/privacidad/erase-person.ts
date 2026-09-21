import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

import {
  PROVEEDORES_EXTERNOS,
  planificarBorrado,
  puedeDeclararseCompleto,
  type PasoBorrado,
  type PoliticaRetencion,
} from './plan-borrado'

// F6 — `erase_person`: EJECUTA el plan de borrado de una persona.
//
// El plan (qué se hace con cada store y por qué) vive en `plan-borrado.ts` y es puro. Aquí solo se
// aplica y se levanta acta. La separación no es estética: permite pedir el plan, leerlo y decidir,
// antes de que nada se borre.
//
// TRES REGLAS QUE NO SE NEGOCIAN:
//
//   1. El informe no miente. Cada store sale como HECHO, SIN_DATOS, BLOQUEADO o FALLIDO, con su
//      motivo. Nunca se agrupa un fallo dentro de un "todo bien".
//   2. La PII del contacto se borra SIEMPRE, incluso si otros stores quedan pendientes: es lo más
//      importante que hay que quitar, y retenerla "por prudencia" perjudica justo a quien pidió el
//      borrado. Lo que no se pudo hacer se dice en el informe, no se compensa dejando datos.
//   3. Es idempotente. Repetirlo sobre alguien ya borrado no falla ni duplica nada: los stores
//      salen SIN_DATOS.
//
// Inventario y recuentos: `docs/F6-MAPA-PII.md`.

export type EstadoStore = 'HECHO' | 'SIN_DATOS' | 'BLOQUEADO' | 'FALLIDO'

export type ResultadoStore = {
  store: string
  estado: EstadoStore
  filas?: number
  motivo: string
}

export type InformeBorrado = {
  tenantId: string
  /** Identificador NO reversible de la persona. El audit no puede conservar su id ni su correo. */
  personaHash: string
  /** Solo true si ningún store quedó bloqueado ni falló. */
  completo: boolean
  simulacion: boolean
  pasos: ResultadoStore[]
  /** Borrados que siguen pendientes fuera de este sistema. */
  pendienteEnProveedores: readonly { nombre: string; que: string }[]
  ejecutadoEn: string
}

/**
 * `raw_events` no tiene `contact_id` ni ninguna otra vía para localizar los payloads de una
 * persona: sus columnas son `id, tenant_id, source, payload, created_at`. Aunque la política de
 * retención estuviera decidida, HOY no se podría ejecutar.
 *
 * Es una limitación real, no una decisión pendiente, y por eso se declara aparte: mezclarla con los
 * bloqueos de política haría creer que basta con decidir para desbloquearla. F1, cuando ponga el
 * webhook de GHL a escribir en la capa raw, tiene que dejar los payloads localizables por persona.
 */
const RAW_SIN_VINCULO =
  'raw_events no tiene contact_id ni forma de localizar los payloads de una persona: aunque la ' +
  'retención estuviera decidida, hoy no se podría ejecutar. Requiere que F1 deje el vínculo.'

function hashPersona(tenantId: string, contactId: string): string {
  // Con sal por subcuenta: el mismo contacto en dos subcuentas no produce el mismo hash, así que un
  // audit no permite correlacionar personas entre clientes.
  return createHash('sha256').update(`${tenantId}:${contactId}`).digest('hex').slice(0, 32)
}

type Ctx = {
  sb: SupabaseClient
  tenantId: string
  contactId: string
  correos: string[]
  simulacion: boolean
}

/** Envuelve una operación para que un fallo salga como FALLIDO en el informe, nunca como excepción. */
async function ejecutar(
  store: string,
  motivo: string,
  simulacion: boolean,
  // PromiseLike y no Promise: el constructor de consultas de Supabase es *thenable* pero no una
  // Promise real, así que exigir Promise obligaría a un `await` extra o a un cast.
  op: () => PromiseLike<{ count: number | null; error: { message: string } | null }>
): Promise<ResultadoStore> {
  if (simulacion) return { store, estado: 'HECHO', motivo: `${motivo} (simulación: no se ha tocado nada)` }
  try {
    const { count, error } = await op()
    if (error) return { store, estado: 'FALLIDO', motivo: `${motivo}. Error: ${error.message}` }
    const filas = count ?? 0
    return { store, estado: filas > 0 ? 'HECHO' : 'SIN_DATOS', filas, motivo }
  } catch (e) {
    return { store, estado: 'FALLIDO', motivo: `${motivo}. Error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

async function aplicarPaso(paso: PasoBorrado, ctx: Ctx): Promise<ResultadoStore> {
  const { sb, tenantId, contactId, correos, simulacion } = ctx
  const base = (tabla: string) => sb.from(tabla).delete({ count: 'exact' }).eq('tenant_id', tenantId)
  const vaciar = (tabla: string, cols: string[]) =>
    sb
      .from(tabla)
      .update(Object.fromEntries(cols.map((c) => [c, null])), { count: 'exact' })
      .eq('tenant_id', tenantId)

  if (paso.tratamiento === 'bloqueado') {
    return { store: paso.store, estado: 'BLOQUEADO', motivo: paso.motivo }
  }

  switch (paso.store) {
    case 'contact_notes':
    case 'contact_attributions':
      return ejecutar(paso.store, paso.motivo, simulacion, () => base(paso.store).eq('contact_id', contactId))

    case 'activities':
      return ejecutar(paso.store, paso.motivo, simulacion, () =>
        vaciar('activities', paso.columnas ?? ['notes']).eq('contact_id', contactId)
      )

    case 'fathom_match_review':
      // Por contacto Y por correo: 108 de sus 177 filas nunca llegaron a tener contacto asociado,
      // así que borrar solo por contact_id dejaría la PII de esas personas intacta.
      return ejecutar(paso.store, paso.motivo, simulacion, () => {
        const filtro =
          correos.length > 0
            ? `contact_id.eq.${contactId},invitee_email.in.(${correos.map((c) => `"${c}"`).join(',')})`
            : `contact_id.eq.${contactId}`
        return base('fathom_match_review').or(filtro)
      })

    case 'stripe_customers':
      return ejecutar(paso.store, paso.motivo, simulacion, () =>
        vaciar('stripe_customers', paso.columnas ?? ['email', 'name']).eq('contact_id', contactId)
      )

    case 'canonical_events':
      return ejecutar(paso.store, paso.motivo, simulacion, () =>
        vaciar('canonical_events', ['contact_id']).eq('contact_id', contactId)
      )

    case 'appointments.transcript':
      return ejecutar(paso.store, paso.motivo, simulacion, () =>
        vaciar('appointments', paso.columnas ?? ['notes']).eq('contact_id', contactId)
      )

    case 'raw_events':
      // Nunca se ejecuta: no hay vínculo. Ver RAW_SIN_VINCULO.
      return { store: paso.store, estado: 'BLOQUEADO', motivo: RAW_SIN_VINCULO }

    case 'sales / collections':
      return ejecutar(paso.store, paso.motivo, simulacion, () =>
        vaciar('sales', paso.columnas ?? ['access_email', 'notes']).eq('contact_id', contactId)
      )

    case 'contacts':
      // El último paso, y solo si nada quedó pendiente: lo decide `erasePerson`, no este switch.
      return ejecutar(paso.store, paso.motivo, simulacion, () =>
        sb
          .from('contacts')
          .update(
            { ...Object.fromEntries((paso.columnas ?? []).map((c) => [c, null])), lifecycle: 'erased' },
            { count: 'exact' }
          )
          .eq('tenant_id', tenantId)
          .eq('id', contactId)
      )

    default:
      // Deny-by-default: un store nuevo en el plan sin implementación aquí NO se salta en silencio.
      return {
        store: paso.store,
        estado: 'BLOQUEADO',
        motivo: `el plan declara "${paso.store}" pero el ejecutor no sabe tratarlo: se bloquea en vez de ignorarlo`,
      }
  }
}

/**
 * Borra a una persona de los stores activos y devuelve el acta.
 *
 * `simulacion: true` produce el informe completo sin tocar nada — el modo en que se revisa un
 * borrado antes de ejecutarlo.
 */
export async function erasePerson(
  sb: SupabaseClient,
  opciones: { tenantId: string; contactId: string; politica: PoliticaRetencion; simulacion?: boolean }
): Promise<InformeBorrado> {
  const { tenantId, contactId, politica } = opciones
  const simulacion = opciones.simulacion === true

  // Los correos se leen ANTES de anonimizar: después ya no existirían, y `fathom_match_review` los
  // necesita para alcanzar las filas que nunca tuvieron contacto asociado.
  const { data: contacto } = await sb
    .from('contacts')
    .select('email, email_normalized')
    .eq('tenant_id', tenantId)
    .eq('id', contactId)
    .maybeSingle()
  const correos = [...new Set([contacto?.email, contacto?.email_normalized].filter(Boolean) as string[])]

  const plan = planificarBorrado(politica)
  const ctx: Ctx = { sb, tenantId, contactId, correos, simulacion }

  const pasos: ResultadoStore[] = []
  for (const paso of plan) {
    if (paso.store === 'contacts') continue // se decide al final
    pasos.push(await aplicarPaso(paso, ctx))
  }

  // EL CONTACTO SE ANONIMIZA SIEMPRE, aunque queden stores pendientes.
  //
  // La primera versión lo bloqueaba "por prudencia" si algo anterior fallaba. Era un error, y lo
  // destaparon los tests: `raw_events` está bloqueado de forma permanente hasta que F1 le dé un
  // vínculo con la persona, así que con esa regla el nombre, el correo y el teléfono se habrían
  // quedado en el CRM PARA SIEMPRE. Peor para la persona que el riesgo que se quería evitar.
  //
  // El riesgo real era otro: una cáscara marcada como borrada que TODAVÍA conserva PII. Eso no
  // ocurre — tras este paso la fila no tiene ningún dato personal. Lo que queda pendiente está en
  // otros stores, y de eso informa `completo: false` con el detalle por store.
  const hayPendientes = pasos.some((p) => p.estado === 'BLOQUEADO' || p.estado === 'FALLIDO')
  pasos.push(
    await aplicarPaso(
      plan.find((p) => p.store === 'contacts')!,
      ctx
    )
  )

  const informe: InformeBorrado = {
    tenantId,
    personaHash: hashPersona(tenantId, contactId),
    completo: !hayPendientes && puedeDeclararseCompleto(plan) && pasos.every((p) => p.estado !== 'FALLIDO'),
    simulacion,
    pasos,
    pendienteEnProveedores: PROVEEDORES_EXTERNOS,
    ejecutadoEn: new Date().toISOString(),
  }

  // Audit: SOLO el hecho del borrado, con identificador no reversible. Guardar aquí el contact_id o
  // el correo reintroduciría en el sistema justo lo que se acaba de borrar.
  if (!simulacion) {
    await sb.from('audit_logs').insert({
      tenant_id: tenantId,
      action: 'erase_person',
      entity_type: 'contacts',
      entity_id: null,
      new_values: {
        persona_hash: informe.personaHash,
        completo: informe.completo,
        pasos: informe.pasos.map((p) => ({ store: p.store, estado: p.estado })),
      },
    })
  }

  return informe
}
