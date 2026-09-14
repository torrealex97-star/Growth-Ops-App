import type { SupabaseClient } from '@supabase/supabase-js'

// Resolución del TRAMO/nivel de gamificación (sales_tramos) de un rep, en el SERVIDOR.
// Replica la lógica que el dashboard usa en cliente (app/${tenant}/dashboard/page.tsx) para que
// "el nivel que el closer ve" y "el nivel que decide su comisión" sean EXACTAMENTE el mismo.
// Se usa para enlazar los tramos con las reglas de comisión: una regla con `tramo_id` aplica su %
// cuando el rep está en ese tramo.

export type TramoConfig = { metric: 'sales' | 'cash_collected'; period: 'month' | 'all' }
export type TramoRow = { id: string; threshold: number; sort_order: number }

const nowYm = () => new Date().toISOString().slice(0, 7)

// Carga la config global + los tramos activos ordenados por umbral. Devuelve null si no hay tramos
// definidos (o la tabla no existe): en ese caso las comisiones caen al modelo por cash collected.
export async function loadTramoContext(
  sb: SupabaseClient,
  tenantId: string
): Promise<{ config: TramoConfig; tramos: TramoRow[] } | null> {
  try {
    const { data: rows, error } = await sb
      .from('sales_tramos')
      .select('id, threshold, sort_order')
      .eq('is_active', true)
      .eq('tenant_id', tenantId)
    if (error || !rows || rows.length === 0) return null
    // Acotado por subcuenta, no por `id = 1`: la PK de sales_tramos_config pasó a ser tenant_id
    // (migración 20260911170000) pero la columna `id` sigue con default 1, así que con dos
    // subcuentas `.eq('id', 1).maybeSingle()` encontraba DOS filas, devolvía error y se caía a los
    // valores por defecto — el tramo se calculaba con una configuración que nadie había elegido.
    const { data: cfg } = await sb
      .from('sales_tramos_config')
      .select('metric, period')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    const config: TramoConfig = {
      metric: (cfg?.metric as TramoConfig['metric']) ?? 'sales',
      period: (cfg?.period as TramoConfig['period']) ?? 'month',
    }
    const tramos: TramoRow[] = rows
      .map((r) => ({ id: r.id as string, threshold: Number(r.threshold), sort_order: r.sort_order as number }))
      .sort((a, b) => a.threshold - b.threshold)
    return { config, tramos }
  } catch {
    return null
  }
}

// Valor actual del rep para medir su tramo: nº de ventas completadas o cash collected, en el periodo
// configurado (mes en curso o histórico). "Venta completada" = activa que NO sea reserva abierta.
export async function repTramoValue(
  sb: SupabaseClient,
  tenantId: string,
  repId: string,
  config: TramoConfig
): Promise<number> {
  const monthOnly = config.period === 'month'

  const { data: salesData } = await sb
    .from('sales')
    .select('id, status, sale_date, reservation_completed_at, payment_plans(method)')
    .eq('tenant_id', tenantId)
    .or(`closer_id.eq.${repId},setter_id.eq.${repId}`)
    .limit(10000)
  const sales = (salesData ?? []) as Array<{
    id: string
    status: string | null
    sale_date: string | null
    reservation_completed_at: string | null
    payment_plans?: { method?: string | null } | { method?: string | null }[] | null
  }>

  if (config.metric === 'cash_collected') {
    const saleIds = sales.map((s) => s.id)
    if (!saleIds.length) return 0
    const { data: colls } = await sb
      .from('collections')
      .select('gross_amount, collected_at, status')
      .eq('tenant_id', tenantId)
      .in('sale_id', saleIds)
      .eq('status', 'collected')
      .limit(10000)
    return (colls ?? [])
      .filter((c) => !monthOnly || (c.collected_at || '').slice(0, 7) === nowYm())
      .reduce((s, c) => s + Number(c.gross_amount || 0), 0)
  }

  // metric === 'sales' → nº de ventas completadas
  return sales.filter((s) => {
    if (s.status === 'cancelled' || s.status === 'refunded') return false
    const pp = s.payment_plans
    const method = Array.isArray(pp) ? pp[0]?.method : pp?.method
    const openReserva = method === 'reserva' && !s.reservation_completed_at
    if (openReserva) return false
    if (monthOnly && (s.sale_date || '').slice(0, 7) !== nowYm()) return false
    return true
  }).length
}

// Id del tramo más alto cuyo umbral alcanza el rep (o null si no llega ni al primero).
export function currentTramoId(value: number, tramos: TramoRow[]): string | null {
  let cur: string | null = null
  for (const t of tramos) if (value >= t.threshold) cur = t.id
  return cur
}

// Mapa repId → tramoId actual, para pasarlo a la calculadora de comisiones. Si no hay tramos
// definidos devuelve {} (la calculadora usa entonces el modelo por cash collected).
export async function tramoIdByReps(
  sb: SupabaseClient,
  tenantId: string,
  repIds: (string | null | undefined)[]
): Promise<Record<string, string | null>> {
  const ids = Array.from(new Set(repIds.filter((x): x is string => !!x)))
  const out: Record<string, string | null> = {}
  if (!ids.length) return out
  const ctx = await loadTramoContext(sb, tenantId)
  if (!ctx) return out
  for (const id of ids) {
    const value = await repTramoValue(sb, tenantId, id, ctx.config)
    out[id] = currentTramoId(value, ctx.tramos)
  }
  return out
}
