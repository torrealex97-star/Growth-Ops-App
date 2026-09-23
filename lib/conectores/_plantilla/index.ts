import type { Conector, ConnectorManifest, Cursor, EventoNormalizado, ResultadoSync } from '../contrato'

// F2 — PLANTILLA DE CONECTOR.
//
// Esto es lo que se copia para añadir un proveedor. No es un ejemplo de juguete: resuelve de verdad
// las cuatro cosas que cada integración de este repo volvió a resolver a su manera —paginación con
// cursor, presupuesto de tiempo, límite de peticiones y salud— y por eso hay cuatro formas distintas
// de hacerlo en producción hoy.
//
// CÓMO SE USA:
//   1. Copia esta carpeta a `lib/conectores/<proveedor>/`.
//   2. Ajusta el manifiesto: lo que el proveedor SOPORTA, no lo que te gustaría.
//   3. Borra los métodos que ese proveedor no tenga y quita su capacidad del manifiesto. La suite
//      de contrato falla si declaras algo que no implementas — y también al revés.
//   4. Guarda un fixture real SANITIZADO en `fixtures/` y prueba `normalize` contra él.
//
// LO QUE NO HAY QUE CAMBIAR: que `normalize` sea puro, que el cursor viaje en el resultado y que un
// fallo parcial se cuente como incidencia en vez de romper la pasada entera.

export const manifest: ConnectorManifest = {
  provider: 'plantilla',
  version: '1.0',
  label: 'Plantilla de conector',
  authMode: 'api_key',
  requiredKeys: ['PLANTILLA_API_KEY'],
  supportedObjects: ['contacts'],
  syncModes: ['incremental', 'backfill'],
  capabilities: {
    incrementalSync: true,
    backfill: true,
    healthCheck: true,
    // Declarar de menos es correcto; declarar de más, no. Un `discover: true` sin método deja la
    // pantalla ofreciendo un botón que no hace nada.
  },
  // El número real del proveedor, no uno prudente inventado: con él, el backoff de abajo sabe
  // cuánto esperar en vez de dormir "un rato".
  rateLimitPorMinuto: 120,
}

/** Página del proveedor: filas + por dónde seguir. La forma se repite en todas las APIs paginadas. */
type Pagina = { filas: unknown[]; siguiente: string | null }

/**
 * Una petición con reintento ante límite de uso.
 *
 * El 429 es lo normal en una sincronización larga, no una excepción rara: el proveedor dice
 * "espera". Reintentar en el acto lo empeora; rendirse pierde la pasada entera. Se espera lo que el
 * proveedor indica (`Retry-After`) y, si no lo dice, se sube el tiempo entre intentos.
 */
async function pedirConBackoff(url: string, apiKey: string, intentos = 3): Promise<Response> {
  let espera = 1000
  for (let i = 0; i < intentos; i++) {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (r.status !== 429) return r
    const indicado = Number(r.headers.get('retry-after'))
    await new Promise((resolve) => setTimeout(resolve, Number.isFinite(indicado) ? indicado * 1000 : espera))
    espera *= 2
  }
  // Tras agotar los intentos se devuelve la última respuesta: quien llama la cuenta como incidencia
  // y conserva el cursor, en vez de perder lo ya traído.
  return fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) })
}

async function traerPagina(apiKey: string, cursor: Cursor): Promise<Pagina> {
  const url = new URL('https://api.ejemplo.test/v1/contacts')
  url.searchParams.set('limit', '100')
  if (cursor?.valor) url.searchParams.set('after', cursor.valor)
  const r = await pedirConBackoff(url.toString(), apiKey)
  if (!r.ok) throw new Error(`el proveedor respondió ${r.status}`)
  const j = (await r.json()) as { data?: unknown[]; next_cursor?: string | null }
  return { filas: j.data ?? [], siguiente: j.next_cursor ?? null }
}

/**
 * PURO: mismo payload, mismo resultado. Sin red, sin base, sin reloj.
 *
 * Es lo que permite probar el trato con el proveedor desde un fixture guardado, sin credenciales.
 * Devuelve `null` cuando no entiende el payload — nunca un objeto a medias con huecos inventados.
 */
export function normalize(crudo: unknown): EventoNormalizado | null {
  const o = crudo && typeof crudo === 'object' ? (crudo as Record<string, unknown>) : null
  const id = typeof o?.id === 'string' ? o.id : null
  if (!id) return null
  const actualizado = typeof o?.updated_at === 'string' ? o.updated_at : null
  return {
    sourceEventId: id,
    tipo: 'plantilla.contacto.actualizado',
    // La fecha del HECHO, no la de recepción: si no, un reintento movería el dato de día.
    ocurridoEn: actualizado ?? new Date(0).toISOString(),
    // Sin datos personales: el sobre completo ya vive en `raw_events` con su control de acceso.
    propiedades: { estado: o?.status ?? null },
  }
}

export const conector: Conector = {
  manifest,
  normalize,

  async healthCheck(ctx) {
    const apiKey = ctx.cfg.PLANTILLA_API_KEY
    // Falta de credencial NO es una avería: es configuración pendiente, y el panel debe distinguirlo.
    if (!apiKey) return { ok: false, mensaje: 'Falta la API key en Integraciones.', codigo: 'sin_credenciales' }
    try {
      const r = await pedirConBackoff('https://api.ejemplo.test/v1/me', apiKey, 1)
      return r.ok
        ? { ok: true, mensaje: 'Conectado.' }
        : {
            ok: false,
            mensaje: `El proveedor respondió ${r.status}.`,
            codigo: r.status === 401 ? 'token_invalido' : 'error',
          }
    } catch {
      return { ok: false, mensaje: 'No se pudo contactar con el proveedor.', codigo: 'sin_respuesta' }
    }
  },

  async incrementalSync(ctx, cursor): Promise<ResultadoSync> {
    const apiKey = ctx.cfg.PLANTILLA_API_KEY
    if (!apiKey) return { escritos: 0, truncado: false, cursor, incidencias: ['falta la API key'] }

    const incidencias: string[] = []
    let escritos = 0
    let actual: Cursor = cursor
    let truncado = false

    // El bucle para por TRES motivos, y los tres son legítimos: se acabaron los datos, se acabó el
    // tiempo, o el proveedor falló. Sin el presupuesto, la función muere a los 60 s y el cursor se
    // pierde: la siguiente pasada empieza de cero y nunca se termina un histórico grande.
    while (true) {
      if (ctx.deadline && Date.now() > ctx.deadline) {
        truncado = true
        break
      }
      let pagina: Pagina
      try {
        pagina = await traerPagina(apiKey, actual)
      } catch (e) {
        incidencias.push(e instanceof Error ? e.message : String(e))
        truncado = true
        break
      }

      // Aquí iría la escritura en la tabla del dominio, idempotente por su clave natural
      // (`upsert` con `onConflict: 'tenant_id,external_id'`): reejecutar no puede duplicar.
      escritos += pagina.filas.length

      if (!pagina.siguiente) break
      actual = { valor: pagina.siguiente }
    }

    return { escritos, truncado, cursor: truncado ? actual : null, incidencias }
  },

  async backfill(ctx, rango) {
    // El histórico es la misma paginación con otro punto de partida: no se duplica la lógica, se
    // reusa. Un backfill escrito aparte se desincroniza del incremental a la primera.
    void rango
    return this.incrementalSync!(ctx, null)
  },
}
