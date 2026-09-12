// Detección determinista de anomalías (Proactive Intelligence Engine, punto 6/54/55 del brief):
// SIEMPRE compara números con umbrales fijos ANTES de gastar una llamada a un LLM. El LLM solo
// entra para redactar la explicación de una anomalía YA detectada de forma determinista — nunca
// para "vigilar" el negocio en bucle, que sería tirar dinero en tokens sin necesidad real.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getBusinessOverview, getFunnel, type ToolContext } from '@/lib/ai/agent/tools'

export type DetectedAnomaly = {
  type: string
  severity: 'critical' | 'warning' | 'opportunity' | 'info'
  title: string
  metric: string
  current: number
  previous: number
  pct_change: number
  fingerprint: string
}

// Ventana de comparación: últimos 7 días vs los 7 anteriores — suficiente para detectar cambios
// materiales sin reaccionar al ruido de un solo día (evita el "CAC subió" cada 24h sin motivo).
function last7DaysWindows(today = new Date()) {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const toB = new Date(today)
  const fromB = new Date(today)
  fromB.setDate(fromB.getDate() - 7)
  const toA = new Date(fromB)
  toA.setDate(toA.getDate() - 1)
  const fromA = new Date(toA)
  fromA.setDate(fromA.getDate() - 6)
  return {
    current: { from: fmt(fromB), to: fmt(toB) },
    previous: { from: fmt(fromA), to: fmt(toA) },
  }
}

// Semana ISO aproximada (YYYY-Www) para el fingerprint — dedup: no repetir el mismo aviso cada
// vez que corre el detector mientras siga vigente en la misma semana (punto 61: NEW/SEEN/...).
function weekKey(d: Date): string {
  const onejan = new Date(d.getFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${week}`
}

const pctChange = (curr: number | null, prev: number | null): number | null =>
  curr === null || prev === null || prev === 0 ? null : ((curr - prev) / prev) * 100

export async function detectAnomalies(tenantId: string, sb: SupabaseClient): Promise<DetectedAnomaly[]> {
  const ctx: ToolContext = { tenantId, sb }
  const { current, previous } = last7DaysWindows()
  const wk = weekKey(new Date())
  const [now, prev] = await Promise.all([getBusinessOverview(ctx, current), getBusinessOverview(ctx, previous)])
  const [funnelNow, funnelPrev] = await Promise.all([getFunnel(ctx, current), getFunnel(ctx, previous)])

  const anomalies: DetectedAnomaly[] = []

  const cacNow = now.ventas > 0 ? now.inversion / now.ventas : null
  const cacPrev = prev.ventas > 0 ? prev.inversion / prev.ventas : null
  const cacDelta = pctChange(cacNow, cacPrev)
  if (cacDelta !== null && cacDelta > 25 && (cacNow ?? 0) > 0) {
    anomalies.push({
      type: 'cac_increase',
      severity: cacDelta > 50 ? 'critical' : 'warning',
      title: 'El CAC ha subido de forma significativa',
      metric: 'CAC',
      current: cacNow!,
      previous: cacPrev!,
      pct_change: cacDelta,
      fingerprint: `cac_increase_${wk}`,
    })
  }

  const roasDelta = pctChange(funnelNow.roas, funnelPrev.roas)
  if (roasDelta !== null && roasDelta < -20 && funnelPrev.roas !== null && funnelPrev.roas > 0) {
    anomalies.push({
      type: 'roas_decrease',
      severity: roasDelta < -40 ? 'critical' : 'warning',
      title: 'El ROAS ha caído de forma significativa',
      metric: 'ROAS',
      current: funnelNow.roas ?? 0,
      previous: funnelPrev.roas ?? 0,
      pct_change: roasDelta,
      fingerprint: `roas_decrease_${wk}`,
    })
  }

  const showRateDelta = pctChange(funnelNow.pctShowUp, funnelPrev.pctShowUp)
  if (showRateDelta !== null && showRateDelta < -15 && funnelPrev.pctShowUp !== null && funnelPrev.pctShowUp > 0) {
    anomalies.push({
      type: 'show_rate_drop',
      severity: showRateDelta < -30 ? 'critical' : 'warning',
      title: 'El show rate ha caído',
      metric: 'Show rate',
      current: funnelNow.pctShowUp ?? 0,
      previous: funnelPrev.pctShowUp ?? 0,
      pct_change: showRateDelta,
      fingerprint: `show_rate_drop_${wk}`,
    })
  }

  const closeRateDelta = pctChange(funnelNow.pctCierre, funnelPrev.pctCierre)
  if (closeRateDelta !== null && closeRateDelta < -15 && funnelPrev.pctCierre !== null && funnelPrev.pctCierre > 0) {
    anomalies.push({
      type: 'close_rate_drop',
      severity: closeRateDelta < -30 ? 'critical' : 'warning',
      title: 'El close rate ha caído',
      metric: 'Close rate',
      current: funnelNow.pctCierre ?? 0,
      previous: funnelPrev.pctCierre ?? 0,
      pct_change: closeRateDelta,
      fingerprint: `close_rate_drop_${wk}`,
    })
  }

  const roasUpDelta = pctChange(funnelNow.roas, funnelPrev.roas)
  if (roasUpDelta !== null && roasUpDelta > 30 && funnelPrev.roas !== null && funnelPrev.roas > 0) {
    anomalies.push({
      type: 'roas_opportunity',
      severity: 'opportunity',
      title: 'El ROAS ha mejorado — posible oportunidad de escalar',
      metric: 'ROAS',
      current: funnelNow.roas ?? 0,
      previous: funnelPrev.roas ?? 0,
      pct_change: roasUpDelta,
      fingerprint: `roas_opportunity_${wk}`,
    })
  }

  return anomalies
}
