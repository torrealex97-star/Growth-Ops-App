import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { createClient } from '@/lib/supabase/server'
import { runAgent, type ChatMessage } from '@/lib/ai/agent/gateway'

export const runtime = 'nodejs'
export const maxDuration = 60

// Agent Gateway HTTP: usa el cliente autenticado del USUARIO (no service role) para todo —
// tanto para leer/escribir sus propias conversaciones (RLS: solo el dueño) como para las tools
// de negocio (RLS: aislamiento por tenant + rol, exactamente lo mismo que ya rige el resto de la
// app). El agente nunca tiene más acceso a datos que el propio usuario que lo abrió.
const MAX_HISTORY = 20 // mensajes previos que se mandan al modelo (no toda la conversación)

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const body = (await req.json().catch(() => ({}))) as { conversationId?: string; message?: string; screen?: string }
  const message = (body.message || '').trim()
  if (!message) return NextResponse.json({ error: 'Falta el mensaje' }, { status: 400 })
  if (message.length > 4000)
    return NextResponse.json({ error: 'Mensaje demasiado largo (máx. 4000 caracteres)' }, { status: 400 })

  const sb = await createClient()

  let conversationId = body.conversationId
  if (!conversationId) {
    const { data, error } = await sb
      .from('ai_conversations')
      .insert({
        tenant_id: auth.tenantId,
        user_id: auth.userId,
        title: message.slice(0, 80),
        screen: body.screen || null,
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    conversationId = data.id as string
  } else {
    // Verifica pertenencia (RLS ya lo impediría, pero un 404 explícito es mejor UX/seguridad
    // que dejar que el insert de abajo falle silenciosamente contra una conversación ajena).
    const { data: conv } = await sb.from('ai_conversations').select('id').eq('id', conversationId).maybeSingle()
    if (!conv) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })
  }

  const { data: priorMessages } = await sb
    .from('ai_messages')
    .select('role,content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(MAX_HISTORY)

  const { error: userMsgErr } = await sb
    .from('ai_messages')
    .insert({ tenant_id: auth.tenantId, conversation_id: conversationId, role: 'user', content: message })
  if (userMsgErr) return NextResponse.json({ error: userMsgErr.message }, { status: 500 })

  const { data: tenantRow } = await sb.from('tenants').select('slug').eq('id', auth.tenantId).maybeSingle()
  const history: ChatMessage[] = [...((priorMessages || []) as ChatMessage[]), { role: 'user', content: message }]

  const toolCallLogs: Array<{
    tool_name: string
    input: Record<string, unknown>
    success: boolean
    result_summary: string
    latency_ms: number
  }> = []
  let turn
  try {
    turn = await runAgent({
      tenantId: auth.tenantId,
      tenantName: tenantRow?.slug || tenant,
      userId: auth.userId,
      sb,
      history,
      screen: body.screen,
      onToolCall: (name, input, success, summary, latencyMs) => {
        toolCallLogs.push({ tool_name: name, input, success, result_summary: summary, latency_ms: latencyMs })
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error del agente' }, { status: 502 })
  }

  const { data: assistantMsg, error: assistantErr } = await sb
    .from('ai_messages')
    .insert({
      tenant_id: auth.tenantId,
      conversation_id: conversationId,
      role: 'assistant',
      content: turn.text,
      evidence: turn.evidence,
      model: turn.usage.model,
      input_tokens: turn.usage.inputTokens,
      output_tokens: turn.usage.outputTokens,
      cache_read_tokens: turn.usage.cacheReadTokens,
      cache_write_tokens: turn.usage.cacheWriteTokens,
      cost_usd: turn.usage.costUsd,
      latency_ms: turn.usage.latencyMs,
    })
    .select('id')
    .single()
  if (assistantErr) return NextResponse.json({ error: assistantErr.message }, { status: 500 })

  if (toolCallLogs.length > 0) {
    await sb.from('ai_tool_calls').insert(
      toolCallLogs.map((t) => ({
        tenant_id: auth.tenantId,
        conversation_id: conversationId,
        message_id: assistantMsg.id,
        tool_name: t.tool_name,
        input: t.input,
        success: t.success,
        result_summary: t.result_summary,
        latency_ms: t.latency_ms,
      }))
    )
  }

  return NextResponse.json({ conversationId, message: turn.text, evidence: turn.evidence })
}

// Marca insights como vistos. Sin esto el contador del launcher se quedaba clavado para siempre:
// el badge lee status='new' y nada lo hacía avanzar nunca, así que una vez detectada una anomalía
// el aviso no se podía quitar ni tras leerlo.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const body = (await req.json().catch(() => ({}))) as { ids?: string[]; status?: string }
  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string').slice(0, 50) : []
  const status = body.status === 'acknowledged' ? 'acknowledged' : 'seen'
  if (ids.length === 0) return NextResponse.json({ error: 'Faltan los ids de los insights' }, { status: 400 })

  const sb = await createClient()
  const { error } = await sb
    .from('ai_insights')
    .update({ status })
    .eq('tenant_id', auth.tenantId)
    .in('id', ids)
    .eq('status', 'new')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, updated: ids.length, status })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  const sb = await createClient()

  if (req.nextUrl.searchParams.get('insights') === '1') {
    const { data, error } = await sb
      .from('ai_insights')
      .select('id,type,severity,title,summary,status,generated_at')
      .eq('tenant_id', auth.tenantId)
      .eq('status', 'new')
      .order('generated_at', { ascending: false })
      .limit(10)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ insights: data || [] })
  }

  const conversationId = req.nextUrl.searchParams.get('conversationId')
  if (conversationId) {
    const { data, error } = await sb
      .from('ai_messages')
      .select('id,role,content,evidence,created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ messages: data || [] })
  }

  const { data, error } = await sb
    .from('ai_conversations')
    .select('id,title,updated_at')
    .order('updated_at', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ conversations: data || [] })
}
