// La lista de cuentas publicitarias seleccionadas, en un solo sitio.
//
// POR QUÉ ESTÁ APARTE DE `lib/meta/client.ts`: ese módulo importa `node:crypto` para firmar las
// llamadas, así que no se puede importar desde un componente de navegador. El resultado era que la
// pantalla de Integraciones tenía su propia idea de "¿está esta cuenta seleccionada?" —comparando
// con `.includes()` sobre el texto crudo— mientras el servidor usaba `parseAccountIds`. Dos
// definiciones de lo mismo discrepando es exactamente lo que pide el brief que no pase: la
// selección que se ve en la pantalla tiene que ser la selección que sincroniza el cron.
//
// `.includes()` sobre el texto crudo, además, era un bug real: con "act_12" guardado, la cuenta
// "act_123" también salía marcada (una cadena contiene a la otra), y con "act_123,act_456"
// guardado, marcaba ambas aunque el <input type="radio"> solo permitía elegir una.

/** Acepta "act_123" o "123" → "act_123". */
export function normalizeAccountId(raw: string): string {
  const id = raw.trim()
  return id.startsWith('act_') ? id : `act_${id}`
}

/**
 * Parte la config de cuentas en una lista. Admite varias separadas por comas, saltos de línea,
 * espacios o punto y coma. Todas comparten el MISMO token.
 * Lista vacía = "todas las cuentas accesibles por el token" (ver `resolveMetaConfigs`).
 */
export function parseAccountIds(raw: string | undefined | null): string[] {
  if (!raw) return []
  const vistas = new Set<string>()
  for (const trozo of raw.split(/[\s,;]+/)) {
    const id = trozo.trim()
    if (id) vistas.add(normalizeAccountId(id))
  }
  return Array.from(vistas)
}

/** Serializa una selección para guardarla. Vacío = todas las accesibles. */
export function serializeAccountIds(ids: readonly string[]): string {
  return parseAccountIds(ids.join(',')).join(',')
}

/** ¿Está esta cuenta en la selección guardada? Comparación por id, nunca por substring. */
export function isAccountSelected(raw: string | undefined | null, accountId: string): boolean {
  return parseAccountIds(raw).includes(normalizeAccountId(accountId))
}

/** Añade o quita una cuenta de la selección guardada y devuelve el texto a guardar. */
export function toggleAccountId(raw: string | undefined | null, accountId: string): string {
  const id = normalizeAccountId(accountId)
  const actuales = parseAccountIds(raw)
  const siguientes = actuales.includes(id) ? actuales.filter((a) => a !== id) : [...actuales, id]
  return serializeAccountIds(siguientes)
}
