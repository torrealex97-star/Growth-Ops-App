// Groq: transcripción de audio Y chat (texto y visión) — implementación ÚNICA.
//
// POR QUÉ EXISTE. Esta misma función estaba copiada tres veces (borradores de reels, análisis de
// llamadas y transcripción de reels propios) con tres variantes distintas: una con timeout y dos
// sin él, y dos listas de extensiones diferentes. Tres copias de una operación es tres sitios donde
// arreglar el mismo bug y dos que se olvidan.
//
// Las funciones de chat existen para el RELEVO de motores (lib/ai/provider.ts): si la subcuenta
// solo tiene Groq conectada, sus tareas de texto también se atienden, y la lectura de facturas en
// imagen usa los modelos con visión cuando Anthropic no está. La clave llega como argumento (la de
// la subcuenta): leerla de `process.env` significaba que la GROQ_API_KEY guardada en Configuración ›
// Integraciones no se usaba nunca, y que el gasto de una subcuenta podía cargarse a la cuenta de otra.

/** 25 MB: tope del tier gratuito de Groq. */
export const GROQ_LIMIT_BYTES = 25 * 1024 * 1024

const TRANSCRIBE_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions'
const CHAT_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const WHISPER_MODEL = 'whisper-large-v3-turbo'

/**
 * Modelos con visión, en orden de preferencia. La lista de modelos de Groq rota (los llama-4 de
 * visión dieron paso a los qwen multimodales): si el primero ya no existe, la API lo dice y se
 * prueba el siguiente — nunca se queda la lectura de facturas muerta por un ID retirado.
 */
export const GROQ_VISION_MODELOS = [
  'qwen/qwen3.8-27b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
] as const

/** Tarea estratégica (análisis, guiones): el modelo más potente disponible. */
const TEXTO_SMART_PREFERIDOS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']
/** Tarea sencilla (extracción barata): el modelo rápido. */
const TEXTO_FAST_PREFERIDOS = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']

function extensionFor(mime: string): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('mp4') || m.includes('video')) return 'mp4'
  if (m.includes('wav')) return 'wav'
  if (m.includes('m4a')) return 'm4a'
  return 'mp3'
}

export async function transcribeAudio(
  buf: Buffer,
  mime: string,
  apiKey: string | undefined,
  opts: { filename?: string; language?: string; timeoutMs?: number } = {}
): Promise<string> {
  const key = apiKey?.trim()
  if (!key) throw new Error('Falta la API Key de Groq en Configuración › Integraciones')
  if (buf.byteLength > GROQ_LIMIT_BYTES) {
    throw new Error(`El archivo pesa ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB y supera el límite de 25MB`)
  }
  const form = new FormData()
  const base = opts.filename || 'audio'
  form.append('file', new Blob([new Uint8Array(buf)], { type: mime || 'video/mp4' }), `${base}.${extensionFor(mime)}`)
  form.append('model', WHISPER_MODEL)
  form.append('language', opts.language || 'es')
  form.append('response_format', 'json')
  // Timeout generoso (transcribir tarda) pero acotado: sin él, un Groq colgado se come la ventana
  // entera de la función y no se genera nada.
  const res = await fetch(TRANSCRIBE_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
  })
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { text?: string }
  return data.text || ''
}

// ── Chat (texto y visión) ────────────────────────────────────────────────────

/** Groq replica el contrato de errores de OpenAI: un modelo retirado se detecta y se prueba el siguiente. */
function esModeloNoDisponible(status: number, mensaje: string): boolean {
  return (
    (status === 400 || status === 404) && /model_?not_?found|does not exist|decommissioned|no longer/i.test(mensaje)
  )
}

type ChatMessageGroq = {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
}

async function groqChat(
  model: string,
  messages: ChatMessageGroq[],
  apiKey: string,
  maxTokens: number,
  opts: { temperature?: number; json?: boolean } = {}
): Promise<string> {
  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: maxTokens,
      temperature: opts.temperature,
      // JSON mode donde el que llama espera un objeto JSON: fuerza el contrato en el propio
      // proveedor en vez de confiar en que el modelo lo respete por el prompt.
      response_format: opts.json ? { type: 'json_object' } : undefined,
    }),
    signal: AbortSignal.timeout(45_000),
  })
  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[]
    error?: { code?: string; message?: string }
  }
  if (!res.ok) {
    // 401/403 con la clave guardada: el remedio es repegar la clave, no revisar el código. El hallazgo
    // en producción (6-oct) fue exactamente este caso: clave Groq guardada el 28-sep revocada — sin
    // este mensaje, la pantalla enseñaba un "Invalid API Key" crudo del proveedor.
    if (res.status === 401 || res.status === 403) throw new Error(CLAVE_GROQ_INVALIDA)
    const mensaje = body.error?.message || `Groq respondió ${res.status}`
    const err = new Error(mensaje) as Error & { modeloNoDisponible?: boolean }
    if (esModeloNoDisponible(res.status, `${body.error?.code ?? ''} ${mensaje}`)) err.modeloNoDisponible = true
    throw err
  }
  const text = body.choices?.[0]?.message?.content ?? ''
  // Una respuesta vacía NO es un resultado: quien llama espera contenido y parsearía "" como un
  // fallo confuso.
  if (!text.trim()) throw new Error('Groq devolvió una respuesta vacía')
  return text
}

export type GroqTextoParams = {
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  maxTokens: number
  temperature?: number
  /** true = tarea estratégica → modelo grande. false = extracción sencilla → modelo rápido. */
  smart?: boolean
  apiKey: string
}

/**
 * Mensaje para la clave Groq rechazada por el proveedor. Un remedio concreto (regenerar y repegar)
 * en vez del error crudo de la API: la clave está guardada en la pantalla, el fallo no se arregla
 * mirando el código.
 */
const CLAVE_GROQ_INVALIDA =
  'La clave de Groq de esta subcuenta no es válida (la API la rechazó). Regenera la clave en console.groq.com y pégala de nuevo en Ajustes › Integraciones.'

/**
 * Texto por Groq con el modelo que DE VERDAD existe: se pregunta al proveedor (mismo patrón que el
 * resto de la app, lib/ai/modelos.ts) en vez de llamar a un ID fijo que el proveedor puede retirar.
 * Solo se consulta la lista cuando Groq es quien atiende la petición, así que no añade latencia al
 * camino normal.
 */
export async function groqTexto(p: GroqTextoParams): Promise<{ text: string; model: string }> {
  const { listarModelos, resolverModelo, ModelosError } = await import('@/lib/ai/modelos')
  const preferidos = p.smart ? TEXTO_SMART_PREFERIDOS : TEXTO_FAST_PREFERIDOS
  let model: string | null
  try {
    const modelos = await listarModelos(p.apiKey, 'https://api.groq.com/openai/v1')
    model = resolverModelo(undefined, modelos, preferidos).modelo
  } catch (e) {
    // Si la lista no se pudo consultar por red lenta o rate limit, se intenta igualmente el
    // preferido: un fallo del catálogo no debe tumbar una tarea que el proveedor sí puede servir.
    // Una clave que el proveedor RECHAZA, en cambio, también fallará el chat: se dice ya y con el
    // remedio concreto en vez de gastar la segunda llamada.
    if (e instanceof ModelosError && (e.code === 'token_invalido' || e.code === 'sin_credenciales')) {
      throw new Error(CLAVE_GROQ_INVALIDA)
    }
    model = preferidos[0]
  }
  if (!model) throw new Error('Groq no devolvió ningún modelo de texto disponible')
  const text = await groqChat(model, [{ role: 'system', content: p.system }, ...p.messages], p.apiKey, p.maxTokens, {
    temperature: p.temperature,
  })
  return { text, model }
}

export type GroqVisionParams = {
  system: string
  user: string
  /** Imagen en base64 SIN el prefijo data: — se construye aquí. */
  base64: string
  mediaType: string
  maxTokens: number
  apiKey: string
}

/**
 * Visión por Groq: prueba los modelos multimodales en orden y avanza cuando el proveedor dice que
 * uno ya no existe. Devuelve el texto tal cual (el que llama parsea el JSON que su prompt pide).
 */
export async function groqVision(p: GroqVisionParams): Promise<{ text: string; model: string }> {
  const messages: ChatMessageGroq[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: p.user },
        { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.base64}` } },
      ],
    },
  ]
  const fallos: string[] = []
  for (const model of GROQ_VISION_MODELOS) {
    try {
      const text = await groqChat(model, [{ role: 'system', content: p.system }, ...messages], p.apiKey, p.maxTokens, {
        json: true,
      })
      return { text, model }
    } catch (e) {
      if ((e as { modeloNoDisponible?: boolean }).modeloNoDisponible) {
        fallos.push(`${model}: ${(e as Error).message}`)
        continue
      }
      throw e
    }
  }
  throw new Error(`Ningún modelo con visión de Groq está disponible (${fallos.join(' | ')}).`)
}
