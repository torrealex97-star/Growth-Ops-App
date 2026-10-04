// CAMPAÑAS DEL PERIODO CON LA MISMA SEMÁNTICA QUE LAS PANTALLAS (F10).
//
// Las pantallas de Marketing suman `campaign_daily` (gasto, impresiones, clics… por DÍA) dentro del
// periodo. El agente de IA, en cambio, filtraba `campaigns` por `start_date` y usaba los ACUMULADOS de
// toda la vida de la campaña: «gasto de septiembre» salía como el gasto histórico de cualquier campaña
// que empezó en septiembre, y dos pantallas con el mismo nombre de métrica daban cifras distintas.
//
// Aquí, con un periodo acotado, cada campaña lleva SUS sumas diarias del periodo y las que no tuvieron
// actividad diaria en él se descartan. Lo que NO es diario (agendas, llamadas y cierres atribuidos,
// facturación) es un acumulado de la campaña y no se puede repartir por días: se deja como está y se
// avisa en vez de presentarlo como del periodo. Puro: no sabe de Supabase.

import type { Campaign } from '@/lib/types/database'

export type FilaDiaria = {
  campaign_id: string | null
  date: string
  spend: number | string | null
  impressions: number | string | null
  clicks: number | string | null
  leads: number | string | null
  reach: number | string | null
  link_clicks: number | string | null
  landing_views: number | string | null
}

const n = (x: number | string | null | undefined) => Number(x ?? 0) || 0

export const AVISO_ACUMULADOS =
  'Gasto, impresiones, clics, alcance, visitas y leads de Meta son del periodo (suma diaria). Agendas, llamadas, cierres y facturación atribuidos son acumulados de cada campaña: no se pueden repartir por días y no son del periodo.'

export function campanasDelPeriodo(
  campaigns: Campaign[],
  diarias: FilaDiaria[],
  period: { from?: string; to?: string }
): { campaigns: Campaign[]; aviso: string | null } {
  if (!period.from && !period.to) return { campaigns, aviso: null }
  const porCampana = new Map<string, FilaDiaria[]>()
  for (const d of diarias) {
    if (!d.campaign_id) continue
    if (period.from && d.date < period.from) continue
    if (period.to && d.date > period.to) continue
    porCampana.set(d.campaign_id, [...(porCampana.get(d.campaign_id) ?? []), d])
  }
  const salida: Campaign[] = []
  for (const c of campaigns) {
    const dias = porCampana.get(c.id)
    if (!dias || dias.length === 0) continue
    const suma = (k: keyof FilaDiaria) => dias.reduce((acc, d) => acc + n(d[k]), 0)
    salida.push({
      ...c,
      adspend: suma('spend'),
      impressions: suma('impressions'),
      clicks: suma('clicks'),
      meta_leads: suma('leads'),
      reach: suma('reach'),
      link_clicks: suma('link_clicks'),
      landing_views: suma('landing_views'),
    })
  }
  return { campaigns: salida, aviso: AVISO_ACUMULADOS }
}
