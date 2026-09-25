// REPARTO DE SOCIOS SOBRE BENEFICIO REAL — puro, sin red, probado sin base de datos.
//
// No es una comisión de venta (docs/MONEY.md D9): un socio con `pays_commissions = false` no
// recibe fila de `commissions`, pero puede seguir teniendo aquí su % sobre el Pre-Tax Profit del
// periodo (lib/finance/pnl.ts — Net Revenue menos COGS menos todo el OpEx, comisiones de venta
// incluidas). Las dos cosas nunca se mezclan: esto reparte lo que queda DESPUÉS de pagar comisiones,
// no sustituye a ninguna.

export type SocioActivo = {
  id: string
  name: string
  profitPercent: number
}

export type RepartoSocio = {
  id: string
  name: string
  profitPercent: number
  /** Su parte del beneficio del periodo, en €. Puede ser negativa si el periodo dio pérdidas. */
  amount: number
}

export type RepartoSocios = {
  preTaxProfit: number
  /** Suma de % de los socios activos. Nunca debería superar 100 (hay un trigger en BD que lo
   * impide al guardar), pero se informa igual: un dato mal migrado a mano no pasa por el trigger. */
  totalPercent: number
  socios: RepartoSocio[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Reparte el Pre-Tax Profit de un periodo entre los socios activos, según su % configurado.
 * No inventa un socio "resto": si los % activos no suman 100, lo que falta (o lo que sobra, si
 * alguien migró mal el dato) simplemente no aparece repartido — es información sobre la
 * configuración de `partners`, no una redistribución automática.
 */
export function calcularRepartoSocios(preTaxProfit: number, socios: SocioActivo[]): RepartoSocios {
  const totalPercent = r2(socios.reduce((a, s) => a + s.profitPercent, 0))
  return {
    preTaxProfit: r2(preTaxProfit),
    totalPercent,
    socios: socios.map((s) => ({
      id: s.id,
      name: s.name,
      profitPercent: s.profitPercent,
      amount: r2((preTaxProfit * s.profitPercent) / 100),
    })),
  }
}
