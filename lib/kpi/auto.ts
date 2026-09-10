// Qué campos del KPI diario se rellenan AUTOMÁTICAMENTE desde los datos de la app
// (agendas + ventas atribuidas al usuario), y no debe rellenar la persona.
//   · Closer: todo su KPI sale solo (calls/shows/ventas/cash).
//   · Setter: las agendas que genera y sus shows salen solos; lo demás
//     (conversaciones, mensajes, etc.) lo sigue rellenando a mano.

export type KpiAutoMetrics = {
  setter_agendas: number
  setter_shows: number
  closer_appointments: number
  closer_shows: number
  closer_sales: number
  closer_cash: number
}

// role_key → (field_key del template → métrica calculada)
export const AUTO_KPI: Record<string, Record<string, keyof KpiAutoMetrics>> = {
  closer: {
    calls_realizadas: 'closer_appointments',
    shows: 'closer_shows',
    ventas_cerradas: 'closer_sales',
    cash_collected: 'closer_cash',
  },
  setter: {
    agendas_generadas: 'setter_agendas',
    citas_agendadas: 'setter_agendas',
    shows: 'setter_shows',
  },
}

export function autoFieldKeys(role: string): Set<string> {
  return new Set(Object.keys(AUTO_KPI[role] ?? {}))
}

// Construye los valores automáticos { field_key: valor } para un rol y sus métricas.
export function buildAutoValues(role: string, metrics: KpiAutoMetrics): Record<string, number> {
  const map = AUTO_KPI[role] ?? {}
  const out: Record<string, number> = {}
  for (const [field, metric] of Object.entries(map)) out[field] = metrics[metric] ?? 0
  return out
}
