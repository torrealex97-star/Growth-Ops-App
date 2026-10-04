// LIMITADOR DE PETICIONES PARA ENDPOINTS PÚBLICOS.
//
// En memoria y por instancia: en serverless cada instancia lleva su contador, así que NO es un límite
// global exacto, pero frena el abuso de un cliente contra una misma instancia (el bombardeo de correos
// de recuperación, la prueba masiva de tokens de firma). El límite real y compartido va en la capa de
// red (reglas de rate limiting de Cloudflare delante de la app: ver docs/SECURITY_HARDENING.md).

type Ventana = { empieza: number; n: number }
const ventanas = new Map<string, Ventana>()
const MAX_CLAVES = 10_000

export function limitar(
  clave: string,
  max: number,
  ventanaMs: number,
  ahora: number = Date.now()
): { ok: true } | { ok: false; reintentarEnSeg: number } {
  const v = ventanas.get(clave)
  if (!v || ahora - v.empieza >= ventanaMs) {
    if (ventanas.size >= MAX_CLAVES) {
      for (const [k, w] of ventanas) if (ahora - w.empieza >= ventanaMs) ventanas.delete(k)
      if (ventanas.size >= MAX_CLAVES) ventanas.clear()
    }
    ventanas.set(clave, { empieza: ahora, n: 1 })
    return { ok: true }
  }
  v.n++
  if (v.n > max) return { ok: false, reintentarEnSeg: Math.max(1, Math.ceil((v.empieza + ventanaMs - ahora) / 1000)) }
  return { ok: true }
}

/** IP del cliente tal y como la anuncia el proxy de la plataforma (no es confiable fuera de ella). */
export function ipDe(headers: { get(name: string): string | null }): string {
  const xff = headers.get('x-forwarded-for')
  return (xff?.split(',')[0] || headers.get('x-real-ip') || 'desconocida').trim()
}

export function reiniciarLimitador(): void {
  ventanas.clear()
}
