// SERIES DIARIAS DE FACTURACIÓN Y CASH, para objetivos y previsión.
//
// PURO A PROPÓSITO, como agregados.ts: recibe las filas ya leídas y devuelve puntos por día. Reutiliza
// los MISMOS filtros que calcularAgregados (VENTAS_QUE_CUENTAN, enPeriodo, is_confirmed) para que la
// facturación del mes que ve el objetivo sea la MISMA cifra que ve la tarjeta de KPI — dos cálculos
// paralelos de "qué venta cuenta" es la forma más fácil de que el panel y el objetivo discrepen sin que
// nadie se entere.

import { enPeriodo, VENTAS_QUE_CUENTAN, type FilaCobro, type FilaVenta, type Periodo } from './agregados'
import { acumular, serieDiaria, type FilaSerie } from './series'
import type { PuntoSerie } from './prevision'

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Serie diaria acumulada de facturación (precio comprometido), solo ventas que cuentan. */
export function serieFacturacionAcumulada(ventas: FilaVenta[], periodo: Periodo): PuntoSerie[] {
  const filas: FilaSerie[] = ventas
    .filter((v) => enPeriodo(v.sale_date, periodo) && (!v.status || VENTAS_QUE_CUENTAN.has(v.status)))
    .map((v) => ({ fecha: v.sale_date, valor: num(v.gross_amount) }))
  return acumular(serieDiaria(filas, periodo))
}

/** Serie diaria acumulada de cash cobrado, solo cobros confirmados. */
export function serieCashAcumulada(cobros: FilaCobro[], periodo: Periodo): PuntoSerie[] {
  const filas: FilaSerie[] = cobros
    .filter((c) => c.is_confirmed !== false && enPeriodo(c.collected_at, periodo))
    .map((c) => ({ fecha: c.collected_at, valor: num(c.gross_amount) }))
  return acumular(serieDiaria(filas, periodo))
}
