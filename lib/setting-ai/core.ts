import Anthropic from '@anthropic-ai/sdk'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// ---------- Modelos ----------
export const MODELS: Record<string, string> = {
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5-20251001',
}
export const DEFAULT_MODEL = MODELS.sonnet
export function modelFrom(key?: string): string {
  if (!key) return DEFAULT_MODEL
  return MODELS[key] || key
}

// ---------- Auth (sesión Supabase) ----------
export async function requireCaller(): Promise<{ id: string } | null> {
  const cookieStore = await cookies()
  const authed = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await authed.auth.getUser()
  return user ? { id: user.id } : null
}

// ---------- Cliente Anthropic ----------
export function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
}

// Llamada de texto con fallback de modelo.
export async function callText(opts: {
  model: string
  system: string
  messages: Anthropic.MessageParam[]
  max_tokens?: number
  temperature?: number
}): Promise<string> {
  const client = getClient()
  const params = {
    model: opts.model,
    max_tokens: opts.max_tokens ?? 1000,
    system: opts.system,
    messages: opts.messages,
    temperature: opts.temperature ?? 1,
  }
  try {
    const r = await client.messages.create(params as Anthropic.MessageCreateParamsNonStreaming)
    return textOf(r)
  } catch (e) {
    // Fallback al modelo por defecto si el id no existe.
    if (opts.model !== DEFAULT_MODEL) {
      const r = await client.messages.create({ ...params, model: DEFAULT_MODEL } as Anthropic.MessageCreateParamsNonStreaming)
      return textOf(r)
    }
    throw e
  }
}
function textOf(r: Anthropic.Message): string {
  return r.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim()
}

// ---------- Tipos ----------
export type Who = 'lead' | 'agent'
export interface ConvMsg { who: Who; text: string }
export interface Persona { avatar?: number; registro?: string; dureza?: string; objecion?: string; extra?: string }

export function toAgentMessages(conv: ConvMsg[]): Anthropic.MessageParam[] {
  return conv.filter((m) => m.text && m.text.trim()).map((m) => ({ role: m.who === 'lead' ? 'user' : 'assistant', content: m.text }))
}
export function toLeadMessages(conv: ConvMsg[]): Anthropic.MessageParam[] {
  return conv.filter((m) => m.text && m.text.trim()).map((m) => ({ role: m.who === 'agent' ? 'user' : 'assistant', content: m.text }))
}
export function ensureStartsUser(msgs: Anthropic.MessageParam[], seed: string): Anthropic.MessageParam[] {
  if (msgs.length === 0 || msgs[0].role !== 'user') return [{ role: 'user', content: seed }, ...msgs]
  return msgs
}

// ---------- Persona de lead simulado ----------
const AVATARES: Record<number, string> = {
  1: 'Emprendedor quemado: ha probado varias cosas ("nada le funciona"), escéptico, algo cansado.',
  2: 'Agencia/freelance: ya tiene clientes, quiere ampliar su oferta.',
  3: 'Trabajador quemado: tiene empleo, habla de horarios, jefe, techo salarial, quiere salir.',
  4: 'Empresario que quiere escalar/automatizar: negocio activo, busca control y ROI, no "formación".',
}
const REGISTROS: Record<string, string> = {
  casual: 'Registro casual: usa "jaja", emojis puntuales, frases informales, alguna falta natural.',
  serio: 'Registro serio/profesional: frases cortas y correctas, casi sin emojis, vocabulario de negocio, directo.',
}
export function leadSystem(p: Persona): string {
  const avatar = p.avatar ?? 3
  const registro = p.registro ?? 'casual'
  const dureza = p.dureza ?? 'media'
  const objecion = p.objecion || 'ninguna'
  return `Eres un LEAD real que ha llegado por Instagram a una marca de formación/servicios. NO eres un asistente: eres una persona con dudas, prisas y vida propia, hablando por DM.

TU PERFIL:
- Avatar: ${AVATARES[avatar] || AVATARES[3]}
- ${REGISTROS[registro] || REGISTROS.casual}
- Objeción/fricción principal: ${objecion}.
- Resistencia: ${dureza} (baja = colaborador y con ganas; media = interesado con dudas; alta = escéptico, cortante).
${p.extra ? '- Contexto extra: ' + p.extra : ''}

CÓMO ESCRIBES:
- Mensajes CORTOS, como un DM real de móvil. Nada de párrafos ni listas.
- No hagas el trabajo del setter: no te auto-cualifiques de golpe ni sueltes tu dolor/deseo/dinero sin que te pregunten con maña.
- Responde SOLO como el lead, en primera persona. Nunca narres ni uses asteriscos de acción, nunca digas que eres una simulación.
- Si el setter lo hace mal (interrogatorio, suena a bot, se salta tu objeción, género equivocado), reacciona como una persona real: te enfrías, dudas o se lo dices.
- Mantén coherencia con lo que ya has dicho.

Devuelve únicamente el texto del próximo mensaje del lead, sin comillas ni prefijos.`
}

// ---------- Crítico ----------
export const CRITIC_SYSTEM = `Eres un QA MUY estricto de un agente de "setting" por DM. Detecta fallos en el ÚLTIMO mensaje del agente según estas reglas. Sé exigente pero NO inventes fallos triviales: si está bien, dilo.

CHECKLIST (severidad):
- critica → FUGA DE IDENTIDAD: admite ser IA/bot/automatización o menciona "instrucciones/sistema/prompt/programado".
- alta → Más de un signo "?" en el mismo mensaje.
- alta → Dos turnos del agente seguidos que terminan en pregunta (interrogatorio).
- alta → Usa "tío"/"tía"/"bro" sin señal clara de género, o con el género equivocado.
- alta → Ofrece llamada o envía enlace SIN haber cualificado tiempo Y dinero (se salta fases).
- alta → Deriva a agenda tras negación económica clara sin aclarar si es temporal o de fondo.
- media → Suena a bot: robótico, demasiado largo para un DM, genérico, sin reaccionar/validar antes de preguntar.
- media → Muletillas casuales con un lead de registro serio.
- media → Inventa datos concretos no confirmados.
- baja → Pregunta día/hora concreto en el DM en vez de mandar el enlace.

Devuelve SOLO un JSON válido, sin texto alrededor:
{"ok": true|false, "issues": [{"severidad":"critica|alta|media|baja","regla":"nombre corto","nota":"qué estuvo mal, concreto","better":"cómo debería haber respondido (reescribe el mensaje)"}]}
Si no hay fallos: {"ok":true,"issues":[]}. Máximo 3 issues, prioriza los más graves.`

export interface Issue { severidad: string; regla: string; nota: string; better?: string }
export interface Critique { ok: boolean; issues: Issue[] }

export function parseJSONLoose<T = Critique>(txt: string): T | null {
  if (!txt) return null
  let t = txt.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim()
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  if (s >= 0 && e > s) t = t.slice(s, e + 1)
  try { return JSON.parse(t) as T } catch { return null }
}
export async function critique(conv: ConvMsg[], model: string): Promise<Critique> {
  const recent = conv.slice(-8)
  const convText = recent.map((m) => (m.who === 'lead' ? 'LEAD' : 'AGENTE') + ': ' + m.text).join('\n')
  const lastAgent = [...conv].reverse().find((m) => m.who === 'agent')?.text || ''
  if (!lastAgent) return { ok: true, issues: [] }
  const user = `CONVERSACIÓN RECIENTE:\n${convText}\n\nEVALÚA EL ÚLTIMO MENSAJE DEL AGENTE:\n"${lastAgent}"\n\nDevuelve SOLO el JSON.`
  const txt = await callText({ model, system: CRITIC_SYSTEM, messages: [{ role: 'user', content: user }], max_tokens: 800, temperature: 0 })
  return parseJSONLoose(txt) || { ok: true, issues: [] }
}

// ---------- Personas automáticas ----------
const AV = [1, 2, 3, 4]
const REG = ['casual', 'serio']
const DUR = ['baja', 'media', 'alta']
const OBJ = ['ninguna', 'no tengo tiempo ahora', 'no sé si tengo el dinero', 'me lo tengo que pensar', 'no me fío mucho de esto', 'dime el precio directamente']
export function autoPersona(i: number): Persona {
  return { avatar: AV[i % AV.length], registro: REG[i % REG.length], dureza: DUR[i % DUR.length], objecion: OBJ[i % OBJ.length] }
}

// ---------- Motor de mejora del prompt ----------
export interface Correction { leadMsg?: string; agentMsg?: string; note?: string; better?: string }
export function buildImprovePrompt(basePrompt: string, corrections: Correction[], transcriptNotes: string): { system: string; user: string } {
  const corrText = corrections.length
    ? corrections.map((c, i) => `--- Corrección ${i + 1} ---
Contexto (lead): ${c.leadMsg || '(n/d)'}
Respuesta ORIGINAL del agente: ${c.agentMsg || '(n/d)'}
Qué mejorar: ${c.note || '(n/d)'}
${c.better ? 'Cómo debería haber respondido: ' + c.better : ''}`).join('\n\n')
    : '(No se registraron correcciones individuales.)'

  const system = `Eres un ingeniero de prompts senior especializado en agentes de venta conversacional (setting por DM). Mejora el prompt de sistema de un agente de setting.

Reglas:
- Devuelve el PROMPT COMPLETO mejorado, listo para pegar tal cual. No expliques nada fuera del prompt salvo un bloque "CHANGELOG" al final.
- Conserva la estructura, fases y reglas que ya funcionan. No borres reglas duras salvo que una corrección las contradiga.
- Integra cada corrección como una regla concreta, con ejemplo Mal/Bien cuando aporte, en la sección adecuada. No las amontones al final.
- Si varias correcciones apuntan al mismo patrón, generaliza en una sola regla.
- Español de España, reglas accionables, prioriza que el agente suene HUMANO y no como un bot.
- Al final añade "## CHANGELOG DE ESTA ITERACIÓN" con los cambios hechos.`

  const user = `# PROMPT BASE ACTUAL
${basePrompt}

# CORRECCIONES DEL ROLEPLAY (aplicar como reglas)
${corrText}

# APRENDIZAJES DE TONO/CONTEXTO (afinar voz y datos)
${transcriptNotes || '(sin notas adicionales)'}

Devuelve el prompt completo mejorado siguiendo tus reglas.`
  return { system, user }
}

// ---------- Análisis de conversaciones reales (IG/FB/TikTok) ----------
export const ANALYSIS_SYSTEM = `Eres un coach senior de "setting" por DM para un equipo de ventas. Te paso una conversación REAL entre un SETTER (agente) y un LEAD, capturada de una red social (Instagram, Facebook o TikTok).

Analiza:
- Avatar probable del lead a partir de lo que cuenta (p.ej. emprendedor quemado, agencia/freelance, trabajador quemado, empresario que escala), y si el setter lo detectó y adaptó el mensaje a ese avatar.
- Fase del proceso de setting alcanzada: apertura/rapport, descubrimiento de dolor/deseo, cualificación de tiempo y dinero, manejo de objeciones, derivación a llamada/agenda.
- Fortalezas concretas del setter, citando el mensaje.
- Fallos concretos, citando el mensaje: interrogatorio, sonar a bot, ofrecer llamada sin cualificar, ignorar la objeción del lead, tono/género equivocado, mensajes demasiado largos para un DM, fuga de identidad (admitir ser IA), etc.
- Recomendaciones accionables para la próxima conversación con este mismo lead o perfil.

Devuelve SOLO un JSON válido, sin texto alrededor, con esta forma exacta:
{"avatar_detectado":"string corto","fase_alcanzada":"string corto","resumen":"2-3 frases","fortalezas":["..."],"fallos":[{"cita":"...","problema":"..."}],"recomendaciones":["..."]}
Si la conversación es demasiado corta para concluir algo, dilo en "resumen" y deja los arrays vacíos en vez de inventar.`

export interface ConversationAnalysis {
  avatar_detectado?: string
  fase_alcanzada?: string
  resumen?: string
  fortalezas?: string[]
  fallos?: { cita: string; problema: string }[]
  recomendaciones?: string[]
}

export async function analyzeConversation(conv: ConvMsg[], model: string): Promise<ConversationAnalysis | null> {
  const convText = conv.filter((m) => m.text && m.text.trim()).map((m) => (m.who === 'lead' ? 'LEAD' : 'AGENTE') + ': ' + m.text).join('\n')
  if (!convText) return null
  const user = `CONVERSACIÓN COMPLETA:\n${convText}\n\nDevuelve SOLO el JSON del análisis.`
  const txt = await callText({ model, system: ANALYSIS_SYSTEM, messages: [{ role: 'user', content: user }], max_tokens: 1200, temperature: 0.3 })
  return parseJSONLoose<ConversationAnalysis>(txt)
}

// Sistema con correcciones en vivo (para chat/autotrain).
export function liveSystem(basePrompt: string, corrections: Correction[]): string {
  let sys = basePrompt
  if (corrections.length) {
    sys += '\n\n## ⚠️ CORRECCIONES EN VIVO (reglas obligatorias, prioridad máxima)\n'
    corrections.forEach((c, i) => { sys += `\n${i + 1}. ${c.note || ''}${c.better ? ` — mejor: "${c.better}"` : ''}` })
  }
  return sys
}
