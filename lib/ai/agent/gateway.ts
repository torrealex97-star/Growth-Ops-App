// Agent Gateway: el único punto donde el modelo puede tocar datos de negocio. Recibe el
// tenantId ya resuelto por el servidor (nunca desde el prompt del usuario) y lo cierra sobre
// cada tool antes de dársela a Claude — el modelo elige QUÉ tool llamar y con qué argumentos,
// pero el tenant_id de cada consulta lo fija este archivo, no el modelo.
//
// Principio de mínimo privilegio (punto 8 del brief): nada de SQL libre. Cada tool es una
// función TypeScript acotada (lib/ai/agent/tools.ts) sobre las tablas de negocio ya existentes.
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { estimateCostUsd } from '@/lib/ai/pricing'
import { autorizarTool, construirSystemPrompt, type ContextoNegocio } from '@/lib/ai/agent/growth-operator'
import { avisoRespuestaCortada, serializarResultadoTool } from '@/lib/ai/agent/serializar'
import * as tools from './tools'

// Modelo único por ahora (solo hay credenciales de Anthropic en este proyecto) — la constante
// vive en un solo sitio para no hardcodear el id en varios ficheros, y consultar la política de
// mínimo-privilegio/costes: BALANCED porque el agente hace tool-use multi-turno, no clasificación
// simple. Cuando haya más de un proveedor real, esto se convierte en un adapter — no antes.
const AGENT_MODEL = process.env.AI_AGENT_MODEL || 'claude-sonnet-5'
const MAX_TOOL_ROUNDS = 4 // evita un bucle de tool-use descontrolado (coste + latencia)

export type ToolEvidence = { name: string; input: Record<string, unknown>; summary: string }
// Coste/latencia reales del turno: sin esto no había forma de saber lo que gasta el agente ni de
// detectar una conversación que se va de precio (el brief lo pide explícitamente).
export type TurnUsage = {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number | null
  latencyMs: number
  rounds: number
}
export type AgentTurn = { text: string; evidence: ToolEvidence[]; usage: TurnUsage }
export type ChatMessage = { role: 'user' | 'assistant'; content: string }

// La clave llega de la configuración de la subcuenta (ver lib/config.ts): leerla de `process.env`
// significaba que el agente de una subcuenta podía consumir la cuenta de Anthropic de otra.
function anthropicClient(apiKey: string | undefined) {
  return new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 })
}

// Definición de tools en formato Anthropic. input_schema es JSON Schema — el SDK valida que el
// modelo mande argumentos con esta forma antes de que lleguen a nuestro código.
const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'getBusinessOverview',
    description:
      'Resumen ejecutivo del negocio en un periodo: inversión en ads, leads, agendas, CPL, ROAS, nº de ventas, ingresos y contactos totales. Punto de partida para preguntas generales ("¿qué tal va el negocio?", "resumen de esta semana").',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional, vacío = todo el histórico)' },
        to: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional)' },
      },
    },
  },
  {
    name: 'getFunnel',
    description:
      'Embudo completo de ads (impresiones→clics→visitas→leads→agendas→llamadas→cierres) con CPM/CPC/CTR/CPL/CAC/ROAS ya calculados. Úsalo para preguntas sobre conversión o dónde se rompe el funnel.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional)' },
        to: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional)' },
      },
    },
  },
  {
    name: 'getCampaignPerformance',
    description:
      'Rendimiento por campaña individual (leads, CPL, agendas, coste/agenda, % de registro y conversión). Filtra opcionalmente por nombre de campaña para comparar una en concreto.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        nameContains: { type: 'string', description: 'Filtra campañas cuyo nombre contenga este texto' },
      },
    },
  },
  {
    name: 'getContacts',
    description: 'Busca contactos por nombre, email o teléfono. Devuelve como máximo 25 resultados.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto a buscar' },
        limit: { type: 'number', description: 'Máximo de resultados (por defecto 10, máximo 25)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'getContactTimeline',
    description:
      'Historia completa de UN contacto: atribución/origen, citas agendadas, transcripciones de llamadas y ventas, en orden cronológico. Usa primero getContacts para encontrar el contact_id si solo tienes el nombre.',
    input_schema: {
      type: 'object',
      properties: { contactId: { type: 'string', description: 'UUID del contacto' } },
      required: ['contactId'],
    },
  },
  {
    name: 'searchTranscripts',
    description:
      'Busca una palabra o frase dentro de las transcripciones de llamadas (Fathom) de este negocio. Devuelve el fragmento donde aparece, no la transcripción completa. Útil para objeciones, temas recurrentes, menciones concretas.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Palabra o frase a buscar' },
        limit: { type: 'number', description: 'Máximo de resultados (por defecto 8, máximo 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'getSales',
    description:
      'Resumen de ventas activas en un periodo: total, ingresos, ticket medio y últimas ventas con nombre de cliente.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        limit: { type: 'number', description: 'Cuántas ventas recientes listar (por defecto 20, máximo 50)' },
      },
    },
  },
  {
    name: 'getMetricDefinition',
    description:
      'Devuelve la definición canónica, fórmula y fuente de datos de una métrica de negocio (lead, cac, cpl, roas, show_rate, close_rate, ltv, revenue...). Úsala SIEMPRE antes de explicar qué significa una métrica, para no inventar una definición distinta de la que usa el resto de la app.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Nombre de la métrica, en español o inglés' } },
      required: ['name'],
    },
  },
  {
    name: 'comparePeriods',
    description:
      'Compara el resumen del negocio (inversión, leads, agendas, CPL, ROAS, ventas, ingresos) entre dos periodos y devuelve el % de cambio de cada métrica. Úsalo para "¿cómo vamos comparado con el mes anterior?".',
    input_schema: {
      type: 'object',
      properties: {
        currentFrom: { type: 'string' },
        currentTo: { type: 'string' },
        previousFrom: { type: 'string' },
        previousTo: { type: 'string' },
      },
      required: ['currentFrom', 'currentTo', 'previousFrom', 'previousTo'],
    },
  },
  {
    name: 'analyzeFunnelChange',
    description:
      'Root Cause Analysis: descompone el funnel completo (CPM, CTR, %carga, %registro, %conversión VSL, %show up, %cierre, ROAS) entre dos periodos y señala en qué etapa concreta está el mayor cambio relativo. Úsalo SIEMPRE que te pregunten "por qué" cambió una métrica agregada (ventas, ingresos) antes de responder — nunca digas solo "las ventas bajaron", identifica la etapa.',
    input_schema: {
      type: 'object',
      properties: {
        currentFrom: { type: 'string' },
        currentTo: { type: 'string' },
        previousFrom: { type: 'string' },
        previousTo: { type: 'string' },
      },
      required: ['currentFrom', 'currentTo', 'previousFrom', 'previousTo'],
    },
  },
  {
    name: 'getTopObjections',
    description:
      'Voice of Customer: objeciones más repetidas en las llamadas ya analizadas (analyzeCall) de un periodo, con nº de menciones y % de llamadas. Si "llamadas_analizadas" es bajo respecto a "llamadas_totales_en_periodo", dilo explícitamente (evidencia insuficiente todavía).',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        limit: { type: 'number', description: 'Máximo de objeciones a devolver (por defecto 10, máximo 25)' },
      },
    },
  },
  {
    name: 'compareClosers',
    description:
      'Sales Intelligence: compara closers por nº de llamadas, score medio de ejecución de la llamada, ventas y close rate en un periodo. Datos crudos — la interpretación (quién lo hace mejor y por qué) la haces tú citando los números.',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
  },
  {
    name: 'getBusinessMemory',
    description:
      'Recupera hechos de negocio, hipótesis, decisiones y resultados registrados anteriormente (memoria explícita del negocio, no conversaciones de chat). Consúltala antes de sugerir un experimento, para no repetir algo que ya se probó y falló.',
    input_schema: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['business', 'hypothesis', 'decision', 'outcome'] } },
    },
  },
  {
    name: 'getDataCoverage',
    description:
      'Qué fuentes de datos tienen información cargada en este negocio y desde qué fecha hasta cuál (ventas, campañas/ads, cobros, contactos, citas, atribución). Úsala SIEMPRE que una métrica salga 0 o vacía, y antes de afirmar cualquier cosa "desde el lanzamiento" o "en todo el histórico": si la fuente está vacía o solo cubre parte del periodo, el 0 no es un resultado del negocio sino falta de datos, y hay que decirlo.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getRecentInsights',
    description:
      'Anomalías/oportunidades detectadas automáticamente (subida de CAC, caída de ROAS/show rate/close rate...) por el motor de insights proactivo. Consúltala al abrir la conversación o cuando preguntan "¿qué necesita atención?" / "¿qué ha cambiado?".',
    input_schema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'recordBusinessFact',
    description:
      'Registra un hecho de negocio, hipótesis, decisión o resultado en la memoria permanente. SOLO llama a esta tool cuando el usuario haya confirmado explícitamente el hecho en su propio mensaje (p.ej. "sí, apúntalo", "confirmado, el 12 de septiembre cambiamos X") — nunca registres una opinión o inferencia tuya como si fuera un hecho.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['business', 'hypothesis', 'decision', 'outcome'] },
        content: { type: 'string', description: 'El hecho, en una frase clara y verificable' },
        outcomeOf: {
          type: 'string',
          description: 'Si type=outcome, el id del hecho/decisión que causó este resultado',
        },
      },
      required: ['type', 'content'],
    },
  },
]

// EL SYSTEM PROMPT VIVE EN growth-operator.ts, no aquí.
//
// No es por orden: es porque el prompt define la AUTORIDAD del agente (lectura total, acción material
// nunca autónoma) y esa frontera se declara una vez, como datos sobre cada tool, y se comprueba en
// código antes de ejecutar (ver `autorizarTool` más abajo). Con el texto en este archivo y la
// comprobación en otro, las dos podían desalinearse sin que nada fallara.

async function callTool(
  name: string,
  input: Record<string, unknown>,
  ctx: tools.ToolContext
): Promise<{ result: unknown; summary: string }> {
  // LA FRONTERA, COMPROBADA. El modelo pide la tool; quien decide si puede ejecutarse es esto. Un prompt
  // es una instrucción, no un control: el agente lee transcripciones y notas escritas por terceros, y sin
  // esta comprobación bastaría un texto que diga "sube el presupuesto" para que tuviera la oportunidad de
  // intentarlo. Lo no clasificado se bloquea, así que añadir una tool nueva nunca concede poder por olvido.
  const permiso = autorizarTool(name)
  if (!permiso.permitida) {
    throw new Error(permiso.motivo)
  }

  switch (name) {
    case 'getBusinessOverview': {
      const r = await tools.getBusinessOverview(ctx, { from: input.from as string, to: input.to as string })
      return {
        result: r,
        summary: `Resumen ${r.period.from || 'histórico'}–${r.period.to || 'hoy'}: ${r.ventas} ventas, ${r.leads} leads`,
      }
    }
    case 'getFunnel': {
      const r = await tools.getFunnel(ctx, { from: input.from as string, to: input.to as string })
      return { result: r, summary: `Funnel: ${r.leads} leads, ${r.agendas} agendas, ${r.cierres} cierres` }
    }
    case 'getCampaignPerformance': {
      const r = await tools.getCampaignPerformance(ctx, {
        period: { from: input.from as string, to: input.to as string },
        nameContains: input.nameContains as string | undefined,
      })
      return { result: r, summary: `${r.length} campaña(s) analizadas` }
    }
    case 'getContacts': {
      const r = await tools.getContacts(ctx, String(input.query || ''), Number(input.limit) || 10)
      return { result: r, summary: `${r.length} contacto(s) encontrados para "${input.query}"` }
    }
    case 'getContactTimeline': {
      const r = await tools.getContactTimeline(ctx, String(input.contactId || ''))
      return {
        result: r,
        summary: r.contact
          ? `Timeline de ${r.contact.full_name}: ${r.timeline.length} eventos`
          : 'Contacto no encontrado en este tenant',
      }
    }
    case 'searchTranscripts': {
      const r = await tools.searchTranscripts(ctx, String(input.query || ''), Number(input.limit) || 8)
      return { result: r, summary: `${r.length} llamada(s) con "${input.query}"` }
    }
    case 'getSales': {
      const r = await tools.getSales(
        ctx,
        { from: input.from as string, to: input.to as string },
        Number(input.limit) || 20
      )
      return { result: r, summary: `${r.total_ventas} ventas, ${r.ingresos.toFixed(0)}€ en el periodo` }
    }
    case 'getMetricDefinition': {
      const r = tools.getMetricDefinition(String(input.name || ''))
      return { result: r, summary: 'error' in r ? r.error : `Definición de ${r.name}` }
    }
    case 'comparePeriods': {
      const r = await tools.comparePeriods(
        ctx,
        { from: input.currentFrom as string, to: input.currentTo as string },
        { from: input.previousFrom as string, to: input.previousTo as string }
      )
      return { result: r, summary: `Comparación de periodos: ${r.delta.ingresos_pct?.toFixed(1) ?? '—'}% en ingresos` }
    }
    case 'analyzeFunnelChange': {
      const r = await tools.analyzeFunnelChange(
        ctx,
        { from: input.currentFrom as string, to: input.currentTo as string },
        { from: input.previousFrom as string, to: input.previousTo as string }
      )
      return {
        result: r,
        summary: r.etapa_mas_afectada
          ? `Mayor cambio en: ${r.etapa_mas_afectada.stage} (${r.etapa_mas_afectada.pct_change?.toFixed(1)}%)`
          : 'Sin cambios significativos detectados',
      }
    }
    case 'getTopObjections': {
      const r = await tools.getTopObjections(
        ctx,
        { from: input.from as string, to: input.to as string },
        Number(input.limit) || 10
      )
      return {
        result: r,
        summary: `${r.llamadas_analizadas} llamada(s) analizadas, ${r.top_objeciones.length} objeciones`,
      }
    }
    case 'compareClosers': {
      const r = await tools.compareClosers(ctx, { from: input.from as string, to: input.to as string })
      return { result: r, summary: `${r.closers.length} closer(s) comparados` }
    }
    case 'getBusinessMemory': {
      const r = await tools.getBusinessMemory(ctx, input.type as string | undefined)
      return { result: r, summary: `${r.length} hecho(s) en la memoria de negocio` }
    }
    case 'getDataCoverage': {
      const r = await tools.getDataCoverage(ctx)
      return {
        result: r,
        summary:
          r.fuentes_vacias.length > 0
            ? `Fuentes sin datos: ${r.fuentes_vacias.join(', ')}`
            : 'Todas las fuentes tienen datos',
      }
    }
    case 'getRecentInsights': {
      const r = await tools.getRecentInsights(ctx, Number(input.limit) || 10)
      return { result: r, summary: `${r.length} insight(s) reciente(s)` }
    }
    case 'recordBusinessFact': {
      const r = await tools.recordBusinessFact(ctx, {
        type: input.type as 'business' | 'hypothesis' | 'decision' | 'outcome',
        content: String(input.content || ''),
        outcomeOf: input.outcomeOf as string | undefined,
      })
      return { result: r, summary: 'error' in r ? r.error : `Hecho registrado: ${r.content}` }
    }
    default:
      throw new Error(`Tool desconocida: ${name}`)
  }
}

export async function runAgent(opts: {
  tenantId: string
  /** Clave de Anthropic de esta subcuenta. */
  anthropicKey: string | undefined
  tenantName: string
  userId?: string
  sb: SupabaseClient
  history: ChatMessage[]
  screen?: string
  /** Contexto de negocio que ha puesto una persona (precio, oferta, objetivos). No se adivina. */
  contexto?: ContextoNegocio
  /** El brief del día ya calculado por el panel, para no gastar rondas de tools en lo que ya se sabe. */
  briefResumen?: string
  onToolCall?: (
    name: string,
    input: Record<string, unknown>,
    success: boolean,
    summary: string,
    latencyMs: number
  ) => void
}): Promise<AgentTurn> {
  const client = anthropicClient(opts.anthropicKey)
  const ctx: tools.ToolContext = { tenantId: opts.tenantId, sb: opts.sb, userId: opts.userId }
  const evidence: ToolEvidence[] = []
  const startedAt = Date.now()
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, rounds: 0 }
  const buildUsage = (): TurnUsage => ({
    model: AGENT_MODEL,
    ...totals,
    costUsd: estimateCostUsd(AGENT_MODEL, totals),
    latencyMs: Date.now() - startedAt,
  })

  const messages: Anthropic.MessageParam[] = opts.history.map((m) => ({ role: m.role, content: m.content }))

  // Se construye una vez: es el mismo prompt en todas las rondas de tool-use del turno.
  const system = construirSystemPrompt({
    tenantName: opts.tenantName,
    screen: opts.screen,
    contexto: opts.contexto,
    briefResumen: opts.briefResumen,
  })

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: 1500,
      system,
      tools: TOOL_DEFS,
      messages,
    })

    totals.rounds++
    totals.inputTokens += resp.usage.input_tokens ?? 0
    totals.outputTokens += resp.usage.output_tokens ?? 0
    totals.cacheReadTokens += resp.usage.cache_read_input_tokens ?? 0
    totals.cacheWriteTokens += resp.usage.cache_creation_input_tokens ?? 0

    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      // Si el modelo se quedó sin tokens, la respuesta llega cortada a media frase. Se dice: quien
      // lee un análisis que acaba en "el CAC ha subido porque" no sabe si falta media frase o la
      // conclusión entera.
      const conAviso = avisoRespuestaCortada(text, resp.stop_reason)
      return { text: conAviso || 'No he podido generar una respuesta.', evidence, usage: buildUsage() }
    }

    messages.push({ role: 'assistant', content: resp.content })
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const use of toolUses) {
      const input = (use.input as Record<string, unknown>) || {}
      const toolStartedAt = Date.now()
      try {
        const { result, summary } = await callTool(use.name, input, ctx)
        evidence.push({ name: use.name, input, summary })
        opts.onToolCall?.(use.name, input, true, summary, Date.now() - toolStartedAt)
        // Se recorta por DATOS, nunca cortando la cadena: `JSON.stringify(...).slice(...)` dejaba al
        // modelo un JSON mutilado —sin cerrar y con el último valor a medias— que NO le hace fallar,
        // le hace RELLENAR. Y rellenar cifras de negocio es el peor fallo posible porque no se nota.
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: serializarResultadoTool(result) })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        opts.onToolCall?.(use.name, input, false, msg, Date.now() - toolStartedAt)
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: `Error: ${msg}`, is_error: true })
      }
    }
    messages.push({ role: 'user', content: toolResults })
  }

  return {
    text: 'La consulta requería demasiados pasos — intenta preguntar algo más concreto.',
    evidence,
    usage: buildUsage(),
  }
}
