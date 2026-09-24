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

  for (const tabla of ORDEN_BORRADO) {
    const filas = await borrarTabla(sb, tabla, tenantId, errores)
    resultados.push({ tabla, filas, ...(filas === null ? { error: errores[errores.length - 1] } : {}) })
  }

  // Cierre de auditoría de la propia limpieza (no cuenta como actividad de negocio).
  await sb.from('audit_logs').insert({
    tenant_id: tenantId,
    entity_type: 'e2e_cleanup',
    action: 'delete',
    old_values: { tablas: resultados },
    new_values: { motivo: 'Limpieza post-suite E2E del tenant QA' },
  })

  return {
    ok: errores.length === 0,
    total: resultados.reduce((s, r) => s + (r.filas ?? 0), 0),
    resultados,
  }
}
