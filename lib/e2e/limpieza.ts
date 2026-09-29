/**
 * Limpieza FK-safe del tenant QA de E2E (qa-e2e).
 *
 * Borra TODA la actividad transaccional de la subcuenta: las ventas de prueba no se
 * acumulan corrida tras corrida en las métricas del tenant. El orden de borrado respeta
 * las FK reales hacia `sales` (mismas restricciones que `sales/delete`, pero aquí borramos
 * también contratos/eventos/drops porque TODO el contenido del tenant QA es sintético).
 *
 *   contacts/leads/appointments/products/payment_plans/users → NO se tocan (fixtures que
 *   reutilizan los specs: borrarlos los recrearía en el siguiente setup, sin ganancia).
 *
 * Tablas con FK hacia sales (migraciones 10090000/10110000/11100000):
 *   document_verifications, payment_follow_ups, sale_expected_installments  (CASCADE al borrar venta)
 *   canonical_events                                                        (SET NULL al borrar venta)
 *   collections, commissions, refunds, contracts, csm_events, drops          (RESTRICT: bloquean)
 *   campaign_ads                                                             (FK opcional, por si acaso)
 *   sales.origin_sale_id, sales.converted_from_reservation_id                (autorreferencia)
 *
 * Módulo puro: recibe el cliente; el global-teardown lo llama con service-role y CI sin
 * BD solo ejecuta su test (que tampoco necesita red).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** Orden de borrado: hijos → padres. Mantener en sync con las FK de las migraciones. */
export const ORDEN_BORRADO = [
  'document_verifications',
  'payment_follow_ups',
  'sale_expected_installments',
  'commissions',
  'refunds',
  'collections',
  'contracts',
  'csm_events',
  'drops',
  'campaign_ads',
  'canonical_events',
  'sale_drafts',
  'sales',
] as const

export type ResultadoLimpieza = { tabla: string; filas: number | null; error?: string }

/** Borra una tabla escopada por tenant y devuelve el nº de filas eliminadas (null si falla). */
async function borrarTabla(
  sb: SupabaseClient,
  tabla: string,
  tenantId: string,
  errores: string[]
): Promise<number | null> {
  // select('id', { count: 'exact' }) tras .delete() devuelve el nº de filas borradas; el cast
  // es necesario porque los tipos de supabase-js no exponen opciones en el select de delete.
  const { count, error } = await (sb.from(tabla).delete().eq('tenant_id', tenantId) as any).select('id', {
    count: 'exact',
  })
  if (error) {
    // PGRST205 = la tabla no existe todavía en ESTE entorno (migración pendiente de aplicar, p.ej.
    // en el proyecto Supabase que usa el E2E de CI). No es un fallo de la limpieza en sí — una tabla
    // que no existe no tiene filas que borrar — así que no se cuenta como error de verdad; solo se
    // avisa para que quien vea el resultado sepa que esa tabla concreta va a la zaga de main.
    if (/Could not find the table/i.test(error.message)) {
      console.warn(`[e2e-limpieza] ${tabla} no existe todavía en este entorno (migración pendiente): 0 filas`)
      return 0
    }
    errores.push(`${tabla}: ${error.message}`)
    return null
  }
  return count ?? 0
}

/**
 * Limpia la actividad transaccional de un tenant. Idempotente: re-ejecutar sobre un tenant
 * limpio borra 0 filas y devuelve ok=true.
 */
export async function limpiarActividadTenant(
  sb: SupabaseClient,
  tenantId: string
): Promise<{ ok: boolean; total: number; resultados: ResultadoLimpieza[] }> {
  const errores: string[] = []
  const resultados: ResultadoLimpieza[] = []

  // Los contratos firmados guardan su PDF en Storage (bucket `contratos`, ruta
  // `{contractId}.pdf`): purgar los objetos antes de que el bucle borre las filas evita
  // huérfanos en el bucket corrida tras corrida (solo las filas ya limpiadas).
  {
    const { data: contratos } = await sb.from('contracts').select('id, signed_pdf_url').eq('tenant_id', tenantId)
    const paths = (contratos ?? [])
      .map((c) => c.signed_pdf_url)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    if (paths.length) {
      const { error } = await sb.storage.from('contratos').remove(paths)
      if (error) {
        errores.push(`storage/contratos: ${error.message}`)
        // null = no se sabe cuántos objetos quedaron sin purgar (misma semántica que
        // un fallo de borrado en tabla).
        resultados.push({ tabla: 'storage/contratos', filas: null, error: error.message })
      } else {
        resultados.push({ tabla: 'storage/contratos', filas: paths.length })
      }
    }
  }

  for (const tabla of ORDEN_BORRADO) {
    const filas = await borrarTabla(sb, tabla, tenantId, errores)
    resultados.push({ tabla, filas, ...(filas === null ? { error: errores[errores.length - 1] } : {}) })
  }

  // Cierre de auditoría de la propia limpieza (no cuenta como actividad de negocio).
  // entity_id es NOT NULL (20260910090000_initial_growth_ops.sql): al no haber una fila que
  // borrar que sea "la entidad", se usa el propio tenant — es lo que este evento describe.
  const { error: auditErr } = await sb.from('audit_logs').insert({
    tenant_id: tenantId,
    entity_type: 'e2e_cleanup',
    entity_id: tenantId,
    action: 'delete',
    old_values: { tablas: resultados },
    new_values: { motivo: 'Limpieza post-suite E2E del tenant QA' },
  })
  // Se añade a `resultados` (no solo a `errores`) para que un fallo aquí no quede invisible
  // para quien lee `resultados` en vez de reconstruir el mensaje a mano (como hacía
  // scripts/e2e/setup-tenant.mjs, que antes de esto lanzaba "No se pudo limpiar el tenant QA: "
  // con el motivo vacío justo por este hueco).
  if (auditErr) {
    errores.push(`audit_logs: ${auditErr.message}`)
    resultados.push({ tabla: 'audit_logs', filas: null, error: auditErr.message })
  }

  return {
    ok: errores.length === 0,
    total: resultados.reduce((s, r) => s + (r.filas ?? 0), 0),
    resultados,
  }
}
