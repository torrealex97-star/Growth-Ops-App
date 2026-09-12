/** Compara importes monetarios redondeando a céntimos antes de aplicar la tolerancia. */
export const amountsDiffer = (left: number, right: number, tolerance = 0.05) =>
  Math.round(Math.abs(left - right) * 100) > Math.round(tolerance * 100)
