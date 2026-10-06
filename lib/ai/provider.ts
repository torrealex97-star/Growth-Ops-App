// Qué motor de IA atiende cada petición de texto de la aplicación.
//
// POR QUÉ EXISTE. Las funciones de IA llamaban a Anthropic directamente, así que DeepSeek se podía
// conectar en Integraciones, daba verde… y no movía un solo dato: una integración que solo existe en
// la pantalla. Aquí se decide el motor en UN sitio, y todas las funciones de texto pasan por él.
//
// LA REGLA (cadena de relevo). El motor preferido de la subcuenta atiende; si falla (o no está
// conectado), el siguiente conectado toma el relevo: DeepSeek → Anthropic → Groq. Con UN solo motor
// conectado, ese atiende todo; con ninguno, se dice qué conectar. Conectar DeepSeek sigue siendo una
// decisión explícita del cliente: su prioridad no cambia por esto. Cada relevo queda anotado en
// `fallbackReason` — un cambio silencioso de motor es una avería invisible.
//
// LO QUE NO PASA POR AQUÍ, y no es un olvido: `extractInvoice` (facturas) tiene su PROPIA cadena de
// capacidades en lib/ai/claude.ts, porque necesita VISIÓN para imágenes. Ahí el orden es Anthropic
// (visión nativa, imagen y PDF) → Groq (visión, imagen) → texto puro (solo PDF, extrayendo el texto
// del documento, lib/ai/pdf.ts). Lo que NUNCA pasa es mandarle una imagen a un modelo de texto: la
// respondería inventada sobre un archivo que no ha visto.
//
// El agente conversacional usa el selector de lib/ai/agent/gateway.ts: DeepSeek por su endpoint
// compatible con Anthropic o Anthropic directo (Groq no ofrece endpoint Anthropic-compatible, y el
// bucle de tool-use con la frontera de autorización vive en ese protocolo).
import Anthropic from '@anthropic-ai/sdk'
import { getTenantConfigWithFallback } from '@/lib/config'
import { groqTexto } from '@/lib/ai/groq'

export type AiEngine = 'deepseek' | 'anthropic' | 'groq'

export type TextRequest = {
  system: string
  user: string
  maxTokens: number
  /** true = tarea de razonamiento (análisis, guiones). false = extracción simple y barata. */
  smart?: boolean
}

export type AiMessage = { role: 'user' | 'assistant'; content: string }
export type ConversationRequest = {
  system: string
  messages: AiMessage[]
  maxTokens: number
  temperature?: number
  /** Modelo Anthropic elegido por una pantalla legacy. DeepSeek usa el modelo de la subcuenta. */
  anthropicModel?: string
  smart?: boolean
}

export type TextResult = {
  text: string
  /** Motor que DE VERDAD respondió. Si el preferido falló y contestó otro, aquí pone quién. */
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
export const DEEPSEEK_MODELOS_PREFERIDOS = ['deepseek-flash', 'deepseek-v4-pro'] as const

/** Último recurso si no se pudo consultar la lista de modelos. */
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-flash'

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

export type AiEnv = Record<string, string | undefined>

/** Motor elegido para la instantánea de configuración recibida (preferencia de texto de la subcuenta). */
export function selectEngine(env: AiEnv = process.env): AiEngine {
  return env.DEEPSEEK_API_KEY?.trim() ? 'deepseek' : 'anthropic'
}

/** Orden de relevo para tareas de texto, con la preferencia de la subcuenta primero. */
const ORDEN_RELEVO: AiEngine[] = ['deepseek', 'anthropic', 'groq']

function claveDe(motor: AiEngine, env: AiEnv): string | undefined {
  const k =
    motor === 'deepseek' ? env.DEEPSEEK_API_KEY : motor === 'anthropic' ? env.ANTHROPIC_API_KEY : env.GROQ_API_KEY
  return k?.trim() ? k : undefined
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
export async function tenantAiEnv(tenantId: string): Promise<AiEnv> {
  return getTenantConfigWithFallback(tenantId)
}

export function deepseekModel(env: AiEnv = process.env): string {
  return env.DEEPSEEK_MODEL?.trim() || DEEPSEEK_DEFAULT_MODEL
}

/**
 * Una petición de texto, con el motor que toque. Devuelve SIEMPRE qué motor respondió: si el
 * preferido falla y contesta otro, el que llama puede decirlo en vez de presentar el resultado como
 * si lo hubiera producido el motor configurado.
 */
export async function completeText(req: TextRequest, env: AiEnv = process.env): Promise<TextResult> {
  return completeConversation(
    {
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      maxTokens: req.maxTokens,
      smart: req.smart,
    },
    env
  )
}

/**
 * Conversación de texto multi-turno para Setting AI y el resto de pantallas que conservan historial.
 * Centralizarla aquí evita que esas rutas vuelvan a leer una clave global de Vercel y se salten la
 * configuración cifrada de la subcuenta.
 */
export async function completeConversation(req: ConversationRequest, env: AiEnv = process.env): Promise<TextResult> {
  const motores = ORDEN_RELEVO.filter((m) => claveDe(m, env))
  if (motores.length === 0) {
    throw new Error('Configura una clave de DeepSeek, Anthropic o Groq para esta subcuenta (Ajustes › Integraciones)')
  }
  const motivos: string[] = []
  let ultimoError: unknown
  for (const motor of motores) {
    try {
      const result =
        motor === 'deepseek'
          ? await deepseekConversation(req, env)
          : motor === 'anthropic'
            ? await anthropicConversation(req, env)
            : await groqConversation(req, env)
      // El relevo se declara, nunca se disimula: quién leyó esto debe saber que NO respondió el
      // motor configurado de la subcuenta.
      return motivos.length > 0 ? { ...result, fallbackReason: motivos.join('; ') } : result
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      motivos.push(`${motor}: ${reason}`)
      ultimoError = e
      console.warn(`[ai] ${motor} falló (${reason}); probando el siguiente motor conectado.`)
    }
  }
  // Sin ningún motor de repuesto que sirva se propaga el ÚLTIMO error real, no un texto vacío que
  // el llamante interpretaría como "la IA no encontró nada".
  throw ultimoError
}

async function deepseekConversation(req: ConversationRequest, env: AiEnv): Promise<TextResult> {
  if (!env.DEEPSEEK_API_KEY?.trim()) throw new Error('DeepSeek no está configurado para esta subcuenta')
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
      temperature: req.temperature,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
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

async function anthropicConversation(req: ConversationRequest, env: AiEnv): Promise<TextResult> {
  if (!env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error('Anthropic no está configurado para esta subcuenta')
  }
  const model = req.anthropicModel || (req.smart ? ANTHROPIC_SMART : ANTHROPIC_FAST)
  // maxRetries alto porque Anthropic devuelve 529 (overloaded) en picos y el default del SDK (2) no
  // siempre aguanta hasta que se libera capacidad.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 45_000 })
  const msg = await client.messages.create({
    model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages,
    temperature: req.temperature,
  })
  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
  return { text, engine: 'anthropic', model }
}

async function groqConversation(req: ConversationRequest, env: AiEnv): Promise<TextResult> {
  const apiKey = claveDe('groq', env)
  if (!apiKey) throw new Error('Groq no está configurado para esta subcuenta')
  const { text, model } = await groqTexto({
    system: req.system,
    messages: req.messages,
    maxTokens: req.maxTokens,
    temperature: req.temperature,
    smart: req.smart,
    apiKey,
  })
  return { text, engine: 'groq', model }
}
