import type { SupabaseClient } from '@supabase/supabase-js'
import { CONTEXTO_VACIO, type ContextoNegocio } from '@/lib/ai/agent/growth-operator'

// CARGA DEL CONTEXTO DE NEGOCIO (tabla `growth_context`, una fila por subcuenta).
//
// TOLERA QUE LA TABLA NO EXISTA TODAVÍA. La migración va versionada y puede no estar aplicada en un
// entorno concreto; sin esta tolerancia el agente entero dejaría de responder por una tabla de
// configuración opcional. Se distingue el caso a propósito:
//
//   tabla ausente o fila ausente  → contexto vacío, y el prompt DECLARA que no está configurado.
//   error real de base            → se propaga, porque callarlo sería servir un análisis sobre datos
//                                   que no se han podido leer sin decirlo.
//
// Lo que nunca pasa es rellenar un precio o un objetivo con un valor plausible: un objetivo inventado
// convierte todo el panel en una comparación contra una cifra que nadie decidió.

/** `42P01` = relación inexistente en PostgreSQL. */
const TABLA_NO_EXISTE = '42P01'

const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

export function mapearContexto(row: Record<string, unknown> | null | undefined): ContextoNegocio {
  if (!row) return CONTEXTO_VACIO
  return {
    tipoNegocio: texto(row.business_type),
    nombreOferta: texto(row.offer_name),
    precioOfertaEur: numero(row.offer_price_eur),
    cicloVentaDias: numero(row.sales_cycle_days),
    objetivoFacturacionMensualEur: numero(row.target_monthly_revenue_eur),
    objetivoLtgpCac: numero(row.target_ltgp_cac),
    objetivoCashRoas: numero(row.target_cash_roas),
    capacidadLlamadasSemana: numero(row.capacity_calls_per_week),
    capacidadClientesActivos: numero(row.capacity_active_clients),
    costeMedioEntregaEur: numero(row.avg_delivery_cost_eur),
    notas: texto(row.notes),
  }
}

export async function cargarContextoNegocio(sb: SupabaseClient, tenantId: string): Promise<ContextoNegocio> {
  const { data, error } = await sb
    .from('growth_context')
    .select(
      'business_type,offer_name,offer_price_eur,sales_cycle_days,target_monthly_revenue_eur,target_ltgp_cac,target_cash_roas,capacity_calls_per_week,capacity_active_clients,avg_delivery_cost_eur,notes'
    )
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    if (error.code === TABLA_NO_EXISTE) return CONTEXTO_VACIO
    throw new Error(`No se pudo leer el contexto de negocio: ${error.message}`)
  }
  return mapearContexto(data as Record<string, unknown> | null)
}
