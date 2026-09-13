// Tarifas de la API de Anthropic en USD por millón de tokens, para poder estimar lo que cuesta
// cada conversación del agente. Se guardan aquí (y no repartidas por el código) porque son un dato
// externo que cambia con el tiempo: si Anthropic ajusta precios, se toca solo este fichero.
// Última verificación: 2026-09 (docs oficiales de precios).
type Rate = { input: number; output: number }

const RATES: Record<string, Rate> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

// Los ids con sufijo de fecha (claude-haiku-4-5-20251001) comparten tarifa con su familia, así que
// se resuelven por prefijo en vez de obligar a listar cada snapshot.
function rateFor(model: string): Rate | null {
  if (RATES[model]) return RATES[model]
  const key = Object.keys(RATES).find((k) => model.startsWith(k))
  return key ? RATES[key] : null
}

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

// Devuelve null cuando el modelo no está tarifado, en vez de inventar un coste: un 0 falso en un
// dashboard de costes es peor que un "no lo sé".
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const rate = rateFor(model)
  if (!rate) return null
  const perMillion = (tokens: number, price: number) => (tokens / 1_000_000) * price
  // Lectura de caché ~0,1x y escritura ~1,25x sobre la tarifa de input.
  return (
    perMillion(usage.inputTokens, rate.input) +
    perMillion(usage.outputTokens, rate.output) +
    perMillion(usage.cacheReadTokens ?? 0, rate.input * 0.1) +
    perMillion(usage.cacheWriteTokens ?? 0, rate.input * 1.25)
  )
}
