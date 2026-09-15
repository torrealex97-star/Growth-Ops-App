// Qué motor de IA atiende cada petición de texto de la aplicación.
//
// POR QUÉ EXISTE. Las funciones de IA llamaban a Anthropic directamente, así que DeepSeek se podía
// conectar en Integraciones, daba verde… y no movía un solo dato: una integración que solo existe en
// la pantalla. Aquí se decide el motor en UN sitio, y todas las funciones de texto pasan por él.
//
// LA REGLA. Si la subcuenta tiene DEEPSEEK_API_KEY configurada, DeepSeek es su motor. Si no, sigue
// Anthropic exactamente como hasta ahora: conectar DeepSeek es una decisión explícita del cliente,
// no algo que se active solo.
//
// LO QUE NO PASA POR AQUÍ, y no es un olvido:
//   · `extractInvoice` lee imágenes y PDFs. Los modelos de texto de DeepSeek no ven documentos:
//     mandarles una factura devolvería una respuesta inventada sobre un archivo que no han leído.
//   · El agente conversacional (lib/ai/agent) usa el protocolo de herramientas de Anthropic, que no
//     es el mismo. Portarlo es otro trabajo, no un cambio de constante.
import Anthropic from '@anthropic-ai/sdk'
import { getTenantConfigWithFallback } from '@/lib/config'

export type AiEngine = 'deepseek' | 'anthropic'

export type TextRequest = {
  system: string
  user: string
  maxTokens: number
  /** true = tarea de razonamiento (análisis, guiones). false = extracción simple y barata. */
  smart?: boolean
}

export type TextResult = {
  text: string
  /** Motor que DE VERDAD respondió. Si DeepSeek falló y contestó Anthropic, aquí pone 'anthropic'. */
  engine: AiEngine
  model: string
  /** Por qué se cambió de motor, cuando se cambió. Un cambio silencioso es una avería invisible. */
  fallbackReason?: string
}

const ANTHROPIC_FAST = 'claude-haiku-4-5-20251001'
const ANTHROPIC_SMART = 'claude-sonnet-5'

/**
 * Orden de preferencia cuando el cliente no ha elegido modelo. NO es una lista de modelos que
 * existan seguro: se cruza con lo que la API dice tener (ver `resolverModelo`), y si ninguno está,
 * se usa el primero que el proveedor ofrezca. Escribir aquí un nombre fijo y llamarlo sin comprobar
 * es lo que dejaba la IA muerta cuando el proveedor retiraba ese modelo.
 */
export const DEEPSEEK_MODELOS_PREFERIDOS = ['deepseek-chat', 'deepseek-reasoner'] as const

/** Último recurso si no se pudo consultar la lista de modelos. */
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat'

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

type Env = Record<string, string | undefined>

/**
 * Motor elegido para esta subcuenta. La configuración llega por `process.env` porque `ensureConfig`
 * vuelca ahí los ajustes del tenant antes de cada petición de integración: no hay estado global
 * compartido entre subcuentas más allá de esa llamada.
 */
export function selectEngine(env: Env = process.env): AiEngine {
  return env.DEEPSEEK_API_KEY?.trim() ? 'deepseek' : 'anthropic'
}

/**
 * Configuración de IA de UNA subcuenta, como instantánea de la petición.
 *
 * Es lo que hace que conectar DeepSeek en Integraciones sirva de algo: las rutas de IA leían
 * `process.env` directamente y nunca cargaban la configuración del tenant, así que una clave guardada
 * en la pantalla no la usaba nadie — solo funcionaba la variable global de Vercel.
 *
 * Se devuelve una instantánea en vez de volcarla a `process.env` (que es global al proceso y lo
 * comparten peticiones concurrentes de subcuentas distintas): así la clave de un cliente no puede
 * atender la petición de otro.
 */
export async function tenantAiEnv(tenantId: string): Promise<Env> {
  return getTenantConfigWithFallback(tenantId)
}

export function deepseekModel(env: Env = process.env): string {
  return env.DEEPSEEK_MODEL?.trim() || DEEPSEEK_DEFAULT_MODEL
}

/**
 * Una petición de texto, con el motor que toque. Devuelve SIEMPRE qué motor respondió: si DeepSeek
 * falla y contesta Anthropic, el que llama puede decirlo en vez de presentar el resultado como si lo
 * hubiera producido el motor configurado.
 */
export async function completeText(req: TextRequest, env: Env = process.env): Promise<TextResult> {
  const engine = selectEngine(env)
  if (engine === 'deepseek') {
    try {
      return await deepseekText(req, env)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      // Sin Anthropic de repuesto no hay nada que hacer: se propaga el error real de DeepSeek en vez
      // de devolver un texto vacío que el llamante interpretaría como "la IA no encontró nada".
      if (!env.ANTHROPIC_API_KEY?.trim()) throw e
      console.warn(`[ai] DeepSeek falló (${reason}); respondiendo con Anthropic.`)
      const result = await anthropicText(req, env)
      return { ...result, fallbackReason: reason }
    }
  }
  return anthropicText(req, env)
}

async function deepseekText(req: TextRequest, env: Env): Promise<TextResult> {
  const model = deepseekModel(env)
  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  })
  const body = (await response.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[]
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new Error(body.error?.message || `DeepSeek respondió ${response.status}`)
  }
  const text = body.choices?.[0]?.message?.content ?? ''
  // Una respuesta vacía NO es un resultado: quien llama espera JSON y parsearía "" como un fallo
  // confuso. Se trata como error para que el repuesto pueda entrar.
  if (!text.trim()) throw new Error('DeepSeek devolvió una respuesta vacía')
  return { text, engine: 'deepseek', model }
}

async function anthropicText(req: TextRequest, env: Env): Promise<TextResult> {
  const model = req.smart ? ANTHROPIC_SMART : ANTHROPIC_FAST
  // maxRetries alto porque Anthropic devuelve 529 (overloaded) en picos y el default del SDK (2) no
  // siempre aguanta hasta que se libera capacidad.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 45_000 })
  const msg = await client.messages.create({
    model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
  })
  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
  return { text, engine: 'anthropic', model }
}
