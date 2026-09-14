// Qué modelos puede elegir DE VERDAD esta cuenta, preguntándoselo al proveedor.
//
// POR QUÉ. El modelo se escribía a mano en un campo de texto, con un valor por defecto fijo en el
// código. Eso falla de dos maneras y las dos son silenciosas: si el nombre tiene una errata o el
// proveedor retira ese modelo, cada petición devuelve "model not found" y la función de IA deja de
// funcionar sin que nada en el panel lo diga; y nadie puede saber qué modelos tiene disponibles sin
// salir de la aplicación a mirarlo.
//
// Mismo patrón que "Buscar cuentas" de Meta: se pregunta al proveedor con la credencial del cliente
// y se ofrece lo que él responde. Lo que no está en esa lista, no se puede elegir.

export type ModeloIa = { id: string; propietario?: string }

const TIMEOUT_MS = 15_000

export class ModelosError extends Error {
  readonly code: 'sin_credenciales' | 'token_invalido' | 'red' | 'respuesta_inesperada'
  constructor(code: ModelosError['code'], message: string) {
    super(message)
    this.code = code
  }
}

/**
 * DeepSeek expone el endpoint de modelos con el mismo contrato que OpenAI (`GET /models` →
 * `{ data: [{ id, owned_by }] }`), así que esta función sirve para cualquier proveedor compatible:
 * solo cambia la URL base.
 */
export async function listarModelos(apiKey: string, baseUrl = 'https://api.deepseek.com'): Promise<ModeloIa[]> {
  const key = apiKey.trim()
  if (!key) throw new ModelosError('sin_credenciales', 'Pega antes la clave de API.')

  let res: Response
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    // Se distingue "no se pudo llegar" de "respondió que no": lo primero se arregla esperando, lo
    // segundo cambiando la clave. Colapsarlos manda a rotar credenciales que están bien.
    throw new ModelosError(
      'red',
      e instanceof Error && e.name === 'TimeoutError'
        ? 'La API tardó demasiado en responder.'
        : 'No se pudo conectar con la API.'
    )
  }

  if (res.status === 401 || res.status === 403) {
    throw new ModelosError('token_invalido', 'La clave de API no es válida o no tiene permiso para listar modelos.')
  }
  if (!res.ok) {
    throw new ModelosError('respuesta_inesperada', `La API respondió ${res.status} al listar los modelos.`)
  }

  const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: unknown; owned_by?: unknown }> } | null
  const filas = Array.isArray(json?.data) ? json!.data! : []
  const modelos = filas
    .map((m) => ({
      id: typeof m.id === 'string' ? m.id.trim() : '',
      propietario: typeof m.owned_by === 'string' ? m.owned_by : undefined,
    }))
    .filter((m) => m.id.length > 0)
    // Orden estable por nombre: la respuesta del proveedor no garantiza ninguno, y una lista que
    // cambia de orden en cada carga es imposible de usar.
    .sort((a, b) => a.id.localeCompare(b.id))

  if (modelos.length === 0) {
    throw new ModelosError('respuesta_inesperada', 'La API respondió, pero no devolvió ningún modelo.')
  }
  return modelos
}

/**
 * Elige el modelo a usar cuando el cliente no ha fijado ninguno.
 *
 * NO devuelve una constante escrita en el código: parte de lo que el proveedor dice tener. Si el
 * modelo guardado ya no está en la lista, se avisa en vez de seguir llamando a un nombre muerto.
 */
export function resolverModelo(
  guardado: string | undefined | null,
  disponibles: ModeloIa[],
  preferidos: readonly string[] = []
): { modelo: string | null; aviso?: string } {
  const ids = disponibles.map((m) => m.id)
  const elegido = (guardado ?? '').trim()

  if (elegido) {
    if (ids.includes(elegido)) return { modelo: elegido }
    return {
      modelo: null,
      aviso: `El modelo guardado ("${elegido}") ya no está disponible en tu cuenta. Elige uno de la lista: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? '…' : ''}`,
    }
  }
  // Sin elección: el primer preferido que exista de verdad; si ninguno, el primero que ofrezca la API.
  const preferido = preferidos.find((p) => ids.includes(p))
  return { modelo: preferido ?? ids[0] ?? null }
}
