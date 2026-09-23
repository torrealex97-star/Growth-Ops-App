import Anthropic from '@anthropic-ai/sdk'
import { completeText, type TextRequest } from '@/lib/ai/provider'

// Cliente Claude directo. Solo lo usa lo que NO puede ir por el motor configurable: leer facturas
// (imágenes y PDFs), que los modelos de texto de DeepSeek no ven. Todo lo demás pasa por
// lib/ai/provider, que respeta el motor elegido en Integraciones.
// maxRetries alto porque Anthropic devuelve "overloaded_error" (529) con cierta frecuencia en picos
// de carga; el default del SDK (2) no siempre aguanta hasta que se libera capacidad.
function anthropic(apiKey: string | undefined) {
  return new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 })
}

const MODEL_FAST = 'claude-haiku-4-5-20251001'

/**
 * Configuración de IA de la subcuenta. Se pasa desde la ruta, que es quien sabe de qué subcuenta es
 * la petición. Si no se pasa, se usa el entorno global — que es lo que hacía todo esto antes.
 */
export type AiEnv = Record<string, string | undefined>

// Extrae el primer bloque JSON del texto devuelto por el modelo.
function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('La IA no devolvió JSON válido')
  return JSON.parse(raw.slice(start, end + 1)) as T
}

export type InvoiceExtract = {
  concept: string | null
  amount: number | null
  currency: string | null // ISO 4217 detectado en la factura (EUR, USD, GBP...)
  vat: number | null
  category: 'publicidad' | 'sueldos' | 'comisiones' | 'herramientas' | 'eventos' | 'cogs' | 'otros' | null
  counterparty: string | null
  invoice_number: string | null
  invoice_due_date: string | null // YYYY-MM-DD
  counterparty_tax_id: string | null // NIF/CIF/VAT ID del emisor
  counterparty_address: string | null
  counterparty_bank_account: string | null // IBAN/cuenta del EMISOR: no es una cuenta propia ni prueba de pago
  counterparty_bank_name: string | null
  expense_date: string | null // YYYY-MM-DD
  suggested_person: string | null // nombre del miembro del equipo si aparece
  confidence: number // 0-1
}

// Lee una factura (imagen o PDF en base64) y extrae los campos del gasto.
export async function extractInvoice(
  base64: string,
  mediaType: string,
  teamNames: string[] = [],
  /** Configuración de IA de la subcuenta: de ahí sale la clave con la que se factura. */
  env?: AiEnv
): Promise<InvoiceExtract> {
  const isPdf = mediaType === 'application/pdf'
  const source = isPdf
    ? { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 }
    : { type: 'base64' as const, media_type: mediaType as 'image/png' | 'image/jpeg' | 'image/webp', data: base64 }

  const system = `Eres un contable que extrae datos de facturas.
Devuelve SOLO un objeto JSON con estas claves exactas:
{"concept": string, "amount": number, "currency": string, "vat": number|null, "category": one of ["publicidad","sueldos","comisiones","herramientas","eventos","cogs","otros"], "counterparty": string (quien emite/cobra), "invoice_number": string|null, "invoice_due_date": "YYYY-MM-DD"|null, "counterparty_tax_id": string|null (NIF/CIF/VAT del emisor), "counterparty_address": string|null, "counterparty_bank_account": string|null (IBAN/cuenta bancaria DEL EMISOR impresa en la factura), "counterparty_bank_name": string|null (banco del emisor), "expense_date": "YYYY-MM-DD", "suggested_person": string|null, "confidence": number 0-1}
- amount = importe TOTAL de la factura tal cual aparece impreso (con IVA incluido si lo hay), SIN convertir de moneda.
- currency = código ISO 4217 de 3 letras de la moneda en la que está expresado el importe (p.ej. "EUR", "USD", "GBP"). Dedúcelo del símbolo ($, €, £), del texto (USD, dólares, dollars) o del país del emisor. Si no hay ninguna pista, usa "EUR".
- Categoriza según el proveedor/concepto (ads=publicidad, software/SaaS=herramientas, nóminas=sueldos, etc.).
- invoice_number = número de factura impreso. invoice_due_date = fecha de vencimiento impresa. counterparty_tax_id = NIF/CIF/VAT number del emisor. counterparty_address = dirección fiscal del emisor. counterparty_bank_account = la cuenta bancaria DEL EMISOR (para pagarle), NO una cuenta propia. counterparty_bank_name = nombre del banco del emisor.
- NO demuestra que el pago se haya realizado: la factura no es un justificante de pago. No extraigas datos de la cuenta propia desde la que se pagó ni fechas/referencias de pago: no están en la factura.
- Si en la factura aparece el nombre de un miembro del equipo de esta lista, ponlo en suggested_person; si no, null. Equipo: ${teamNames.join(', ') || '(desconocido)'}.
- Usa punto decimal. No inventes datos: si algo no aparece, usa null.`

  const msg = await anthropic(env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY).messages.create({
    model: MODEL_FAST,
    max_tokens: 700,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: isPdf ? 'document' : 'image', source } as never,
          { type: 'text', text: 'Extrae los datos de esta factura en JSON.' },
        ],
      },
    ],
  })
  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
  return parseJson<InvoiceExtract>(text)
}

// Toma el texto de un contrato pegado y le inserta las variables {{...}} donde
// corresponda, para no tener que escribirlas a mano. Devuelve el mismo texto con
// las variables sustituidas.
const CONTRACT_VARS = [
  'empresa',
  'cif',
  'empresa_direccion',
  'representante',
  'nombre',
  'email',
  'telefono',
  'rol',
  'fecha',
  'fijo',
  'dni',
  'direccion',
  'codigo_postal',
  'ciudad',
]
export async function contractVariablesFromText(text: string, env?: AiEnv): Promise<string> {
  const system = `Eres un asistente que prepara PLANTILLAS de contrato para una empresa.
Recibes el texto de un contrato y debes SUSTITUIR los datos concretos por variables entre dobles llaves, para reutilizar la plantilla con distintas personas.
Usa EXACTAMENTE estas variables (no inventes otras):
- {{empresa}} razón social · {{cif}} · {{empresa_direccion}} · {{representante}}
- {{nombre}} del colaborador · {{email}} · {{telefono}} · {{rol}} · {{fecha}} de alta · {{fijo}} retribución fija
- {{dni}} · {{direccion}} · {{codigo_postal}} · {{ciudad}} (datos que rellenará el firmante)
Reglas:
- Sustituye nombres propios de personas por {{nombre}}, DNIs por {{dni}}, direcciones por {{direccion}}, la empresa por {{empresa}}, CIF por {{cif}}, fechas de alta por {{fecha}}, importes de sueldo fijo por {{fijo}}, el puesto/rol por {{rol}}.
- NO toques cláusulas ni el sentido del texto. Conserva saltos de línea y estructura.
- Si un dato no aparece, no lo fuerces.
- NO añadas la sección de condiciones económicas ni firmas (se generan aparte).
Devuelve SOLO el texto resultante, sin explicaciones ni comillas de código.`

  const completion = await completeText({ system, user: text.slice(0, 40000), maxTokens: 4000, smart: true }, env)
  let out = completion.text.trim()
  // Quita posibles fences de código
  out = out
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim()
  // Sanea variables no reconocidas hacia el conjunto permitido no es necesario; se dejan tal cual.
  void CONTRACT_VARS
  return out
}

type CallTask = { title: string; description?: string }
export type CallAnalysis = {
  call_score: number // 1-10 calidad de la llamada del comercial
  lead_score: number // 1-10 temperatura/calidad del lead
  suggested_stage: string // etapa del pipeline sugerida
  summary: string
  objections: string[]
  next_steps: string[]
  tasks: CallTask[] // tareas accionables para quien llevó la llamada
}

// Analiza la transcripción de una llamada y devuelve valoración + etapa + tareas.
export async function analyzeCall(
  transcript: string,
  context?: { leadName?: string; product?: string },
  env?: AiEnv
): Promise<CallAnalysis> {
  const system = `Eres un sales coach experto en alto ticket.
Analizas la transcripción de una llamada de ventas y devuelves SOLO un objeto JSON:
{"call_score": number 1-10, "lead_score": number 1-10, "suggested_stage": one of ["Nuevo","Contactado","Cita agendada","Presentado/Demo","Oferta hecha","Depósito","Cerrado ganado","Seguimiento","Perdido/No cualifica"], "summary": string (3-4 frases en español), "objections": string[], "next_steps": string[], "tasks": [{"title": string, "description": string}]}
- call_score valora la ejecución del comercial (descubrimiento, manejo de objeciones, cierre).
- lead_score valora encaje/urgencia/presupuesto del lead.
- suggested_stage = dónde queda el lead tras esta llamada.
- tasks = acciones concretas de seguimiento para el comercial (2-5), en español.
No inventes; si la transcripción es pobre, refléjalo en los scores.`

  const user = `${context?.leadName ? `Lead: ${context.leadName}\n` : ''}${context?.product ? `Producto: ${context.product}\n` : ''}Transcripción:\n"""${transcript.slice(0, 60000)}"""`

  const { text } = await completeText({ system, user, maxTokens: 1500, smart: true }, env)
  return parseJson<CallAnalysis>(text)
}

// ── Instagram orgánico ───────────────────────────────────────────────────────

export type ReelAnalysis = {
  hook: string // el gancho de los primeros 3 segundos
  estructura: string // cómo está construido el guión
  tema: string // de qué va, en 1 frase
  por_que_funciona: string // hipótesis de por qué rinde bien
  tags: string[] // temáticas/formato para agrupar contenido similar
}

// Analiza la transcripción de un reel y explica QUÉ lo hace funcionar.
export async function analyzeReel(
  transcript: string,
  context?: { caption?: string; views?: number; saves?: number; engagement?: number },
  env?: AiEnv
): Promise<ReelAnalysis> {
  const system = `Eres un estratega de contenido viral en Instagram para un creador de nicho de IA/negocio.
Analizas la transcripción de un reel y devuelves SOLO un objeto JSON:
{"hook": string (el gancho literal o parafraseado de los primeros 3s), "estructura": string (cómo está montado el guión: hook→desarrollo→CTA, listicle, storytelling, etc.), "tema": string (de qué va en 1 frase), "por_que_funciona": string (hipótesis concreta de por qué retiene/genera guardados/comparte, en 2-3 frases), "tags": string[] (3-6 etiquetas de temática y formato para agrupar contenido parecido)}
Responde en español. Sé concreto y accionable; nada de generalidades.`
  const metrics = context
    ? `Métricas: ${context.views ?? '?'} views, ${context.saves ?? '?'} guardados, ${context.engagement ?? '?'}% engagement.\n`
    : ''
  const user = `${context?.caption ? `Caption: ${context.caption}\n` : ''}${metrics}Transcripción del reel:\n"""${transcript.slice(0, 20000)}"""`

  const { text } = await completeText({ system, user, maxTokens: 900, smart: true }, env)
  return parseJson<ReelAnalysis>(text)
}

export type ScriptDraft = {
  title: string // título/idea corta del nuevo reel
  hook: string // gancho de los primeros 3s (mantiene el del original)
  script: string // guión completo listo para grabar (con pausas/beats)
  caption: string // caption sugerido con CTA
  notes: string // por qué esta versión debería rendir igual o mejor
  cta_used?: string // código del CTA usado (AGENCIA/INFO/NEGOCIO/CLIENTES/VIDEO/CLASE)
  testimonio_used?: string // nombre del caso de éxito citado, si se pidió prueba social
}

// Genera un guión NUEVO a partir de uno que ya funcionó: MANTIENE el hook y la
// primera parte del original y, a partir de ahí, redirige hacia nuestro modelo de
// negocio cerrando con UNO de nuestros 6 CTAs.
export async function generateScript(
  reference: { transcript?: string; caption?: string; analysis?: ReelAnalysis | null },
  instruction?: string,
  opts?: {
    businessContext?: string
    ctasBlock?: string
    forcedCta?: string
    styleBlock?: string
    /** Prueba social opcional: caso de éxito a mencionar dentro del guión. */
    testimonioBlock?: string
  },
  env?: AiEnv
): Promise<ScriptDraft> {
  const system = `Eres el guionista de reels de la marca, tono directo y con autoridad, español de España.

Tu tarea: a partir de la TRANSCRIPCIÓN de un reel de referencia que ya funcionó, escribir un guión NUEVO siguiendo esta estructura OBLIGATORIA:
1) MANTÉN el hook y la primera parte del original (el gancho que enganchó), adaptándolo mínimamente — que suene igual de potente. NO lo cambies de tema todavía.
2) A partir de ahí, ENNICHA: reconduce de forma natural y fluida el contenido hacia nuestro modelo de negocio (Agencia de IA / automatización para empresas). El puente debe sentirse orgánico, no forzado.
3) CIERRA con UNO de nuestros CTAs: invita a comentar la palabra clave del CTA para recibir el recurso. Elige el CTA que mejor encaje con el tema del reel y el avatar (agencia vs negocio), salvo que se te indique uno concreto.

${opts?.businessContext ? `CONTEXTO DE NEGOCIO:\n${opts.businessContext}\n` : ''}
${opts?.ctasBlock ? `CTAs DISPONIBLES (usa la palabra clave EXACTA entre comillas al cerrar):\n${opts.ctasBlock}\n` : ''}
${opts?.forcedCta ? `CTA OBLIGATORIO A USAR: "${opts.forcedCta}".\n` : ''}
${opts?.styleBlock ? `ESTILO A RESPETAR SIEMPRE:\n${opts.styleBlock}\n` : ''}
${opts?.testimonioBlock ? `${opts.testimonioBlock}\n` : ''}
Devuelves SOLO un objeto JSON:
{"title": string (título corto de la idea), "hook": string (los primeros 3s, tomando el del original), "script": string (guión completo para grabar con beats/pausas marcadas, 30-70s, con el puente al negocio y el CTA al final), "caption": string (caption con el CTA), "notes": string (breve: qué se mantuvo del original y por qué el puente funciona), "cta_used": string (código del CTA usado)${opts?.testimonioBlock ? ', "testimonio_used": string (nombre del caso de éxito mencionado en el guión)' : ''}}
Responde en español.`
  const ref = `${reference.analysis ? `Análisis del original: ${JSON.stringify(reference.analysis)}\n` : ''}${reference.caption ? `Caption original: ${reference.caption}\n` : ''}${reference.transcript ? `Transcripción original:\n"""${reference.transcript.slice(0, 12000)}"""\n` : ''}${instruction ? `\nInstrucción concreta del creador para ESTE guión: ${instruction}` : ''}`

  const { text } = await completeText(
    {
      system,
      user: ref || 'Genera un guión de reel sobre IA aplicada a negocio con nuestro hook y CTA.',
      maxTokens: 2000,
      smart: true,
    },
    env
  )
  return parseJson<ScriptDraft>(text)
}
