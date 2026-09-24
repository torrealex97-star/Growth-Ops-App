// NUEVO vs RECURRENTE — la distinción que pide el negocio (23-sep).
//
// "En facturación y cash collected debe ser claro qué es nuevo y qué es MRR de
// ventas de meses pasados." Un cobro es:
//   · NUEVO      → el PRIMER cobro recogido de esa venta (la venta entra este mes).
//   · RECURRENTE → cualquier cobro posterior (cuotas de ventas ya cerradas: el
//                  MRR que sostiene el negocio mes a mes).
//
// UNA SOLA definición para toda la app (resumen financiero, dashboard,
// unit-economics, comisiones): si cada panel se inventara el suyo, los totales
// no cuadrarían entre pantallas y el "nuevo vs recurrente" volvería a ser
// indescifrable. Es lógica PURA: la verifica un test sin base de datos.
//
// La clasificación la decide la FECHA DE COBRO, no la de la venta: una venta
// cerrada en marzo cuyo primer cobro se recoge en abril es cash NUEVO de abril
// (el mes que realmente entra el dinero). Es el mismo criterio que ya usa el
// resumen financiero para "%New GR vs %Followup GR" — aquí se centraliza.

export type TipoCobro = 'nuevo' | 'recurrente'

export type FilaCobroParaClasificar = {
  sale_id: string
  collected_at: string | null
  /** Bruto del cobro (opcional: solo si el consumidor acumula importes). */
  gross_amount?: number | string | null
  status?: string | null
}

/** Mes YYYY-MM de una fecha (vacío si no se puede leer). */
export function ymDe(fecha: string | null | undefined): string {
  return fecha ? String(fecha).slice(0, 7) : ''
}

/**
 * Clasifica los cobros de un periodo. Recibe TODOS los cobros recogidos de las
 * ventas en juego (para saber cuál es el primero de cada venta) y el mes objetivo.
 * Devuelve qué cobros del mes son `nuevo` (primero de su venta) y cuáles
 * `recurrente` (cuotas de ventas anteriores), con sus importes brutos.
 */
export function clasificarCobrosPorMes(
  cobros: FilaCobroParaClasificar[],
  targetYm: string
): {
  nuevo: { n: number; importe: number }
  recurrente: { n: number; importe: number }
} {
  // Primer cobro RECOGIDO por venta (el "nacimiento" del cash de esa venta).
  const primeroPorVenta = new Map<string, string>()
  for (const c of cobros) {
    if (c.status && c.status !== 'collected') continue
    const ym = ymDe(c.collected_at)
    if (!ym) continue
    const previo = primeroPorVenta.get(c.sale_id)
    if (!previo || c.collected_at! < previo) {
      // comparación por string ISO: suficiente para ordenar y barata en el hot path
      primeroPorVenta.set(c.sale_id, c.collected_at!)
    }
  }

  const vacio = { n: 0, importe: 0 }
  const acc = { nuevo: { ...vacio }, recurrente: { ...vacio } }
  for (const c of cobros) {
    if (c.status && c.status !== 'collected') continue
    if (ymDe(c.collected_at) !== targetYm) continue
    const tipo: TipoCobro = primeroPorVenta.get(c.sale_id) === c.collected_at ? 'nuevo' : 'recurrente'
    acc[tipo].n += 1
    acc[tipo].importe += Number(c.gross_amount ?? 0)
  }
  return acc
}

/** Serie mensual lista para gráficos superpuestos (data-viz-pro): una fila por mes. */
export function serieNuevoVsRecurrente(
  cobros: FilaCobroParaClasificar[],
  meses: { ym: string; label: string }[]
): { ym: string; label: string; nuevo: number; recurrente: number }[] {
  return meses.map((m) => {
    const r = clasificarCobrosPorMes(cobros, m.ym)
    return { ym: m.ym, label: m.label, nuevo: r.nuevo.importe, recurrente: r.recurrente.importe }
  })
}
