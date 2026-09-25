// LTGP:CAC APROXIMADO POR PERIODO. No es el LTGP:CAC canónico.
//
// La skill sales-engineering (§7 Métrología) declara: LTGP = LTV - Costes Totales de Entrega. El LTV
// de verdad es la facturación de UN cliente en TODA su vida, y calcularlo pide una agregación
// histórica de `sales` por contacto que esta capa todavía no tiene (`sales` no está enlazado por
// contacto en el motor de métricas). Lo que sí se puede calcular con lo que hay HOY es una
// aproximación por periodo: ticket medio del periodo menos coste de entrega del periodo, dividido por
// el CAC del mismo periodo. Es real y honesto, pero NO es lifetime — por eso vive en su propio campo
// (`ltgpCacAproximado`) y nunca sustituye al `ltgp_cac` del registro canónico, que sigue en hueco.
//
// EL COSTE DE ENTREGA tiene dos fuentes, en este orden:
//   1. Gastos categorizados como `cogs` en el periodo (dato real, de facturas). Se prefiere siempre
//      que exista, porque una factura real pesa más que una estimación tecleada.
//   2. `growth_context.avg_delivery_cost_eur`, el número manual que alguien declaró — FALLBACK, para
//      cuando todavía no se ha categorizado ningún gasto como `cogs`.
// Sin ninguna de las dos, no hay coste de entrega, y por tanto no hay LTGP que calcular: se declara el
// hueco con el motivo exacto, nunca se asume coste cero (eso inflaría el margen de la nada).

export type FuenteCosteEntrega = 'cogs' | 'manual'

export type LtgpCacAproximado = {
  /** `null` = no se pudo calcular. Nunca es una aproximación silenciosa a 0. */
  valor: number | null
  fuenteCoste: FuenteCosteEntrega | null
  costePorCliente: number | null
  motivo?: string
}

export type EntradaLtgpAproximado = {
  /** Ticket medio del periodo (m.aov.valor). */
  aov: number | null
  /** CAC del periodo (m.cac.valor). */
  cac: number | null
  /** Suma de gastos con category='cogs' en el periodo. */
  costeEntregaCogsPeriodo: number | null
  /** Clientes (ventas) del periodo, para repartir el coste de cogs entre ellos. */
  clientesPeriodo: number | null
  /** growth_context.avg_delivery_cost_eur, el fallback manual. */
  costeManualEur: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function calcularLtgpCacAproximado(e: EntradaLtgpAproximado): LtgpCacAproximado {
  let costePorCliente: number | null = null
  let fuenteCoste: FuenteCosteEntrega | null = null

  if (e.costeEntregaCogsPeriodo !== null && e.costeEntregaCogsPeriodo > 0 && (e.clientesPeriodo ?? 0) > 0) {
    costePorCliente = r2(e.costeEntregaCogsPeriodo / (e.clientesPeriodo as number))
    fuenteCoste = 'cogs'
  } else if (e.costeManualEur !== null) {
    costePorCliente = e.costeManualEur
    fuenteCoste = 'manual'
  }

  if (costePorCliente === null) {
    return {
      valor: null,
      fuenteCoste: null,
      costePorCliente: null,
      motivo:
        'Sin coste de entrega: categoriza gastos como COGS en Finanzas › Gastos, o rellena el coste medio manual en Configuración.',
    }
  }
  if (e.aov === null) {
    return {
      valor: null,
      fuenteCoste,
      costePorCliente,
      motivo: 'Sin ticket medio del periodo (no hay ventas): no hay facturación con la que calcular el margen.',
    }
  }
  if (e.cac === null || e.cac <= 0) {
    return {
      valor: null,
      fuenteCoste,
      costePorCliente,
      motivo: 'Sin CAC del periodo (sin gasto en anuncios o sin ventas): no se puede dividir el margen por el CAC.',
    }
  }

  const ltgp = e.aov - costePorCliente
  return {
    valor: r2(ltgp / e.cac),
    fuenteCoste,
    costePorCliente,
  }
}
